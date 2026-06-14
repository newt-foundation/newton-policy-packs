import { fetch as httpFetch } from "newton:provider/http@0.2.0";
import { get as getHostSecrets } from "newton:provider/secrets@0.2.0";

// Phase 0 § Stream B (NEWT-1539): pack-side namespacing. Inlined `PACK_ID`
// and `wrapOutput` mirror @newton-xyz/policy-pack-shared/src/wrap.ts —
// `policy.js` is fed straight to `jco componentize` with only the
// `newton:provider/*` host imports wired. See vaultsfyi PR #41 for the
// canonical pattern. PACK_ID drift is enforced at `pnpm test` time by
// packages/policy-pack-persona/src/pack-id.test.ts. Note: persona has
// THREE return paths (early no-inquiry, success, catch) — every one is
// wrapped via wrapOutput.
const PACK_ID = "persona";

function wrapOutput(packId, valueOrError) {
  const out = JSON.stringify({ [packId]: valueOrError });
  return out;
}

const PERSONA_BASE = "https://api.withpersona.com/api/v1";
const PERSONA_VERSION = "2023-01-05";

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

function getJson(url) {
  const apiKey = secret("PERSONA_API_KEY");
  const r = httpFetch({
    url,
    method: "GET",
    headers: [
      ["accept", "application/json"],
      ["authorization", `Bearer ${apiKey}`],
      ["persona-version", PERSONA_VERSION],
    ],
    body: null,
  });
  if (typeof r === "string") throw new Error(`http: ${r}`);
  if (r.tag === "err") throw new Error(`http: ${r.val}`);
  const resp = r.val ?? r;
  const body = new TextDecoder().decode(new Uint8Array(resp.body));
  return JSON.parse(body);
}

function listInquiriesByReference(walletAddress) {
  const url =
    `${PERSONA_BASE}/inquiries` +
    `?filter[reference-id]=${encodeURIComponent(walletAddress)}` +
    `&page[size]=10`;
  return getJson(url);
}

function getInquiry(id) {
  const url = `${PERSONA_BASE}/inquiries/${encodeURIComponent(id)}?include=verifications`;
  return getJson(url);
}

const APPROVED_STATUSES = new Set(["approved", "completed"]);

function pickLatestApproved(listResponse) {
  const items = Array.isArray(listResponse?.data) ? listResponse.data : [];
  const approved = items.filter((it) => {
    const s = it?.attributes?.status;
    return typeof s === "string" && APPROVED_STATUSES.has(s);
  });
  if (approved.length === 0) return null;
  // Most recent by completed-at, falling back to updated-at, then created-at.
  approved.sort((a, b) => {
    const aT = a?.attributes?.["completed-at"] ?? a?.attributes?.["updated-at"] ?? a?.attributes?.["created-at"] ?? "";
    const bT = b?.attributes?.["completed-at"] ?? b?.attributes?.["updated-at"] ?? b?.attributes?.["created-at"] ?? "";
    if (aT === bT) return 0;
    return aT < bT ? 1 : -1;
  });
  return approved[0];
}

function ageDaysFrom(isoString) {
  if (typeof isoString !== "string" || isoString.length === 0) return null;
  const t = Date.parse(isoString);
  if (!Number.isFinite(t)) return null;
  const ms = Date.now() - t;
  if (ms < 0) return 0;
  return ms / (1000 * 60 * 60 * 24);
}

function ageYearsFromBirthdate(birthdate) {
  // Persona returns birthdate as "YYYY-MM-DD".
  if (typeof birthdate !== "string" || birthdate.length === 0) return null;
  const t = Date.parse(birthdate);
  if (!Number.isFinite(t)) return null;
  const now = Date.now();
  const ms = now - t;
  if (ms < 0) return 0;
  // Average Gregorian year length to avoid leap-year-edge off-by-one.
  return ms / (1000 * 60 * 60 * 24 * 365.2425);
}

function findVerification(included, slug) {
  if (!Array.isArray(included)) return null;
  for (const v of included) {
    if (v?.type === slug) return v;
  }
  return null;
}

export function run(input) {
  try {
    const parsed = JSON.parse(input);
    // Phase 0 § Stream B input-unwrap shim. AVS forwards one `wasm_args`
    // blob to every PolicyData WASM in a policy. Composite execution
    // produces `{ persona: {...}, vaultsfyi: {...} }`; nullish coalescing
    // reads our slice when present, falls back to flat for legacy
    // single-pack callers.
    const myArgs = parsed[PACK_ID] ?? parsed;
    const { walletAddress } = myArgs;
    // Strip our own slot from `_secrets` so it can't shadow a same-named
    // host secret. Sibling pack slots are intentionally left in place —
    // `secret(name)` only reads fixed named keys (e.g. `PERSONA_API_KEY`).
    _secrets = { ...parsed };
    delete _secrets[PACK_ID];
    loadHostSecrets();

    if (typeof walletAddress !== "string" || walletAddress.length === 0) {
      throw new Error("walletAddress is required");
    }

    const list = listInquiriesByReference(walletAddress);
    const latest = pickLatestApproved(list);

    if (!latest) {
      return wrapOutput(PACK_ID, {
        has_inquiry: false,
        status: null,
        age_days: null,
        country_code: null,
        age_years: null,
        government_id_status: null,
        selfie_status: null,
        watchlist_status: null,
        inquiry_id: null,
        timestamp: Date.now(),
      });
    }

    const detail = getInquiry(latest.id);
    const attrs = detail?.data?.attributes ?? {};
    const included = detail?.included ?? [];

    // Country code precedence:
    //   1. attributes["country-code"] (top-level country on the inquiry)
    //   2. attributes["address-country-code"] (resolved address country)
    //   3. attributes["country-of-birth"] (last-resort identity-doc origin)
    const countryCode =
      attrs["country-code"] ??
      attrs["address-country-code"] ??
      attrs["country-of-birth"] ??
      null;

    const completedAt = attrs["completed-at"] ?? attrs["updated-at"] ?? null;
    const ageDays = ageDaysFrom(completedAt);
    const ageYears = ageYearsFromBirthdate(attrs["birthdate"]);

    const govId = findVerification(included, "verification/government-id");
    const selfie = findVerification(included, "verification/selfie");
    const watchlist = findVerification(included, "verification/watchlist");

    return wrapOutput(PACK_ID, {
      has_inquiry: true,
      status: attrs.status ?? null,
      age_days: ageDays,
      country_code: countryCode,
      age_years: ageYears,
      government_id_status: govId?.attributes?.status ?? null,
      selfie_status: selfie?.attributes?.status ?? null,
      watchlist_status: watchlist?.attributes?.status ?? null,
      inquiry_id: detail?.data?.id ?? latest.id,
      timestamp: Date.now(),
    });
  } catch (e) {
    return wrapOutput(PACK_ID, { error: String(e) });
  }
}
