import { fetch as httpFetch } from "newton:provider/http@0.2.0";
import { get as getHostSecrets } from "newton:provider/secrets@0.2.0";

// Phase 0 § Stream B (NEWT-1539): pack-side namespacing. Inlined `PACK_ID`
// and `wrapOutput` mirror @newton-xyz/policy-pack-shared/src/wrap.ts —
// `policy.js` is fed straight to `jco componentize` with only the
// `newton:provider/*` host imports wired, so a top-level npm import does
// not resolve. See vaultsfyi PR #41 for the canonical pattern. Keep
// PACK_ID literal in sync with the folder name and metadata.ts PACK_NAME
// — packages/policy-pack-blockaid/src/pack-id.test.ts enforces this at
// `pnpm test` time.
const PACK_ID = "blockaid";

function wrapOutput(packId, valueOrError) {
  const out = JSON.stringify({ [packId]: valueOrError });
  return out;
}

const BLOCKAID_BASE = "https://api.blockaid.io";

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

function postJson(path, payload) {
  const apiKey = secret("BLOCKAID_API_KEY");
  const body = new TextEncoder().encode(JSON.stringify(payload));
  const r = httpFetch({
    url: `${BLOCKAID_BASE}${path}`,
    method: "POST",
    headers: [
      ["accept", "application/json"],
      ["content-type", "application/json"],
      ["x-api-key", apiKey ?? ""],
    ],
    body,
  });
  if (typeof r === "string") throw new Error(`http: ${r}`);
  if (r.tag === "err") throw new Error(`http: ${r.val}`);
  const resp = r.val ?? r;
  const text = new TextDecoder().decode(new Uint8Array(resp.body));
  return { status: resp.status ?? 200, body: text };
}

function scanEvmTransaction({ chain, from, to, value, data }) {
  const { status, body } = postJson("/v0/evm/transaction/scan", {
    chain,
    account_address: from,
    transaction: { from, to, value, data },
    options: ["validation", "simulation"],
  });
  if (status >= 400) throw new Error(`blockaid ${status}: ${body.slice(0, 200)}`);
  return JSON.parse(body);
}

export function run(input) {
  try {
    const parsed = JSON.parse(input);
    // Phase 0 § Stream B input-unwrap shim. AVS forwards one `wasm_args`
    // blob to every PolicyData WASM in a policy
    // (newton-prover-avs/crates/data-provider/src/lib.rs). Composite
    // execution will produce `{ blockaid: {...}, vaultsfyi: {...} }`
    // so each pack reads its slice via the namespaced key; nullish
    // coalescing falls back to flat for legacy single-pack callers.
    // Mirrors ADR 0003's `args[PACK_ID] ?? args` shape verbatim.
    const myArgs = parsed[PACK_ID] ?? parsed;
    // Strip our own slot from `_secrets` so it can't shadow a same-named
    // host secret. Sibling pack slots are intentionally left in place —
    // `secret(name)` only reads fixed named keys (e.g. `BLOCKAID_API_KEY`),
    // and a future composite-secrets shape may legitimately share
    // top-level keys across packs.
    _secrets = { ...parsed };
    delete _secrets[PACK_ID];
    loadHostSecrets();
    const { chain, from, to, value, data } = myArgs;
    if (!chain) throw new Error("missing chain");
    if (!from) throw new Error("missing from");
    if (!to) throw new Error("missing to");

    const scan = scanEvmTransaction({
      chain,
      from,
      to,
      value: value ?? "0x0",
      data: data ?? "0x",
    });
    const validation = scan.validation ?? {};
    const simulation = scan.simulation ?? {};

    const classification = validation.result_type ?? validation.classification ?? "Unknown";

    const features = (validation.features ?? [])
      .map((f) => f.feature_id ?? f.type ?? f.name ?? "")
      .filter(Boolean)
      .map(String);

    const accountSummary = simulation.account_summary ?? {};
    const totals = accountSummary.total_usd_diff ?? {};
    const expectedInUsd = Number(totals.in ?? 0);
    const expectedOutUsd = Number(totals.out ?? 0);

    const assetsDiffs = accountSummary.account_assets_diffs ?? accountSummary.assets_diffs ?? [];
    const receivedShares = assetsDiffs.some((d) => {
      const inUsd = Number(d.in?.usd_price ?? d.in?.value ?? 0);
      return inUsd > 0;
    });

    const simulationStatus = simulation.status ?? "Success";
    const simulationSucceeded = simulationStatus === "Success" || simulationStatus === undefined;

    let outboundInboundRatio = null;
    if (expectedInUsd > 0) {
      outboundInboundRatio = expectedOutUsd / expectedInUsd;
    }

    return wrapOutput(PACK_ID, {
      classification,
      features,
      expected_inbound_value_usd: expectedInUsd,
      expected_outbound_value_usd: expectedOutUsd,
      outbound_inbound_ratio: outboundInboundRatio,
      received_shares: receivedShares,
      simulation_succeeded: simulationSucceeded,
      timestamp: Date.now(),
    });
  } catch (e) {
    return wrapOutput(PACK_ID, { error: String(e) });
  }
}
