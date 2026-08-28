import { fetch as httpFetch } from "newton:provider/http@0.2.0";
import { get as getHostSecrets } from "newton:provider/secrets@0.2.0";

// Phase 0 § Stream B (NEWT-1539): pack-side namespacing. See
// pharos_treasury/policy.js for the full rationale. Keep PACK_ID in sync
// with the folder name and metadata.ts PACK_NAME.
const PACK_ID = "pharos_safe_mode";

function wrapOutput(packId, valueOrError) {
  const out = JSON.stringify({ [packId]: valueOrError });
  return out;
}

const PHAROS_API = "https://api.pharos.watch";
const DEFAULT_STRESS_DAYS = 7;
const DEFAULT_FLOW_HOURS = 24;

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
    // Host secrets unavailable — fall through to wasm_args-based secrets.
  }
}

function secret(name) {
  return _secrets[name];
}

// Pharos uses `X-API-Key`. The `status >= 400` throw is load-bearing —
// see pharos_treasury/policy.js.
function getJson(url, apiKey) {
  const r = httpFetch({
    url,
    method: "GET",
    headers: [
      ["accept", "application/json"],
      ["X-API-Key", apiKey],
    ],
    body: null,
  });
  if (typeof r === "string") throw new Error(`http: ${r}`);
  if (r.tag === "err") throw new Error(`http: ${r.val}`);
  const resp = r.val ?? r;
  const status = resp.status ?? 200;
  const text = new TextDecoder().decode(new Uint8Array(resp.body));
  if (status >= 400) throw new Error(`pharos ${status}: ${text.slice(0, 200)}`);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`pharos: invalid json: ${text.slice(0, 200)}`);
  }
  return parsed;
}

function num(x) {
  if (x == null) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function str(x) {
  if (x == null) return null;
  return typeof x === "string" ? x : String(x);
}

function metaAge(payload) {
  const meta = payload?._meta ?? payload?.meta;
  const direct = num(meta?.ageSeconds ?? meta?.age_seconds);
  if (direct != null) return direct;
  const updated = num(meta?.updatedAt ?? meta?.updated_at);
  if (updated == null) return null;
  const seconds = updated > 1e12 ? updated / 1000 : updated;
  return Math.max(0, Math.floor(Date.now() / 1000 - seconds));
}

function oldestAge(ages) {
  const present = ages.filter((a) => a != null);
  if (present.length === 0) return null;
  return Math.max(...present);
}

function activeDepeg(events) {
  const list = Array.isArray(events)
    ? events
    : Array.isArray(events?.events)
      ? events.events
      : Array.isArray(events?.data)
        ? events.data
        : [];
  for (const e of list) {
    const isActive = e?.active === true || e?.status === "active";
    if (isActive) return e;
  }
  return null;
}

export function run(input) {
  try {
    const parsed = JSON.parse(input);
    const myArgs = parsed[PACK_ID] ?? parsed;
    _secrets = { ...parsed };
    delete _secrets[PACK_ID];
    loadHostSecrets();

    const { stablecoin_id } = myArgs;
    if (!stablecoin_id) throw new Error("missing stablecoin_id");

    const apiKey = secret("PHAROS_API_KEY");
    if (!apiKey) throw new Error("missing PHAROS_API_KEY");

    const stressDays = num(myArgs.stress_lookback_days) ?? DEFAULT_STRESS_DAYS;
    if (stressDays < 1 || stressDays > 365) {
      throw new Error("stress_lookback_days must be between 1 and 365");
    }

    const flowHours = num(myArgs.flow_window_hours) ?? DEFAULT_FLOW_HOURS;
    if (flowHours < 1 || flowHours > 720) {
      throw new Error("flow_window_hours must be between 1 and 720");
    }

    const id = encodeURIComponent(stablecoin_id);
    const stress = getJson(
      `${PHAROS_API}/api/stress-signals?stablecoin=${id}&days=${stressDays}`,
      apiKey,
    );
    const depegs = getJson(
      `${PHAROS_API}/api/depeg-events?stablecoin=${id}&active=true&includePending=true`,
      apiKey,
    );
    const flows = getJson(
      `${PHAROS_API}/api/mint-burn-flows?stablecoin=${id}&hours=${flowHours}`,
      apiKey,
    );

    const depeg = activeDepeg(depegs);

    // Pharos exposes flow anomaly either as an explicit flag or as a net
    // flow that has broken out of its historical baseline. Prefer the
    // explicit flag; derive only when it is absent.
    const netFlow = num(flows?.netFlowUsd ?? flows?.net_flow_usd);
    const baseline = num(flows?.baselineNetFlowUsd ?? flows?.baseline?.netFlowUsd);
    let flowAnomaly = flows?.anomalyDetected;
    if (typeof flowAnomaly !== "boolean") {
      flowAnomaly =
        netFlow != null && baseline != null && baseline > 0
          ? Math.abs(netFlow) > baseline * 2
          : false;
    }

    return wrapOutput(PACK_ID, {
      stablecoin_id,
      symbol: str(flows?.symbol ?? stress?.symbol),
      stress_score: num(stress?.score ?? stress?.stressScore),
      stress_band: str(stress?.band ?? stress?.stressBand),
      active_indicators: Array.isArray(stress?.activeSignals)
        ? stress.activeSignals.map((s) => str(s?.name ?? s))
        : [],
      depeg_active: depeg !== null,
      depeg_severity: depeg ? str(depeg.severity) : null,
      peg_deviation_bps: depeg ? (num(depeg.peakDeviationBps) ?? 0) : 0,
      net_flow_usd: netFlow,
      mint_volume_usd: num(flows?.mintVolumeUsd ?? flows?.mint_volume_usd),
      burn_volume_usd: num(flows?.burnVolumeUsd ?? flows?.burn_volume_usd),
      flow_anomaly: Boolean(flowAnomaly),
      data_age_seconds: oldestAge([metaAge(stress), metaAge(depegs), metaAge(flows)]),
      timestamp: Date.now(),
    });
  } catch (e) {
    return wrapOutput(PACK_ID, { error: String(e) });
  }
}
