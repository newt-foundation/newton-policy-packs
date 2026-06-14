import { fetch as httpFetch } from "newton:provider/http@0.2.0";
import { get as getHostSecrets } from "newton:provider/secrets@0.2.0";

// Phase 0 § Stream B (NEWT-1539): pack-side namespacing. Inlined `PACK_ID`
// and `wrapOutput` mirror @newton-xyz/policy-pack-shared/src/wrap.ts —
// `policy.js` is fed straight to `jco componentize` with only the
// `newton:provider/*` host imports wired. See vaultsfyi PR #41 for the
// canonical pattern. PACK_ID drift is enforced at `pnpm test` time by
// packages/policy-pack-guardrail/src/pack-id.test.ts.
const PACK_ID = "guardrail";

function wrapOutput(packId, valueOrError) {
  const out = JSON.stringify({ [packId]: valueOrError });
  return out;
}

// Guardrail.so does not publish a stable, public REST API spec. The base URL
// and path here are best-guess placeholders; reconfirm against the live
// dashboard's network calls or with the Guardrail team before mainnet use.
const GUARDRAIL_BASE = "https://api.guardrail.so";

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
  const apiKey = secret("GUARDRAIL_API_KEY");
  const headers = [["accept", "application/json"]];
  if (apiKey) {
    headers.push(["authorization", `Bearer ${apiKey}`]);
    headers.push(["x-api-key", apiKey]);
  }
  const r = httpFetch({ url, method: "GET", headers, body: null });
  if (typeof r === "string") throw new Error(`http: ${r}`);
  if (r.tag === "err") throw new Error(`http: ${r.val}`);
  const resp = r.val ?? r;
  const status = resp.status ?? 200;
  const body = new TextDecoder().decode(new Uint8Array(resp.body));
  return { status, body };
}

function fetchAlerts(target, chainId) {
  const q = new URLSearchParams();
  q.set("target", target);
  if (chainId) q.set("chainId", String(chainId));
  q.set("status", "open");
  const url = `${GUARDRAIL_BASE}/v1/alerts?${q.toString()}`;
  const { status, body } = getJson(url);
  if (status >= 400) throw new Error(`guardrail alerts ${status}: ${body.slice(0, 200)}`);
  const parsed = JSON.parse(body);
  // Response shape unverified — accept both top-level array and { data: [...] }.
  return Array.isArray(parsed) ? parsed : parsed.data ?? parsed.alerts ?? [];
}

function fetchHealth(target, chainId) {
  const q = new URLSearchParams();
  q.set("target", target);
  if (chainId) q.set("chainId", String(chainId));
  const url = `${GUARDRAIL_BASE}/v1/health?${q.toString()}`;
  const { status, body } = getJson(url);
  if (status >= 400) return null;
  try {
    const parsed = JSON.parse(body);
    return parsed.health ?? parsed.score ?? parsed.healthScore ?? parsed;
  } catch (e) {
    return null;
  }
}

export function run(input) {
  try {
    const parsed = JSON.parse(input);
    // Phase 0 § Stream B input-unwrap shim. AVS forwards one `wasm_args`
    // blob to every PolicyData WASM in a policy. Composite execution
    // produces `{ guardrail: {...}, vaultsfyi: {...} }`; nullish
    // coalescing reads our slice when present, falls back to flat for
    // legacy single-pack callers.
    const myArgs = parsed[PACK_ID] ?? parsed;
    // Strip our own slot from `_secrets` so it can't shadow a same-named
    // host secret. Sibling pack slots are intentionally left in place —
    // `secret(name)` only reads fixed named keys (e.g. `GUARDRAIL_API_KEY`).
    _secrets = { ...parsed };
    delete _secrets[PACK_ID];
    loadHostSecrets();
    const { protocolId, vaultAddress, chainId } = myArgs;
    const target = vaultAddress ?? protocolId;
    if (!target) throw new Error("missing protocolId or vaultAddress");

    const alerts = fetchAlerts(target, chainId);
    const nowMs = Date.now();

    const normalized = alerts.map((a) => ({
      id: String(a.id ?? a.alertId ?? ""),
      severity: String(a.severity ?? a.level ?? "unknown").toLowerCase(),
      type: String(a.type ?? a.category ?? a.kind ?? ""),
      timestamp: Number(a.timestamp ?? a.createdAt ?? a.created_at ?? 0),
      ageSeconds:
        Number.isFinite(Number(a.timestamp ?? a.createdAt ?? a.created_at ?? 0)) &&
        Number(a.timestamp ?? a.createdAt ?? a.created_at ?? 0) > 0
          ? Math.max(0, (nowMs - Number(a.timestamp ?? a.createdAt ?? a.created_at)) / 1000)
          : null,
    }));

    const severities = Array.from(new Set(normalized.map((a) => a.severity))).sort();

    let healthScore = null;
    let healthAvailable = false;
    try {
      const h = fetchHealth(target, chainId);
      if (h !== null && h !== undefined) {
        const num = Number(typeof h === "object" ? h.score ?? h.value : h);
        if (Number.isFinite(num)) {
          healthScore = num;
          healthAvailable = true;
        }
      }
    } catch (e) {
      healthAvailable = false;
    }

    const oldestAlertAge = normalized.reduce((acc, a) => {
      if (a.ageSeconds == null) return acc;
      return acc == null || a.ageSeconds > acc ? a.ageSeconds : acc;
    }, null);

    return wrapOutput(PACK_ID, {
      target,
      chain_id: chainId ?? null,
      active_alert_count: normalized.length,
      alert_severities: severities,
      alerts: normalized,
      oldest_alert_age_seconds: oldestAlertAge,
      health_available: healthAvailable,
      health_score: healthScore,
      timestamp: nowMs,
    });
  } catch (e) {
    return wrapOutput(PACK_ID, { error: String(e) });
  }
}
