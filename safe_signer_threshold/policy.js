import { fetch as httpFetch } from "newton:provider/http@0.2.0";
import { get as getHostSecrets } from "newton:provider/secrets@0.2.0";

// Phase 0 § Stream B (NEWT-1539): pack-side namespacing. Inlined `PACK_ID`
// and `wrapOutput` mirror the canonical pattern in the sibling packs — the
// AVS host shallow-merges every PolicyData WASM's stdout, so every payload
// (success AND error) must live under `{[PACK_ID]: ...}`.
const PACK_ID = "safe_signer_threshold";

function wrapOutput(packId, valueOrError) {
  const out = JSON.stringify({ [packId]: valueOrError });
  return out;
}

// Safe (Gnosis Safe) read-only accessors, from OwnerManager.sol which
// Safe.sol inherits:
//   getThreshold() -> uint256          — signatures required to execute
//   getOwners()    -> address[]        — the current owner (signer) set
// https://github.com/safe-fndn/safe-smart-account/blob/main/contracts/Safe.sol
const SELECTOR_GET_THRESHOLD = "0xe75235b8";
const SELECTOR_GET_OWNERS = "0xa0e67e2b";

// Which secret holds the RPC endpoint for each supported chain. The RPC URLs
// are policy secrets (not wasm_args) so the endpoint — and any API key baked
// into it — is never visible in the on-chain / AVS-visible task payload.
const RPC_SECRET_BY_CHAIN = {
  11155111: "ETH_SEPOLIA_RPC_URL",
  84532: "BASE_SEPOLIA_RPC_URL",
};

// Convenience aliases so callers can pass a human-readable chain name
// instead of the numeric id.
const CHAIN_ID_BY_NAME = {
  "eth-sepolia": 11155111,
  "ethereum-sepolia": 11155111,
  sepolia: 11155111,
  "base-sepolia": 84532,
};

let _secrets = {};

function loadHostSecrets() {
  try {
    const r = getHostSecrets();
    const resp = r?.val ?? r;
    const bytes = resp?.value;
    if (!bytes || bytes.length === 0) return;
    const text = new TextDecoder().decode(new Uint8Array(bytes));
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") {
      _secrets = { ..._secrets, ...parsed };
    }
  } catch (_) {
    // Host secrets unavailable (e.g. local sim without uploaded secrets) —
    // fall through to wasm_args-based secrets.
  }
}

function secret(name) {
  return _secrets[name];
}

function postJson(url, payload, headers) {
  const body = new TextEncoder().encode(JSON.stringify(payload));
  const r = httpFetch({
    url,
    method: "POST",
    headers: headers ?? [["content-type", "application/json"], ["accept", "application/json"]],
    body,
  });
  if (typeof r === "string") throw new Error(`http: ${r}`);
  if (r.tag === "err") throw new Error(`http: ${r.val}`);
  const resp = r.val ?? r;
  const text = new TextDecoder().decode(new Uint8Array(resp.body));
  return JSON.parse(text);
}

// `latest` is re-resolved by the node on every request, so issuing the two
// reads against it can straddle a block boundary: an `addOwnerWithThreshold`
// or `changeThreshold` landing between them would pair a pre-change threshold
// with a post-change owner set. That mismatched pair is exactly the
// configuration drift this policy exists to catch, so the reads must come from
// one block. Resolve the head to a concrete number once, then pin BOTH
// `eth_call`s to it — the second read specifies the same block the first was
// sourced from, and the pair is an atomic snapshot of the Safe.
//
// Failure mode worth knowing: a load-balanced RPC can hand the pinned call to
// a node that hasn't ingested this head yet, which errors ("header not found")
// rather than silently answering from another block. The pack fails closed on
// oracle error, so that degrades to a deny, never to an inconsistent read.
function getLatestBlockNumber(rpcUrl) {
  const resp = postJson(rpcUrl, {
    jsonrpc: "2.0",
    id: 1,
    method: "eth_blockNumber",
    params: [],
  });
  if (resp.error) throw new Error(`rpc: ${resp.error.message ?? JSON.stringify(resp.error)}`);
  const hex = resp.result;
  if (typeof hex !== "string" || !/^0x[0-9a-fA-F]+$/.test(hex)) {
    throw new Error(`rpc: bad eth_blockNumber result: ${String(hex)}`);
  }
  return hex;
}

// `blockTag` is required rather than defaulted to "latest": every caller must
// state which block it is reading, so a future read can't quietly reintroduce
// the straddle described above.
function ethCall(rpcUrl, to, data, blockTag) {
  const resp = postJson(rpcUrl, {
    jsonrpc: "2.0",
    id: 1,
    method: "eth_call",
    params: [{ to, data }, blockTag],
  });
  if (resp.error) throw new Error(`rpc: ${resp.error.message ?? JSON.stringify(resp.error)}`);
  const result = resp.result;
  // An EOA or a non-Safe contract without the accessor returns "0x" rather
  // than reverting on some nodes — treat it as "not a Safe".
  if (!result || result === "0x") {
    throw new Error(`rpc: empty result for ${data} at ${to} @ ${blockTag} (not a Safe?)`);
  }
  return result;
}

function normalizeAddress(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`invalid ${label}: ${String(value)}`);
  }
  return value.toLowerCase();
}

function resolveChainId(chainId, chain) {
  if (chainId !== undefined && chainId !== null && chainId !== "") {
    const n = Number(chainId);
    if (!Number.isInteger(n)) throw new Error(`invalid chainId: ${String(chainId)}`);
    return n;
  }
  if (typeof chain === "string" && chain.length > 0) {
    const mapped = CHAIN_ID_BY_NAME[chain.toLowerCase()];
    if (mapped === undefined) throw new Error(`unsupported chain: ${chain}`);
    return mapped;
  }
  throw new Error("missing chainId");
}

// Decode a `uint256` return word.
function decodeUint256(hex) {
  const data = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (data.length < 64) throw new Error(`rpc: short uint256 return (${data.length / 2} bytes)`);
  return Number(BigInt(`0x${data.slice(0, 64)}`));
}

// Decode the element count of an ABI-encoded dynamic `address[]` return:
//   word 0            -> byte offset of the array payload
//   word at offset    -> element count
//   following words   -> the addresses themselves
// Only the count is needed downstream, but the tail length is validated so a
// truncated / malformed response errors instead of reporting a bogus count.
function decodeAddressArrayLength(hex) {
  const data = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (data.length < 128) {
    throw new Error(`rpc: short address[] return (${data.length / 2} bytes)`);
  }
  const offsetBytes = Number(BigInt(`0x${data.slice(0, 64)}`));
  const lengthStart = offsetBytes * 2;
  if (data.length < lengthStart + 64) {
    throw new Error(`rpc: address[] offset ${offsetBytes} out of range`);
  }
  const length = Number(BigInt(`0x${data.slice(lengthStart, lengthStart + 64)}`));
  if (data.length < lengthStart + 64 + length * 64) {
    throw new Error(`rpc: address[] claims ${length} elements but payload is truncated`);
  }
  return length;
}

export function run(input) {
  try {
    const parsed = JSON.parse(input);
    // Phase 0 § Stream B input-unwrap shim. AVS forwards one `wasm_args`
    // blob to every PolicyData WASM in a policy. Composite execution
    // produces `{ safe_signer_threshold: {...}, blockaid: {...} }`; nullish coalescing reads
    // our slice when present, falls back to flat for legacy single-pack
    // callers.
    const myArgs = parsed[PACK_ID] ?? parsed;
    // Strip our own slot from `_secrets` so it can't shadow a same-named
    // host secret. Sibling pack slots are intentionally left in place.
    _secrets = { ...parsed };
    delete _secrets[PACK_ID];
    loadHostSecrets();

    const { safeAddress, chainId, chain } = myArgs;

    if (!safeAddress) throw new Error("missing safeAddress");
    const address = normalizeAddress(safeAddress, "safeAddress");
    const resolvedChainId = resolveChainId(chainId, chain);

    const secretName = RPC_SECRET_BY_CHAIN[resolvedChainId];
    if (!secretName) {
      throw new Error(
        `unsupported chainId ${resolvedChainId} (supported: ${Object.keys(RPC_SECRET_BY_CHAIN).join(", ")})`,
      );
    }
    const rpcUrl = secret(secretName);
    if (!rpcUrl) throw new Error(`missing secret ${secretName}`);

    // Both reads are pinned to this one block — see getLatestBlockNumber().
    const blockTag = getLatestBlockNumber(rpcUrl);
    const threshold = decodeUint256(ethCall(rpcUrl, address, SELECTOR_GET_THRESHOLD, blockTag));
    const ownerCount = decodeAddressArrayLength(
      ethCall(rpcUrl, address, SELECTOR_GET_OWNERS, blockTag),
    );

    return wrapOutput(PACK_ID, {
      safe_address: address,
      chain_id: resolvedChainId,
      threshold,
      owner_count: ownerCount,
      block_number: Number(BigInt(blockTag)),
    });
  } catch (e) {
    return wrapOutput(PACK_ID, { error: String(e) });
  }
}
