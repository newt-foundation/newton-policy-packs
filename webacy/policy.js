import { fetch as httpFetch } from "newton:provider/http@0.2.0";
import { get as getHostSecrets } from "newton:provider/secrets@0.2.0";

// Phase 0 § Stream B (NEWT-1539): pack-side namespacing. Inlined `PACK_ID`
// and `wrapOutput` mirror @newton-xyz/policy-pack-shared/src/wrap.ts —
// see vaultsfyi PR #41 for the canonical pattern. PACK_ID drift enforced
// at `pnpm test` time. Final Stream B pack — completes the 9-pack sweep.
const PACK_ID = "webacy";

function wrapOutput(packId, valueOrError) {
  const out = JSON.stringify({ [packId]: valueOrError });
  return out;
}

const WEBACY_BASE = "https://api.webacy.com";

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

function getJson(url) {
  const apiKey = secret("WEBACY_API_KEY");
  const r = httpFetch({
    url,
    method: "GET",
    headers: [
      ["accept", "application/json"],
      ["x-api-key", apiKey ?? ""],
    ],
    body: null,
  });
  if (typeof r === "string") throw new Error(`http: ${r}`);
  if (r.tag === "err") throw new Error(`http: ${r.val}`);
  const resp = r.val ?? r;
  // The host's `fetch` (newton-prover-avs/crates/data-provider/src/wasm/executor.rs)
  // returns Ok(HttpResponse { status, headers, body }) for any HTTP response —
  // only network/transport errors land in `r.tag === "err"`. Without this
  // status guard a 404/500 with a JSON error body parses cleanly, and the
  // optional-chaining cascade in `run()` (`result?.token ?? {}`,
  // `snapshot.within_expected_range !== false`, `?? 0`, `?? null`) collapses
  // every field to a clean shape that policy.rego silently allows. Reject
  // non-2xx so the catch block returns the namespaced error envelope
  // instead. Mirrors the canonical fix vaultsfyi PR #41 added after codex
  // caught the same fail-open shape there.
  const status = resp.status ?? 200;
  if (status < 200 || status >= 300) {
    const preview = new TextDecoder().decode(new Uint8Array(resp.body)).slice(0, 200);
    throw new Error(`webacy http ${status}: ${preview}`);
  }
  const body = new TextDecoder().decode(new Uint8Array(resp.body));
  return JSON.parse(body);
}

function getDepegRisk(address, chain, hours) {
  const params = new URLSearchParams();
  params.set("hours", String(hours));
  if (chain) params.set("chain", chain);
  return getJson(`${WEBACY_BASE}/rwa/${address}?${params.toString()}`);
}

function num(x) {
  if (x == null) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

export function run(input) {
  try {
    const parsed = JSON.parse(input);
    // Phase 0 § Stream B input-unwrap shim. AVS forwards one `wasm_args`
    // blob to every PolicyData WASM in a policy. Composite execution
    // produces `{ webacy: {...}, vaultsfyi: {...} }`; nullish coalescing
    // reads our slice when present, falls back to flat for legacy
    // single-pack callers.
    const myArgs = parsed[PACK_ID] ?? parsed;
    // Strip our own slot from `_secrets` so it can't shadow a same-named
    // host secret. Sibling pack slots are intentionally left in place.
    _secrets = { ...parsed };
    delete _secrets[PACK_ID];
    loadHostSecrets();
    const { address, chain } = myArgs;
    if (!address) throw new Error("missing address");

    // Reject out-of-range lookback_days rather than silently clamping —
    // a clamp hides operator misconfiguration (e.g. 100 → 30) and the
    // policy still evaluates against a different window than the operator
    // configured. The throw is caught below and returned as an oracle
    // error, which rego denies via `default allow := false`.
    let lookbackDays = 7;
    if (parsed.lookback_days !== undefined && parsed.lookback_days !== null) {
      const n = Number(parsed.lookback_days);
      if (!Number.isFinite(n)) {
        throw new Error("lookback_days must be a finite number");
      }
      if (n < 1 || n > 30) {
        throw new Error(`lookback_days must be between 1 and 30 (got ${n})`);
      }
      lookbackDays = n;
    }
    const hours = Math.max(1, Math.min(720, Math.floor(lookbackDays * 24)));

    const result = getDepegRisk(address, chain, hours);

    const token = result?.token ?? {};
    const snapshot = result?.snapshot ?? {};
    const history = result?.history ?? {};
    const events = Array.isArray(result?.depegEvents) ? result.depegEvents : [];

    const deviations = events
      .map((e) => num(e?.deviationPct))
      .filter((x) => x != null);
    const maxRecentDeviationPct = deviations.length > 0 ? Math.max(...deviations) : 0;

    return wrapOutput(PACK_ID, {
      address,
      chain: chain ?? null,
      symbol: token.symbol ?? null,
      is_collapsed: Boolean(token.is_collapsed),
      lookback_hours: hours,
      recent_depeg_event_count: events.length,
      max_recent_deviation_pct: maxRecentDeviationPct,
      consecutive_days_below_peg: num(history.consecutive_days_below_peg) ?? 0,
      within_expected_range: snapshot.within_expected_range !== false,
      abs_dev_clean: num(snapshot.abs_dev_clean),
      stale: Boolean(result?.stale),
      timestamp: Date.now(),
    });
  } catch (e) {
    return wrapOutput(PACK_ID, { error: String(e) });
  }
}
