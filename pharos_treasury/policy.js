import { fetch as httpFetch } from "newton:provider/http@0.2.0";
import { get as getHostSecrets } from "newton:provider/secrets@0.2.0";

// Phase 0 § Stream B (NEWT-1539): pack-side namespacing. `policy.js` is
// fed straight to `jco componentize` with only the `newton:provider/*`
// host imports wired, so a top-level npm import does not resolve. Keep
// PACK_ID in sync with the folder name and metadata.ts PACK_NAME —
// packages/policy-pack-pharos_treasury/src/pack-id.test.ts enforces it.
const PACK_ID = "pharos_treasury";

function wrapOutput(packId, valueOrError) {
  const out = JSON.stringify({ [packId]: valueOrError });
  return out;
}

const PHAROS_API = "https://api.pharos.watch";
const DEFAULT_SLIPPAGE_BPS = 50;
const DEFAULT_STRESS_DAYS = 7;

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

// Pharos authenticates with `X-API-Key` (Arkham uses `API-Key` — the two
// vendors differ, so these helpers are NOT interchangeable).
//
// The `status >= 400` throw is load-bearing: a 401 or 404 with a JSON
// error body parses cleanly, and the `??` cascade below would collapse
// every field to a benign default and emit a clean-looking payload that
// Rego would allow. Throwing routes it to the error envelope instead.
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

// Pharos ships freshness in a `_meta` envelope on most endpoints. Take the
// OLDEST age across every response, so the policy's staleness check
// reflects the weakest link rather than the freshest one.
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

// `/api/dex-liquidity` and `/api/redemption-backstops` return maps keyed by
// stablecoin id rather than a single record.
function fromKeyedMap(payload, id) {
  if (!payload || typeof payload !== "object") return null;
  if (payload[id]) return payload[id];
  const inner = payload.data ?? payload.stablecoins ?? payload.results;
  if (inner && typeof inner === "object" && inner[id]) return inner[id];
  return null;
}

// How much can actually be sold without exceeding the caller's slippage
// tolerance. Observations above that tolerance are irrelevant — including
// them would overstate exit capacity, which is the exact failure this
// pack exists to catch.
function exitCapacityAt(liquidity, maxSlippageBps) {
  const observations = Array.isArray(liquidity?.exitRouteObservations)
    ? liquidity.exitRouteObservations
    : [];
  let best = null;
  for (const o of observations) {
    const bps = num(o?.slippageBps ?? o?.slippage_bps);
    const usd = num(o?.capacityUsd ?? o?.capacity_usd ?? o?.usd);
    if (bps == null || usd == null) continue;
    if (bps > maxSlippageBps) continue;
    if (best == null || usd > best) best = usd;
  }
  return best;
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
    // A pending threshold crossing is not yet a confirmed incident; the
    // stress score is what surfaces those earlier.
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

    const amountUsd = num(myArgs.transaction_amount_usd) ?? 0;
    if (amountUsd < 0) throw new Error("transaction_amount_usd must be >= 0");

    const slippageBps = num(myArgs.max_slippage_bps) ?? DEFAULT_SLIPPAGE_BPS;
    if (slippageBps < 1 || slippageBps > 10000) {
      throw new Error("max_slippage_bps must be between 1 and 10000");
    }

    const stressDays = num(myArgs.stress_lookback_days) ?? DEFAULT_STRESS_DAYS;
    if (stressDays < 1 || stressDays > 365) {
      throw new Error("stress_lookback_days must be between 1 and 365");
    }

    const id = encodeURIComponent(stablecoin_id);
    const asset = getJson(`${PHAROS_API}/api/stablecoin/${id}`, apiKey);
    const depegs = getJson(
      `${PHAROS_API}/api/depeg-events?stablecoin=${id}&active=true&includePending=true`,
      apiKey,
    );
    const stress = getJson(
      `${PHAROS_API}/api/stress-signals?stablecoin=${id}&days=${stressDays}`,
      apiKey,
    );
    const liquidityAll = getJson(`${PHAROS_API}/api/dex-liquidity`, apiKey);
    const redemptionAll = getJson(`${PHAROS_API}/api/redemption-backstops`, apiKey);

    const liquidity = fromKeyedMap(liquidityAll, stablecoin_id);
    const redemption = fromKeyedMap(redemptionAll, stablecoin_id);

    const depeg = activeDepeg(depegs);
    const price = num(asset?.price ?? asset?.currentPrice);
    const pegTarget = num(asset?.pegTarget ?? asset?.peg_target) ?? 1;

    // Signed on purpose: the direction of a depeg matters to a reader, and
    // the Rego applies a symmetric threshold via abs().
    let deviationBps = num(asset?.pegDeviationBps ?? asset?.peg_deviation_bps);
    if (deviationBps == null && price != null && pegTarget > 0) {
      deviationBps = ((price - pegTarget) / pegTarget) * 10000;
    }

    const exitCapacityUsd = exitCapacityAt(liquidity, slippageBps);
    // Null rather than Infinity when no amount was supplied — the Rego
    // fail-softs on null instead of reading an unbounded ratio as safe.
    const exitCapacityMultiple =
      exitCapacityUsd != null && amountUsd > 0 ? exitCapacityUsd / amountUsd : null;

    const dataAgeSeconds = oldestAge([
      metaAge(asset),
      metaAge(depegs),
      metaAge(stress),
      metaAge(liquidityAll),
      metaAge(redemptionAll),
    ]);

    const redemptionAvailable = Boolean(
      redemption && (redemption.routeStatus ?? redemption.routeFamily),
    );

    return wrapOutput(PACK_ID, {
      stablecoin_id,
      symbol: str(asset?.symbol ?? asset?.ticker),
      issuer: str(asset?.issuer ?? asset?.organization),
      price,
      peg_target: pegTarget,
      peg_deviation_bps: deviationBps ?? 0,
      depeg_active: depeg !== null,
      depeg_severity: depeg ? str(depeg.severity) : null,
      depeg_direction: depeg ? str(depeg.direction) : null,
      supply: num(asset?.supply ?? asset?.totalSupply),
      market_cap_usd: num(asset?.marketCap ?? asset?.marketCapUsd),
      chains: Array.isArray(asset?.chains) ? asset.chains.map((c) => str(c)) : [],
      stress_score: num(stress?.score ?? stress?.stressScore),
      stress_band: str(stress?.band ?? stress?.stressBand),
      active_stress_indicators: Array.isArray(stress?.activeSignals)
        ? stress.activeSignals.map((s) => str(s?.name ?? s))
        : [],
      liquidity_score: num(liquidity?.liquidityScore),
      effective_tvl_usd: num(liquidity?.effectiveTvlUsd),
      exit_capacity_usd: exitCapacityUsd,
      pool_count: num(liquidity?.poolCount),
      chain_count: num(liquidity?.chainCount),
      liquidity_concentration: num(liquidity?.concentration),
      redemption_available: redemptionAvailable,
      redemption_route_family: redemption ? str(redemption.routeFamily) : null,
      redemption_access_model: redemption ? str(redemption.accessModel) : null,
      redemption_route_status: redemption ? str(redemption.routeStatus) : null,
      daily_limit_usd: redemption ? num(redemption.dailyLimitUsd) : null,
      immediate_capacity_usd: redemption ? num(redemption.immediateCapacityUsd) : null,
      transaction_amount_usd: amountUsd,
      exit_capacity_multiple: exitCapacityMultiple,
      data_age_seconds: dataAgeSeconds,
      timestamp: Date.now(),
    });
  } catch (e) {
    return wrapOutput(PACK_ID, { error: String(e) });
  }
}
