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

function ageFromUnix(value) {
  const t = num(value);
  if (t == null || t <= 0) return null;
  const seconds = t > 1e12 ? t / 1000 : t;
  return Math.max(0, Math.floor(Date.now() / 1000 - seconds));
}

// Oldest age across responses — the weakest link, not the freshest. Pharos
// has no uniform `_meta` envelope; each endpoint carries its own timestamp.
function oldestAge(ages) {
  const present = ages.filter((a) => a != null);
  if (present.length === 0) return null;
  return Math.max(...present);
}

// A confirmed incident. `pending` entries are unconfirmed threshold crossings
// — the stress score surfaces those earlier, so they deliberately do not trip
// `depeg_active` on their own.
function activeDepeg(events) {
  const list = Array.isArray(events?.events) ? events.events : Array.isArray(events) ? events : [];
  for (const e of list) {
    if (e?.active === true || e?.status === "active" || e?.resolvedAt == null) return e;
  }
  return null;
}

// Signal sub-scores are 0-100 under `current.signals.<name>.value`, each with
// an `available` flag. Emitting the whole map keeps the "raw data, curator
// decides" posture; `active_indicators` is a convenience view at a documented
// cutoff and no rule depends on it.
const SIGNAL_ELEVATED_AT = 50;

function stressSignals(current) {
  const out = {};
  const signals = current?.signals;
  if (!signals || typeof signals !== "object") return out;
  for (const [name, sig] of Object.entries(signals)) {
    if (sig?.available === false) continue;
    const v = num(sig?.value);
    if (v != null) out[name] = v;
  }
  return out;
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

    const current = stress?.current ?? null;
    const depeg = activeDepeg(depegs);
    const signals = stressSignals(current);
    const band = str(current?.band);

    // `/api/mint-burn-flows` carries no anomaly flag of its own. Pharos's own
    // judgement of flow abnormality lives in the stress `flow` signal, which
    // already folds in burn surge and the burn/mint ratio against a baseline —
    // so use that rather than inventing a threshold over raw volumes here.
    const flowSignal = current?.signals?.flow ?? null;
    const flowScore = num(flowSignal?.value);
    const burnSurge = num(flowSignal?.burnSurge);

    const diverg = current?.signals?.diverg ?? null;
    let deviationBps = num(diverg?.primaryDevBps);
    if (deviationBps == null) deviationBps = num(diverg?.dexDevBps);
    if (deviationBps == null && depeg) deviationBps = num(depeg.peakDeviationBps);

    return wrapOutput(PACK_ID, {
      stablecoin_id,
      symbol: str(flows?.symbol),
      stress_score: num(current?.score),
      stress_band: band == null ? null : band.toLowerCase(),
      stress_signals: signals,
      active_indicators: Object.keys(signals).filter((k) => signals[k] >= SIGNAL_ELEVATED_AT),
      age_classification: str(current?.ageClassification),
      depeg_active: depeg !== null,
      depeg_severity: depeg ? str(depeg.severity) : null,
      depeg_pending_count: Array.isArray(depegs?.pending) ? depegs.pending.length : 0,
      // `null`, never 0: a 0 here would read as a perfect peg. Informational
      // in this pack - no rule reads it - but it must not assert a false calm.
      peg_deviation_bps: deviationBps,
      net_flow_usd: num(flows?.netFlowUsd),
      mint_volume_usd: num(flows?.mintVolumeUsd),
      burn_volume_usd: num(flows?.burnVolumeUsd),
      flow_stress_score: flowScore,
      burn_surge: burnSurge,
      flow_anomaly: flowScore != null && flowScore >= SIGNAL_ELEVATED_AT,
      data_age_seconds: oldestAge([ageFromUnix(current?.computedAt), ageFromUnix(flows?.updatedAt)]),
      timestamp: Date.now(),
    });
  } catch (e) {
    return wrapOutput(PACK_ID, { error: String(e) });
  }
}
