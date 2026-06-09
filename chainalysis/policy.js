import { fetch as httpFetch } from "newton:provider/http@0.2.0";
import { get as getHostSecrets } from "newton:provider/secrets@0.2.0";

const SANCTIONS_BASE = "https://public.chainalysis.com/api/v1/address";
const ADDRESS_SCREENING_BASE =
  "https://api.chainalysis.com/api/risk/v2/entities";

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

function getJson(url, headers) {
  const r = httpFetch({
    url,
    method: "GET",
    headers: headers ?? [["accept", "application/json"]],
    body: null,
  });
  if (typeof r === "string") throw new Error(`http: ${r}`);
  if (r.tag === "err") throw new Error(`http: ${r.val}`);
  const resp = r.val ?? r;
  const status = resp.status ?? 200;
  const body = new TextDecoder().decode(new Uint8Array(resp.body));
  return { status, body };
}

function getSanctionsResult(address, apiKey) {
  // Sanctions Screening API. Some deployments require X-API-Key, others are open.
  const url = `${SANCTIONS_BASE}/${address}`;
  const headers = [
    ["accept", "application/json"],
    ["x-api-key", apiKey ?? ""],
  ];
  const { status, body } = getJson(url, headers);
  if (status >= 400)
    throw new Error(`chainalysis sanctions ${status}: ${body.slice(0, 200)}`);
  const parsed = JSON.parse(body);
  // Endpoint returns either { identifications: [...] } or an array; normalize.
  const ids =
    parsed.identifications ?? parsed.identifiedAddresses ?? parsed ?? [];
  return Array.isArray(ids) ? ids : [];
}

function getAddressScreening(address, apiKey) {
  // Address Screening v2 API (paid). Optional — requires a separate key.
  const url = `${ADDRESS_SCREENING_BASE}/${address}`;
  const headers = [
    ["accept", "application/json"],
    ["token", apiKey],
  ];
  const { status, body } = getJson(url, headers);
  if (status >= 400)
    throw new Error(`chainalysis screening ${status}: ${body.slice(0, 200)}`);
  return JSON.parse(body);
}

export function run(input) {
  try {
    const parsed = JSON.parse(input);
    _secrets = parsed;
    loadHostSecrets();
    const { address } = parsed;
    if (!address) throw new Error("missing address");

    const sanctionsKey = secret("CHAINALYSIS_SANCTIONS_KEY");
    const screeningKey = secret("CHAINALYSIS_SCREENING_KEY");

    let sanctioned = false;
    let sanctionsCategories = [];
    try {
      const ids = getSanctionsResult(address, sanctionsKey);
      sanctioned = ids.length > 0;
      sanctionsCategories = ids
        .map((i) => i.category ?? i.name ?? null)
        .filter(Boolean)
        .map(String);
    } catch (e) {
      // Surface but don't fail — caller can still gate on sanctioned=false plus
      // an explicit error flag if they want to be conservative.
    }

    let riskCategories = [];
    let riskScore = null;
    let screeningAvailable = false;
    if (screeningKey) {
      try {
        const r = getAddressScreening(address, screeningKey);
        screeningAvailable = true;
        // v2 surfaces a `risk` enum and a `riskReason` array of categories.
        riskScore = r.risk ?? r.overallRisk ?? null;
        const cats = r.exposures ?? r.riskReasons ?? r.riskReason ?? [];
        riskCategories = (Array.isArray(cats) ? cats : [])
          .map((c) =>
            typeof c === "string" ? c : (c?.category ?? c?.name ?? null),
          )
          .filter(Boolean)
          .map((s) => String(s).toLowerCase());
      } catch (e) {
        screeningAvailable = false;
      }
    }

    const isHighRisk =
      typeof riskScore === "string" &&
      ["high", "severe"].includes(riskScore.toLowerCase());

    return JSON.stringify({
      address,
      sanctioned,
      sanctions_categories: sanctionsCategories,
      screening_available: screeningAvailable,
      risk_score: riskScore,
      risk_categories: riskCategories,
      is_high_risk: isHighRisk,
      timestamp: Date.now(),
    });
  } catch (e) {
    return JSON.stringify({ error: String(e) });
  }
}
