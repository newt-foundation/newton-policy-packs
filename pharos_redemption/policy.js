import { fetch as httpFetch } from "newton:provider/http@0.2.0";
import { get as getHostSecrets } from "newton:provider/secrets@0.2.0";

// Phase 0 § Stream B (NEWT-1539): pack-side namespacing. See
// pharos_treasury/policy.js for the full rationale. Keep PACK_ID in sync
// with the folder name and metadata.ts PACK_NAME.
const PACK_ID = "pharos_redemption";

function wrapOutput(packId, valueOrError) {
  const out = JSON.stringify({ [packId]: valueOrError });
  return out;
}

const PHAROS_API = "https://api.pharos.watch";

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

// `/api/redemption-backstops` returns a map keyed by stablecoin id.
function fromKeyedMap(payload, id) {
  if (!payload || typeof payload !== "object") return null;
  if (payload[id]) return payload[id];
  const inner = payload.data ?? payload.stablecoins ?? payload.results;
  if (inner && typeof inner === "object" && inner[id]) return inner[id];
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

    const amountUsd = num(myArgs.transaction_amount_usd) ?? 0;
    if (amountUsd < 0) throw new Error("transaction_amount_usd must be >= 0");

    const id = encodeURIComponent(stablecoin_id);
    const backstopsAll = getJson(`${PHAROS_API}/api/redemption-backstops`, apiKey);
    const reserves = getJson(`${PHAROS_API}/api/stablecoin-reserves/${id}`, apiKey);

    const route = fromKeyedMap(backstopsAll, stablecoin_id);

    // "Available" means Pharos actually reported a route for this asset —
    // an absent entry is a genuine "no redemption path", not a soft null.
    const available = Boolean(route && (route.routeStatus ?? route.routeFamily));

    const dailyLimitUsd = route ? num(route.dailyLimitUsd) : null;
    // Null rather than Infinity when no amount was supplied, so the Rego
    // fail-softs instead of reading an unbounded ratio as safe.
    const dailyLimitMultiple =
      dailyLimitUsd != null && amountUsd > 0 ? dailyLimitUsd / amountUsd : null;

    return wrapOutput(PACK_ID, {
      stablecoin_id,
      symbol: str(reserves?.symbol ?? reserves?.ticker),
      redemption_available: available,
      route_family: route ? str(route.routeFamily) : null,
      access_model: route ? str(route.accessModel) : null,
      settlement_model: route ? str(route.settlementModel) : null,
      route_status: route ? str(route.routeStatus) : null,
      holder_eligibility: route ? str(route.holderEligibility) : null,
      immediate_capacity_usd: route ? num(route.immediateCapacityUsd) : null,
      daily_limit_usd: dailyLimitUsd,
      min_redeem_usd: route ? num(route.minRedeemUsd) : null,
      fees_bps: route ? num(route.fees?.bps ?? route.feesBps) : null,
      confidence: route ? num(route.confidence) : null,
      reserve_composition:
        reserves?.composition && typeof reserves.composition === "object"
          ? reserves.composition
          : {},
      reserve_source_mode: str(reserves?.sourceMode ?? reserves?.source_mode),
      reserve_sync_status: str(reserves?.syncStatus ?? reserves?.sync_status),
      transaction_amount_usd: amountUsd,
      daily_limit_multiple: dailyLimitMultiple,
      data_age_seconds: oldestAge([metaAge(backstopsAll), metaAge(reserves)]),
      timestamp: Date.now(),
    });
  } catch (e) {
    return wrapOutput(PACK_ID, { error: String(e) });
  }
}
