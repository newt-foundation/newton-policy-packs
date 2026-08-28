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

function daysSince(ts) {
  const t = num(ts);
  if (t == null || t <= 0) return null;
  const seconds = t > 1e12 ? t / 1000 : t;
  return Math.max(0, (Date.now() / 1000 - seconds) / 86400);
}

// Arkham returns per-category exposure scores as an object or as a list of
// {category, score} records depending on endpoint version. Normalise to a
// flat {category: score} map so the Rego sees one shape.
function normaliseCategoryScores(raw) {
  const out = {};
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const name = str(entry?.category ?? entry?.name);
      const score = num(entry?.score ?? entry?.value);
      if (name != null && score != null) out[name.toLowerCase()] = score;
    }
    return out;
  }
  if (raw && typeof raw === "object") {
    for (const [k, val] of Object.entries(raw)) {
      const score = num(val);
      if (score != null) out[k.toLowerCase()] = score;
    }
  }
  return out;
}

// The explainability payload. This pack deliberately emits Arkham's raw
// exposure paths rather than a precomputed verdict: "severe" is a curator
// notion that lives in `data.params`, and the Rego filters on it so the
// deny reason can name the exact route. Anything collapsed here would be
// a decision the curator can no longer see or tune.
function normalisePaths(raw) {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.paths)
      ? raw.paths
      : Array.isArray(raw?.data)
        ? raw.data
        : [];
  const out = [];
  for (const p of list) {
    const nodes = [];
    const rawNodes = Array.isArray(p?.path) ? p.path : Array.isArray(p?.nodes) ? p.nodes : [];
    for (const n of rawNodes) {
      const addr = typeof n === "string" ? n : str(n?.address ?? n?.id);
      if (addr) nodes.push(addr.toLowerCase());
    }
    out.push({
      category: (str(p?.category ?? p?.riskCategory) ?? "unknown").toLowerCase(),
      direction: str(p?.direction) ?? "unknown",
      hop_distance: num(p?.hops ?? p?.hopDistance ?? p?.hop_distance) ?? 0,
      seed_address: (str(p?.seedAddress ?? p?.seed ?? p?.sourceAddress) ?? "").toLowerCase(),
      score: num(p?.score),
      contributed_usd: Math.abs(num(p?.usd ?? p?.contributedUsd ?? p?.value) ?? 0),
      contributed_pct: num(p?.pct ?? p?.contributedPct),
      nodes,
      first_seen_days: daysSince(p?.firstTransactionTime ?? p?.firstSeen),
      last_seen_days: daysSince(p?.lastTransactionTime ?? p?.lastSeen),
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

    const updatedAt = num(risk?.updated_at ?? risk?.updatedAt);
    const dataAgeSeconds =
      updatedAt == null ? null : Math.max(0, Math.floor(Date.now() / 1000 - updatedAt));

    return wrapOutput(PACK_ID, {
      address,
      chain: chain ?? null,
      risk_level: str(risk?.risk_level ?? risk?.riskLevel),
      max_score: num(risk?.max_score ?? risk?.maxScore),
      category_scores: normaliseCategoryScores(
        risk?.category_scores ?? risk?.categoryScores ?? risk?.categories,
      ),
      top_risk_category: str(risk?.greatest_risk_category ?? risk?.greatestRiskCategory),
      is_seed: Boolean(risk?.is_seed ?? risk?.isSeed ?? false),
      paths: normalisePaths(paths),
      data_age_seconds: dataAgeSeconds,
      timestamp: Date.now(),
    });
  } catch (e) {
    return wrapOutput(PACK_ID, { error: String(e) });
  }
}
