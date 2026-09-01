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

// `/api/redemption-backstops` has NO filter of any kind — its OpenAPI spec
// lists zero query parameters and it returns all ~328 coins as one 1.1MB
// document. `JSON.parse` on that exhausts the WASM heap, so we cut this coin's
// object out of the RAW TEXT and parse only that (~3KB).
//
// `charCodeAt` rather than `text[i]`: indexing a string allocates a fresh
// one-character string per iteration, which tips the heap on a document of
// this size.
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

function oldestAge(ages) {
  const present = ages.filter((a) => a != null);
  if (present.length === 0) return null;
  return Math.max(...present);
}

// Pharos ids are `ticker-issuer` (e.g. "usdc-circle").
function identityFromId(id) {
  const dash = id.indexOf("-");
  if (dash <= 0) return { symbol: id.toUpperCase(), issuer: null };
  return { symbol: id.slice(0, dash).toUpperCase(), issuer: id.slice(dash + 1) };
}

// Reserve composition arrives as a list of slices, each with a percentage and
// a qualitative risk band. Fold it into a {name: pct} map plus the share sitting
// in slices Pharos rates worse than low risk — the number a curator actually
// wants to gate on.
const LOW_RISK_BANDS = new Set(["very-low", "low"]);

function reserveBreakdown(reserves) {
  const composition = {};
  let elevatedPct = 0;
  const list = Array.isArray(reserves?.reserves) ? reserves.reserves : [];
  for (const slice of list) {
    const name = str(slice?.name ?? slice?.sourceKey);
    const pct = num(slice?.pct);
    if (name == null || pct == null) continue;
    composition[name] = pct;
    const band = (str(slice?.risk) ?? "").toLowerCase();
    if (!LOW_RISK_BANDS.has(band)) elevatedPct += pct;
  }
  return { composition, elevatedPct: list.length === 0 ? null : elevatedPct };
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
    const route = getKeyedSlice(`${PHAROS_API}/api/redemption-backstops`, apiKey, stablecoin_id);
    const reserves = getJson(`${PHAROS_API}/api/stablecoin-reserves/${id}`, apiKey);
    const { symbol, issuer } = identityFromId(stablecoin_id);

    // "Available" means Pharos actually reported a route for this asset. An
    // absent entry is a genuine "no redemption path", not a soft null.
    const available = route !== null;

    // Pharos publishes an IMMEDIATE capacity bound, not a daily limit and not
    // a redemption minimum — neither of those fields exists on this endpoint.
    // Sizing therefore compares the position against what can be redeemed
    // right now.
    const immediateCapacityUsd = route
      ? (num(route.immediateCapacityUsd) ?? num(route.capacityProfile?.immediateUsd))
      : null;
    // Null rather than Infinity when no amount was supplied, so the Rego
    // fail-softs instead of reading an unbounded ratio as safe.
    const capacityMultiple =
      immediateCapacityUsd != null && amountUsd > 0 ? immediateCapacityUsd / amountUsd : null;

    const { composition, elevatedPct } = reserveBreakdown(reserves);

    return wrapOutput(PACK_ID, {
      stablecoin_id,
      symbol,
      issuer,
      redemption_available: available,
      route_family: route ? str(route.routeFamily) : null,
      access_model: route ? str(route.accessModel) : null,
      settlement_model: route ? str(route.settlementModel) : null,
      execution_model: route ? str(route.executionModel) : null,
      // Pharos reports `open` for a working route (NOT `active`).
      route_status: route ? str(route.routeStatus) : null,
      holder_eligibility: route ? str(route.holderEligibility) : null,
      provider: route ? str(route.provider) : null,
      source_mode: route ? str(route.sourceMode) : null,
      immediate_capacity_usd: immediateCapacityUsd,
      modeled_exit_size_usd: route ? num(route.capacityProfile?.modeledExitSizeUsd) : null,
      // Capacity confidence is a STRING band ("documented-bound"), not a
      // 0-1 number; the numeric quality measure is the 0-100 `score`.
      capacity_confidence: route ? str(route.capacityConfidence) : null,
      route_score: route ? num(route.score) : null,
      access_score: route ? num(route.accessScore) : null,
      settlement_score: route ? num(route.settlementScore) : null,
      capacity_score: route ? num(route.capacityScore) : null,
      fee_bps: route ? num(route.feeBps) : null,
      queue_enabled: route ? Boolean(route.queueEnabled) : null,
      reserve_composition: composition,
      reserve_elevated_risk_pct: elevatedPct,
      reserve_mode: str(reserves?.mode),
      reserve_source: str(reserves?.source),
      reserve_sync_status: str(reserves?.sync?.status),
      reserve_stale: Boolean(reserves?.sync?.stale ?? false),
      transaction_amount_usd: amountUsd,
      capacity_multiple: capacityMultiple,
      data_age_seconds: oldestAge([
        ageFromUnix(route?.updatedAt),
        ageFromUnix(reserves?.liveAt),
      ]),
      timestamp: Date.now(),
    });
  } catch (e) {
    return wrapOutput(PACK_ID, { error: String(e) });
  }
}
