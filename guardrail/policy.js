import { fetch as httpFetch } from "newton:provider/http@0.1.0";

// Guardrail.so does not publish a stable, public REST API spec. The base URL
// and path here are best-guess placeholders; reconfirm against the live
// dashboard's network calls or with the Guardrail team before mainnet use.
const GUARDRAIL_BASE = "https://api.guardrail.so";

let _secrets = {};

function secret(name) {
  if (typeof getSecret === "function") return getSecret(name);
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
    _secrets = parsed;
    const { protocolId, vaultAddress, chainId } = parsed;
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

    return JSON.stringify({
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
    return JSON.stringify({ error: String(e) });
  }
}
