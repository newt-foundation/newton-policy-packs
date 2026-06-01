import { fetch as httpFetch } from "newton:provider/http@0.1.0";

const PERSONA_BASE = "https://api.withpersona.com/api/v1";
const PERSONA_VERSION = "2023-01-05";

let _secrets = {};

function secret(name) {
  if (typeof getSecret === "function") return getSecret(name);
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
    const { walletAddress } = parsed;
    _secrets = parsed;

    if (typeof walletAddress !== "string" || walletAddress.length === 0) {
      throw new Error("walletAddress is required");
    }

    const list = listInquiriesByReference(walletAddress);
    const latest = pickLatestApproved(list);

    if (!latest) {
      return JSON.stringify({
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

    return JSON.stringify({
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
    return JSON.stringify({ error: String(e) });
  }
}
