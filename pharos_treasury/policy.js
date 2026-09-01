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

// Hard ceiling on a bulk document we intend to slice.
//
// Measured against this runtime: holding a decoded document and slicing one
// object out of it succeeds at 1.6MB and traps at 1.7MB. A trap is the WORST
// failure available here — the component dies and the evaluation returns no
// verdict at all, rather than a deny a curator can act on. So we refuse
// early and return a normal error envelope, which the Rego turns into a
// fail-closed deny with a readable reason.
//
// `/api/redemption-backstops` is ~1.14MB across 328 coins (~3.5KB each), so
// this leaves room for roughly 100 more coins. If it trips, the fix is a
// per-asset endpoint from the provider, not a bigger number here.
const MAX_SLICEABLE_BYTES = 1500000;

// Filtered against each rung's ACTUAL `executionCostBps` (~9bps for a deep
// stablecoin), not the 200bps bound the simulation was run under.
const DEFAULT_MAX_COST_BPS = 50;
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
function getText(url, apiKey) {
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
  return text;
}

function getJson(url, apiKey) {
  const text = getText(url, apiKey);
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`pharos: invalid json: ${text.slice(0, 200)}`);
  }
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

// Oldest age across responses — the weakest link, not the freshest. Pharos has
// no uniform `_meta` envelope; each endpoint carries its own timestamp.
function oldestAge(ages) {
  const present = ages.filter((a) => a != null);
  if (present.length === 0) return null;
  return Math.max(...present);
}

// `/api/redemption-backstops` is the one endpoint here with NO filter of any
// kind — its OpenAPI spec lists zero query parameters, and it returns all ~328
// coins as a single 1.1MB document. `JSON.parse` on that exhausts the WASM
// heap, so we cut the one coin's object out of the RAW TEXT and parse only
// that (~3KB).
//
// `charCodeAt` rather than `text[i]`: indexing a string allocates a fresh
// one-character string per iteration, which is what tips the heap over on a
// document this size.
function sliceKeyedObject(text, key) {
  const needle = `"${key}":`;
  const at = text.indexOf(needle);
  if (at < 0) return null;
  const start = text.indexOf("{", at + needle.length);
  if (start < 0) return null;
  const QUOTE = 34;
  const BACKSLASH = 92;
  const OPEN = 123;
  const CLOSE = 125;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (inStr) {
      if (esc) esc = false;
      else if (c === BACKSLASH) esc = true;
      else if (c === QUOTE) inStr = false;
      continue;
    }
    if (c === QUOTE) inStr = true;
    else if (c === OPEN) depth++;
    else if (c === CLOSE) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

// Fetch a bulk document and parse ONLY the requested key's object.
function getKeyedSlice(url, apiKey, key) {
  const text = getText(url, apiKey);
  if (text.length > MAX_SLICEABLE_BYTES) {
    throw new Error(
      `pharos: bulk document too large to slice (${text.length} bytes > ${MAX_SLICEABLE_BYTES}); ` +
        "the provider needs a per-asset endpoint",
    );
  }
  const sliced = sliceKeyedObject(text, key);
  if (sliced === null) return null;
  try {
    return JSON.parse(sliced);
  } catch (e) {
    throw new Error(`pharos: bad slice for ${key}: ${String(e).slice(0, 120)}`);
  }
}

// How much can actually be sold within the caller's execution-cost tolerance.
//
// Reading this correctly matters. Each observation's top-level `executableUsd`
// is capped at its `requestedNotionalUsd` — a $1M simulation that fills
// completely reports $1M, which says nothing about the ceiling. The real ladder
// is `capacityCurve`: successive notionals each with the `executionCostBps`
// actually incurred. So we walk the curve and take the largest rung whose
// ACTUAL cost is within tolerance.
//
// `maxCostBps` on an observation is the bound the simulation ran under (always
// 200), not the cost incurred — filtering on it would use the wrong number.
//
// Across routes we take the MAX, not the sum: routes overlap (Pharos flags
// correlation via `commonModeKeys`), so summing double-counts shared
// liquidity. Max understates, which is the safe direction for a risk gate.
function bestRungWithinCost(observation, maxCostBps) {
  let best = null;
  const curve = Array.isArray(observation?.capacityCurve) ? observation.capacityCurve : [];
  for (const rung of curve) {
    const cost = num(rung?.executionCostBps);
    const usd = num(rung?.executableUsd);
    if (cost == null || usd == null) continue;
    if (cost > maxCostBps) continue;
    if (best == null || usd > best) best = usd;
  }
  if (best != null) return best;
  const usd = num(observation?.executableUsd);
  const bound = num(observation?.maxCostBps);
  if (usd == null) return null;
  if (bound != null && bound > maxCostBps) return null;
  return usd;
}

// `date` on a dex-liquidity-history entry is the DAILY BUCKET, so it reads as
// up to 24h stale even when the underlying observations are seconds old. Real
// freshness lives on the observations themselves.
function newestObservationAge(liquidity) {
  const observations = Array.isArray(liquidity?.exitRouteObservations)
    ? liquidity.exitRouteObservations
    : [];
  let newest = null;
  for (let i = 0; i < observations.length; i++) {
    const t = num(observations[i]?.observedAt);
    if (t == null) continue;
    if (newest == null || t > newest) newest = t;
  }
  return ageFromUnix(newest);
}

function exitCapacityAt(liquidity, maxCostBps) {
  const observations = Array.isArray(liquidity?.exitRouteObservations)
    ? liquidity.exitRouteObservations
    : [];
  let best = null;
  for (const o of observations) {
    const usd = bestRungWithinCost(o, maxCostBps);
    if (usd == null) continue;
    if (best == null || usd > best) best = usd;
  }
  return best;
}

// A confirmed incident. `pending` entries are unconfirmed threshold crossings —
// the stress score surfaces those earlier, so they do not trip `depeg_active`.
function activeDepeg(events) {
  const list = Array.isArray(events?.events) ? events.events : Array.isArray(events) ? events : [];
  for (const e of list) {
    if (e?.active === true || e?.status === "active" || e?.resolvedAt == null) return e;
  }
  return null;
}

// Signal sub-scores are 0-100 under `current.signals.<name>.value`. Emitting the
// whole map keeps the "raw data, curator decides" posture; the derived
// indicator list is a convenience view and no rule depends on it.
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

    const amountUsd = num(myArgs.transaction_amount_usd) ?? 0;
    if (amountUsd < 0) throw new Error("transaction_amount_usd must be >= 0");

    const maxCostBps = num(myArgs.max_cost_bps) ?? DEFAULT_MAX_COST_BPS;
    if (maxCostBps < 1 || maxCostBps > 10000) {
      throw new Error("max_cost_bps must be between 1 and 10000");
    }

    const stressDays = num(myArgs.stress_lookback_days) ?? DEFAULT_STRESS_DAYS;
    if (stressDays < 1 || stressDays > 365) {
      throw new Error("stress_lookback_days must be between 1 and 365");
    }

    const id = encodeURIComponent(stablecoin_id);

    // Every call below is scoped to ONE asset except redemption-backstops,
    // which offers no filter and is sliced out of the raw text instead.
    const summary = getJson(`${PHAROS_API}/api/stablecoin-summary/${id}`, apiKey);
    const depegs = getJson(
      `${PHAROS_API}/api/depeg-events?stablecoin=${id}&active=true&includePending=true`,
      apiKey,
    );
    const stress = getJson(
      `${PHAROS_API}/api/stress-signals?stablecoin=${id}&days=${stressDays}`,
      apiKey,
    );
    const liquidityHistory = getJson(
      `${PHAROS_API}/api/dex-liquidity-history?stablecoin=${id}&days=1`,
      apiKey,
    );
    const redemption = getKeyedSlice(
      `${PHAROS_API}/api/redemption-backstops`,
      apiKey,
      stablecoin_id,
    );

    // The history endpoint returns a list; the newest entry is current.
    const liquidity = Array.isArray(liquidityHistory) && liquidityHistory.length > 0
      ? liquidityHistory[liquidityHistory.length - 1]
      : null;

    const current = stress?.current ?? null;
    const depeg = activeDepeg(depegs);

    // Price comes from the per-asset summary, which aggregates several venues
    // and reports its own confidence.
    const price = num(summary?.priceUsd);
    let deviationBps = price == null ? null : (price - 1) * 10000;
    if (deviationBps == null) {
      const diverg = current?.signals?.diverg ?? null;
      deviationBps = num(diverg?.primaryDevBps) ?? num(diverg?.dexDevBps);
    }

    const exitCapacityUsd = exitCapacityAt(liquidity, maxCostBps);
    // Null rather than Infinity when no amount was supplied, so the Rego
    // fail-softs instead of reading an unbounded ratio as safe.
    const exitCapacityMultiple =
      exitCapacityUsd != null && amountUsd > 0 ? exitCapacityUsd / amountUsd : null;

    const signals = stressSignals(current);
    const band = str(current?.band);

    return wrapOutput(PACK_ID, {
      stablecoin_id,
      symbol: str(summary?.symbol),
      name: str(summary?.name),
      peg_type: str(summary?.pegType),
      peg_mechanism: str(summary?.pegMechanism),
      price,
      price_confidence: str(summary?.priceConfidence),
      peg_target: 1,
      // `null`, never 0: a 0 here reads as a perfect peg, which is the safest
      // possible input for the Rego peg rule. The Rego denies on null instead.
      peg_deviation_bps: deviationBps,
      depeg_active: depeg !== null,
      depeg_severity: depeg ? str(depeg.severity) : null,
      depeg_direction: depeg ? str(depeg.direction) : null,
      depeg_pending_count: Array.isArray(depegs?.pending) ? depegs.pending.length : 0,
      supply_usd: num(summary?.supplyUsd?.current),
      supply_change_7d_usd: num(summary?.supplyUsd?.change7d),
      chain_count: num(summary?.chainCount),
      stress_score: num(current?.score),
      stress_band: band == null ? null : band.toLowerCase(),
      stress_signals: signals,
      active_stress_indicators: Object.keys(signals).filter((k) => signals[k] >= SIGNAL_ELEVATED_AT),
      liquidity_score: num(liquidity?.score),
      effective_tvl_usd: num(liquidity?.tvl),
      volume_24h_usd: num(liquidity?.volume24h),
      liquidity_coverage_confidence: num(liquidity?.coverageConfidence),
      pool_count: num(liquidity?.exitRouteObservationCoverage?.retainedPoolCount),
      exit_capacity_usd: exitCapacityUsd,
      redemption_available: redemption !== null,
      redemption_route_family: redemption ? str(redemption.routeFamily) : null,
      redemption_access_model: redemption ? str(redemption.accessModel) : null,
      redemption_route_status: redemption ? str(redemption.routeStatus) : null,
      redemption_score: redemption ? num(redemption.score) : null,
      immediate_capacity_usd: redemption ? num(redemption.immediateCapacityUsd) : null,
      transaction_amount_usd: amountUsd,
      exit_capacity_multiple: exitCapacityMultiple,
      // Per-source ages, because they move on very different clocks and a
      // single number hides which feed is actually stale. Price and stress
      // refresh in minutes; the liquidity history is a DAILY bucket and the
      // redemption feed lags by hours, so a ceiling tuned for the fast feeds
      // would deny permanently on the slow ones.
      price_data_age_seconds: ageFromUnix(summary?.updatedAt),
      stress_data_age_seconds: ageFromUnix(current?.computedAt),
      liquidity_data_age_seconds: newestObservationAge(liquidity),
      redemption_data_age_seconds: ageFromUnix(redemption?.updatedAt),
      data_age_seconds: oldestAge([
        ageFromUnix(summary?.updatedAt),
        ageFromUnix(current?.computedAt),
        newestObservationAge(liquidity),
        ageFromUnix(redemption?.updatedAt),
      ]),
      timestamp: Date.now(),
    });
  } catch (e) {
    return wrapOutput(PACK_ID, { error: String(e) });
  }
}
