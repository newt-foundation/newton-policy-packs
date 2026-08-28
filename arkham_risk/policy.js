import { fetch as httpFetch } from "newton:provider/http@0.2.0";
import { get as getHostSecrets } from "newton:provider/secrets@0.2.0";

// Phase 0 § Stream B (NEWT-1539): pack-side namespacing. See
// arkham_entity/policy.js for the full rationale. Keep PACK_ID in sync
// with the folder name and metadata.ts PACK_NAME.
const PACK_ID = "arkham_risk";

function wrapOutput(packId, valueOrError) {
  const out = JSON.stringify({ [packId]: valueOrError });
  return out;
}

const ARKHAM_API = "https://api.arkm.com";

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

// The `status >= 400` throw is load-bearing — see arkham_entity/policy.js.
function getJson(url, apiKey) {
  const r = httpFetch({
    url,
    method: "GET",
    headers: [
      ["accept", "application/json"],
      ["API-Key", apiKey],
    ],
    body: null,
  });
  if (typeof r === "string") throw new Error(`http: ${r}`);
  if (r.tag === "err") throw new Error(`http: ${r.val}`);
  const resp = r.val ?? r;
  const status = resp.status ?? 200;
  const text = new TextDecoder().decode(new Uint8Array(resp.body));
  if (status >= 400) throw new Error(`arkham ${status}: ${text.slice(0, 200)}`);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`arkham: invalid json: ${text.slice(0, 200)}`);
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

// Arkham returns `updated_at` as an ISO-8601 STRING ("2026-08-28T17:21:43Z"),
// not a unix number. Feeding that to Number() yields NaN, which would silently
// null out every freshness check — so parse it as a date first.
function ageSecondsFrom(value) {
  if (value == null) return null;
  const asNumber = Number(value);
  let seconds;
  if (Number.isFinite(asNumber) && asNumber > 0) {
    seconds = asNumber > 1e12 ? asNumber / 1000 : asNumber;
  } else {
    const ms = Date.parse(String(value));
    if (!Number.isFinite(ms)) return null;
    seconds = ms / 1000;
  }
  return Math.max(0, Math.floor(Date.now() / 1000 - seconds));
}

// Arkham does NOT nest per-category scores under an object. They arrive as
// flat sibling keys on the risk record — `hacker_score`, `privacy_score`,
// `sanctioned_1hop_score`, `token_blacklist_score`, ... — so we harvest every
// `*_score` key and strip the suffix. The aggregate `max_score*` keys are
// excluded: they are summaries, not categories, and letting `max` through
// would make it look like a risk category a curator could configure.
const AGGREGATE_SCORE_KEYS = new Set(["max_score", "max_score_forward", "max_score_backward"]);

function normaliseCategoryScores(risk) {
  const out = {};
  if (!risk || typeof risk !== "object") return out;
  for (const [key, value] of Object.entries(risk)) {
    if (!key.endsWith("_score")) continue;
    if (AGGREGATE_SCORE_KEYS.has(key)) continue;
    const score = num(value);
    if (score == null) continue;
    out[key.slice(0, -"_score".length).toLowerCase()] = score;
  }
  return out;
}

// The explainability payload. This pack deliberately emits Arkham's raw
// exposure paths rather than a precomputed verdict: "severe" is a curator
// notion that lives in `data.params`, and the Rego filters on it so the deny
// reason can name the exact route.
//
// NOTE on timing: Arkham's `/risk/address/{a}/paths` returns no first/last
// transaction timestamps, so `first_seen_days` / `last_seen_days` are always
// null and the Rego's `recent_distant_exposure` rule cannot currently fire.
// The fields and the rule are kept — they fail-soft on null — so the rule
// activates automatically if Arkham starts returning timing. See README.
function normalisePaths(raw) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.paths) ? raw.paths : [];
  const out = [];
  for (const p of list) {
    const nodes = [];
    // `path_nodes` is an array of {address, hop_distance} objects.
    const rawNodes = Array.isArray(p?.path_nodes) ? p.path_nodes : [];
    for (const n of rawNodes) {
      const addr = typeof n === "string" ? n : str(n?.address);
      if (addr) nodes.push(addr.toLowerCase());
    }
    out.push({
      category: (str(p?.risk_category) ?? "unknown").toLowerCase(),
      direction: str(p?.direction) ?? "unknown",
      hop_distance: num(p?.hop_distance) ?? 0,
      seed_address: (str(p?.seed_address) ?? "").toLowerCase(),
      score: num(p?.score),
      contributed_usd: Math.abs(num(p?.contribution_usd) ?? 0),
      contributed_pct: null,
      nodes,
      first_seen_days: null,
      last_seen_days: null,
    });
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

    const { address, chain } = myArgs;
    if (!address) throw new Error("missing address");

    const apiKey = secret("ARKHAM_API_KEY");
    if (!apiKey) throw new Error("missing ARKHAM_API_KEY");

    const risk = getJson(`${ARKHAM_API}/risk/address/${address}`, apiKey);
    const paths = getJson(`${ARKHAM_API}/risk/address/${address}/paths`, apiKey);

    // Arkham reports risk_level in upper case ("LOW"); lowercase it so a
    // curator's params never have to guess the casing.
    const riskLevel = str(risk?.risk_level);

    return wrapOutput(PACK_ID, {
      address,
      chain: chain ?? str(risk?.chain_type),
      risk_level: riskLevel == null ? null : riskLevel.toLowerCase(),
      max_score: num(risk?.max_score),
      category_scores: normaliseCategoryScores(risk),
      top_risk_category: (str(risk?.greatest_risk_category) ?? "").toLowerCase() || null,
      is_seed: Boolean(risk?.is_seed ?? false),
      hop_distance: num(risk?.hop_distance),
      risk_weighted_incoming_usd: num(risk?.risk_weighted_incoming_usd),
      risk_weighted_outgoing_usd: num(risk?.risk_weighted_outgoing_usd),
      paths: normalisePaths(paths),
      data_age_seconds: ageSecondsFrom(risk?.updated_at),
      timestamp: Date.now(),
    });
  } catch (e) {
    return wrapOutput(PACK_ID, { error: String(e) });
  }
}
