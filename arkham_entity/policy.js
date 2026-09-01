import { fetch as httpFetch } from "newton:provider/http@0.2.0";
import { get as getHostSecrets } from "newton:provider/secrets@0.2.0";

// Phase 0 § Stream B (NEWT-1539): pack-side namespacing. Inlined `PACK_ID`
// and `wrapOutput` mirror @newton-xyz/policy-core's wrap helper —
// `policy.js` is fed straight to `jco componentize` with only the
// `newton:provider/*` host imports wired, so a top-level npm import does
// not resolve. Indirect-return form satisfies the AST-lint guard. Keep
// PACK_ID literal in sync with the folder name and metadata.ts PACK_NAME
// — packages/policy-pack-arkham_entity/src/pack-id.test.ts enforces this
// at `pnpm test` time.
const PACK_ID = "arkham_entity";

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
    // Host secrets unavailable (e.g. local sim without uploaded secrets) —
    // fall through to wasm_args-based secrets.
  }
}

function secret(name) {
  return _secrets[name];
}

// Arkham authenticates with an `API-Key` header (NOT `Authorization`).
//
// The `status >= 400` throw is load-bearing, not defensive politeness: a 404
// with a JSON error body parses cleanly, and the optional-chaining cascade
// below would then collapse every field to a benign default and emit a
// clean-looking payload that Rego would happily allow. Failing here is what
// routes the error into `wrapOutput(PACK_ID, { error })` and makes the
// policy fail closed. See webacy/wrapping_test.rego for the incident this
// pattern came out of.
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
// not a unix number. Number() on that yields NaN, which would silently null
// out the freshness check — so parse it as a date first.
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

// `/intelligence/address_enriched/{a}/all` is keyed by chain slug at the top
// level (`ethereum`, `base`, `arbitrum_one`, ...) because the same address can
// carry different labels and activity per network. When the caller names a
// chain we take that slice; otherwise we take the first slice that actually
// carries an entity, and report which — so the decision is traceable to one
// network rather than silently blending several.
function pickChainSlice(payload, chain) {
  if (!payload || typeof payload !== "object") return { slice: null, chain: null };
  if (chain && payload[chain]) return { slice: payload[chain], chain };
  let firstAny = null;
  for (const [key, candidate] of Object.entries(payload)) {
    if (!candidate || typeof candidate !== "object") continue;
    if (firstAny === null) firstAny = { slice: candidate, chain: key };
    if (candidate.arkhamEntity) return { slice: candidate, chain: key };
  }
  return firstAny ?? { slice: null, chain: chain ?? null };
}

// Tags arrive as `populatedTags: [{ id, label, rank, ... }]`. The `id` is the
// stable machine name ("cex"); `label` is display text ("Centralized
// Exchange"). Match on `id`, lowercased, so curator params stay stable.
function collectTags(slice) {
  const out = [];
  const seen = new Set();
  const raw = Array.isArray(slice?.populatedTags) ? slice.populatedTags : [];
  for (const t of raw) {
    const name = typeof t === "string" ? t : str(t?.id);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
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

    const amountUsd = num(myArgs.transaction_amount_usd) ?? 0;
    if (amountUsd < 0) throw new Error("transaction_amount_usd must be >= 0");

    const enriched = getJson(
      `${ARKHAM_API}/intelligence/address_enriched/${address}/all` +
        `?includeTags=true&includeEntityPredictions=true&includeClusters=true`,
      apiKey,
    );
    const risk = getJson(`${ARKHAM_API}/risk/address/${address}`, apiKey);

    const { slice, chain: resolvedChain } = pickChainSlice(enriched, chain);

    // Arkham distinguishes a verified attribution (`arkhamEntity`) from a
    // probabilistic one (`arkhamEntityPrediction`). A verified entity carries
    // no confidence field — it is asserted, not inferred — so it scores 1.0;
    // a prediction carries its own, which the Rego gates on separately.
    const entity = slice?.arkhamEntity ?? null;
    const prediction =
      slice?.arkhamEntityPrediction ?? slice?.entityPrediction ?? slice?.prediction ?? null;
    const hasEntity = Boolean(entity && (entity.name ?? entity.id));
    const hasPrediction = Boolean(prediction && (prediction.name ?? prediction.id));

    let attributionType = "none";
    if (hasEntity) attributionType = "verified";
    else if (hasPrediction) attributionType = "predicted";

    const source = hasEntity ? entity : hasPrediction ? prediction : null;
    const confidence = hasEntity ? 1 : hasPrediction ? num(prediction.confidence) : null;

    const riskLevel = str(risk?.risk_level);

    return wrapOutput(PACK_ID, {
      address,
      chain: resolvedChain,
      has_attribution: hasEntity || hasPrediction,
      entity_name: source ? str(source.name ?? source.id) : null,
      // `type` is the Arkham entity category ("cex", "defi", ...).
      entity_category: source ? (str(source.type) ?? "").toLowerCase() || null : null,
      // `arkhamLabel.name` is the address's role ("Hot Wallet", "Deposit").
      address_role: str(slice?.arkhamLabel?.name),
      is_contract: Boolean(slice?.contract ?? false),
      tags: collectTags(slice),
      attribution_type: attributionType,
      attribution_confidence: confidence,
      risk_level: riskLevel == null ? null : riskLevel.toLowerCase(),
      max_risk_score: num(risk?.max_score),
      transaction_amount_usd: amountUsd,
      data_age_seconds: ageSecondsFrom(risk?.updated_at),
      timestamp: Date.now(),
    });
  } catch (e) {
    return wrapOutput(PACK_ID, { error: String(e) });
  }
}
