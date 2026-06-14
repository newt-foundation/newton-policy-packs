import { fetch as httpFetch } from "newton:provider/http@0.2.0";
import { get as getHostSecrets } from "newton:provider/secrets@0.2.0";

// Phase 0 § Stream B (NEWT-1539): pack-side namespacing. Inlined `PACK_ID`
// and `wrapOutput` mirror @newton-xyz/policy-pack-shared/src/wrap.ts —
// see vaultsfyi PR #41 for the canonical pattern. PACK_ID drift enforced
// at `pnpm test` time by packages/policy-pack-redstone/src/pack-id.test.ts.
const PACK_ID = "redstone";

function wrapOutput(packId, valueOrError) {
  const out = JSON.stringify({ [packId]: valueOrError });
  return out;
}

const REDSTONE_BASE = "https://api.redstone.finance/prices";

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

function getJson(url, headers) {
  const r = httpFetch({
    url,
    method: "GET",
    headers: headers ?? [["accept", "application/json"]],
    body: null,
  });
  if (typeof r === "string") throw new Error(`http: ${r}`);
  if (r.tag === "err") throw new Error(`http: ${r.val}`);
  const resp = r.val ?? r;
  const body = new TextDecoder().decode(new Uint8Array(resp.body));
  return JSON.parse(body);
}

function postJson(url, payload, headers) {
  const body = new TextEncoder().encode(JSON.stringify(payload));
  const r = httpFetch({
    url,
    method: "POST",
    headers: headers ?? [["content-type", "application/json"]],
    body,
  });
  if (typeof r === "string") throw new Error(`http: ${r}`);
  if (r.tag === "err") throw new Error(`http: ${r.val}`);
  const resp = r.val ?? r;
  const text = new TextDecoder().decode(new Uint8Array(resp.body));
  return JSON.parse(text);
}

function getRedstonePrice(symbol, provider) {
  const url = `${REDSTONE_BASE}/?symbol=${encodeURIComponent(symbol)}&provider=${encodeURIComponent(provider)}&limit=1`;
  const arr = getJson(url);
  if (!Array.isArray(arr) || arr.length === 0) {
    throw new Error(`redstone: no price for symbol=${symbol} provider=${provider}`);
  }
  const { value, timestamp } = arr[0];
  return { price: Number(value), timestampMs: Number(timestamp) };
}

function getOnchainOraclePrice(rpcUrl, oracleAddress, selector, decimals) {
  const resp = postJson(rpcUrl, {
    jsonrpc: "2.0",
    id: 1,
    method: "eth_call",
    params: [{ to: oracleAddress, data: selector }, "latest"],
  });
  if (resp.error) throw new Error(`rpc: ${resp.error.message ?? JSON.stringify(resp.error)}`);
  if (!resp.result || resp.result === "0x") throw new Error(`rpc: empty result`);
  const raw = BigInt(resp.result);
  const d = decimals ?? 18;
  return Number(raw) / Math.pow(10, d);
}

export function run(input) {
  try {
    const parsed = JSON.parse(input);
    // Phase 0 § Stream B input-unwrap shim. AVS forwards one `wasm_args`
    // blob to every PolicyData WASM in a policy. Composite execution
    // produces `{ redstone: {...}, vaultsfyi: {...} }`; nullish
    // coalescing reads our slice when present, falls back to flat for
    // legacy single-pack callers.
    const myArgs = parsed[PACK_ID] ?? parsed;
    // Strip our own slot from `_secrets` so it can't shadow a same-named
    // host secret. Sibling pack slots are intentionally left in place.
    _secrets = { ...parsed };
    delete _secrets[PACK_ID];
    loadHostSecrets();
    const { symbol, provider, rpcUrl, onchainOracle, prevSnapshot } = myArgs;

    if (!symbol) throw new Error("missing symbol");
    if (!rpcUrl) throw new Error("missing rpcUrl");
    if (!onchainOracle?.address) throw new Error("missing onchainOracle.address");
    if (!onchainOracle?.selector) throw new Error("missing onchainOracle.selector");

    const { price: redstonePrice, timestampMs } = getRedstonePrice(symbol, provider ?? "redstone");
    const onchainPrice = getOnchainOraclePrice(
      rpcUrl,
      onchainOracle.address,
      onchainOracle.selector,
      onchainOracle.decimals ?? 18,
    );

    const divergenceBp = Math.round(
      (Math.abs(redstonePrice - onchainPrice) / Math.max(redstonePrice, 1e-18)) * 10000,
    );
    const nowMs = Date.now();
    const feedAgeSeconds = Math.max(0, (nowMs - timestampMs) / 1000);

    let prevSnapshotPresent = false;
    let sustainedSeconds = 0;
    if (
      prevSnapshot &&
      Number.isFinite(Number(prevSnapshot.divergenceBp)) &&
      Number.isFinite(Number(prevSnapshot.timestampMs))
    ) {
      prevSnapshotPresent = true;
      sustainedSeconds = Math.max(0, (nowMs - Number(prevSnapshot.timestampMs)) / 1000);
    }

    return wrapOutput(PACK_ID, {
      symbol,
      provider: provider ?? "redstone",
      redstone_price: redstonePrice,
      onchain_price: onchainPrice,
      divergence_bp: divergenceBp,
      redstone_feed_age_seconds: feedAgeSeconds,
      prev_snapshot_present: prevSnapshotPresent,
      prev_divergence_bp: prevSnapshotPresent ? Number(prevSnapshot.divergenceBp) : null,
      sustained_seconds: sustainedSeconds,
      timestamp: nowMs,
    });
  } catch (e) {
    return wrapOutput(PACK_ID, { error: String(e) });
  }
}
