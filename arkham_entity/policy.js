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

// Arkham returns per-chain results because the same address can carry
// different labels and activity on different networks. When the caller
// names a chain we take that slice; otherwise we take the first populated
// one and record which it was, so the Rego decision is traceable to a
// specific network rather than silently blending several.
function pickChainSlice(payload, chain) {
  if (!payload || typeof payload !== "object") return { slice: null, chain: null };
  if (chain && payload[chain]) return { slice: payload[chain], chain };
  const keys = Object.keys(payload);
  for (const k of keys) {
    const candidate = payload[k];
    if (candidate && typeof candidate === "object") return { slice: candidate, chain: k };
  }
  return { slice: payload, chain: chain ?? null };
}

function collectTags(slice) {
  const out = [];
  const seen = new Set();
  const raw = Array.isArray(slice?.populatedTags)
    ? slice.populatedTags
    : Array.isArray(slice?.tags)
      ? slice.tags
      : [];
  for (const t of raw) {
    const name = typeof t === "string" ? t : str(t?.id ?? t?.name ?? t?.tag);
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
    // Phase 0 § Stream B input-unwrap shim. The AVS forwards one
    // `wasm_args` blob to every PolicyData WASM in a policy, so composite
    // execution produces `{ arkham_entity: {...}, pharos_treasury: {...} }`
    // and each pack reads its own slice via the namespaced key. Nullish
    // coalescing falls back to flat for single-pack callers. Mirrors
    // ADR 0003's `args[PACK_ID] ?? args` shape verbatim.
    const myArgs = parsed[PACK_ID] ?? parsed;
    // Strip our own slot from `_secrets` so it can't shadow a same-named
    // host secret. Sibling pack slots are left in place — `secret(name)`
    // only reads fixed named keys.
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

    // Arkham distinguishes a verified label from a probabilistic entity
    // prediction. Treat only a real entity match as attribution; a
    // prediction is reported but carries its own lower confidence, which
    // the Rego gates on separately.
    const entity = slice?.entity ?? null;
    const prediction = slice?.entityPrediction ?? slice?.prediction ?? null;
    const hasEntity = Boolean(entity && (entity.name ?? entity.id));
    const hasPrediction = Boolean(prediction && (prediction.name ?? prediction.id));

    let attributionType = "none";
    if (hasEntity) attributionType = "verified";
    else if (hasPrediction) attributionType = "predicted";

    const source = hasEntity ? entity : hasPrediction ? prediction : null;
    const confidence = hasEntity
      ? (num(entity.confidence) ?? 1)
      : hasPrediction
        ? num(prediction.confidence)
        : null;

    const updatedAt = num(risk?.updated_at ?? risk?.updatedAt);
    const dataAgeSeconds =
      updatedAt == null ? null : Math.max(0, Math.floor(Date.now() / 1000 - updatedAt));

    return wrapOutput(PACK_ID, {
      address,
      chain: resolvedChain,
      has_attribution: hasEntity || hasPrediction,
      entity_name: source ? str(source.name ?? source.id) : null,
      entity_category: source ? str(source.type ?? source.category) : null,
      address_role: str(slice?.addressType ?? slice?.role ?? slice?.label),
      tags: collectTags(slice),
      attribution_type: attributionType,
      attribution_confidence: confidence,
      risk_level: str(risk?.risk_level ?? risk?.riskLevel),
      max_risk_score: num(risk?.max_score ?? risk?.maxScore),
      transaction_amount_usd: amountUsd,
      data_age_seconds: dataAgeSeconds,
      timestamp: Date.now(),
    });
  } catch (e) {
    return wrapOutput(PACK_ID, { error: String(e) });
  }
}
