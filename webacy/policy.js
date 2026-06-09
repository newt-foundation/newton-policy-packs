import { fetch as httpFetch } from "newton:provider/http@0.2.0";
import { get as getHostSecrets } from "newton:provider/secrets@0.2.0";

const WEBACY_BASE = "https://api.webacy.com";

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
  const apiKey = secret("WEBACY_API_KEY");
  const r = httpFetch({
    url,
    method: "GET",
    headers: [
      ["accept", "application/json"],
      ["x-api-key", apiKey ?? ""],
    ],
    body: null,
  });
  if (typeof r === "string") throw new Error(`http: ${r}`);
  if (r.tag === "err") throw new Error(`http: ${r.val}`);
  const resp = r.val ?? r;
  const body = new TextDecoder().decode(new Uint8Array(resp.body));
  return JSON.parse(body);
}

function getAddressRisk(address, chain) {
  const url = `${WEBACY_BASE}/addresses/${address}${chain ? `?chain=${encodeURIComponent(chain)}` : ""}`;
  return getJson(url);
}

function tagsOfIssue(issue) {
  // Webacy issues have varied between `tags` (array of strings) and a `categories`
  // / `tag` shape across API versions. Normalize defensively.
  if (Array.isArray(issue?.tags)) return issue.tags.map((t) => String(t).toLowerCase());
  if (Array.isArray(issue?.categories)) return issue.categories.map((t) => String(t).toLowerCase());
  if (typeof issue?.tag === "string") return [issue.tag.toLowerCase()];
  if (typeof issue?.category === "string") return [issue.category.toLowerCase()];
  return [];
}

function bucket(score, hasSanctions) {
  if (hasSanctions) return "sanctioned";
  if (score > 50) return "high";
  if (score > 23) return "medium";
  return "low";
}

export function run(input) {
  try {
    const parsed = JSON.parse(input);
    _secrets = parsed;
    loadHostSecrets();
    const { address, chain } = parsed;
    if (!address) throw new Error("missing address");

    const result = getAddressRisk(address, chain);

    // The DD score has lived under multiple field names across Webacy versions.
    const score = Number(
      result.medium ??
        result.overallRisk ??
        result.ddScore ??
        result.score ??
        0,
    );

    const issues = Array.isArray(result.issues) ? result.issues : [];
    const allTags = issues.flatMap(tagsOfIssue);

    const sanctionsHits = issues.filter((i) =>
      tagsOfIssue(i).some((t) => /sanction|ofac|blocklist/.test(t)),
    ).length;
    const exploitExposureHits = issues.filter((i) =>
      tagsOfIssue(i).some((t) => /exploit|hack|drainer|stolen/.test(t)),
    ).length;

    const b = bucket(score, sanctionsHits > 0);

    return JSON.stringify({
      address,
      chain: chain ?? null,
      dd_score: score,
      bucket: b,
      sanctions_hits: sanctionsHits,
      exploit_exposure_hits: exploitExposureHits,
      flag_count: issues.length,
      flag_categories: Array.from(new Set(allTags)).sort(),
      timestamp: Date.now(),
    });
  } catch (e) {
    return JSON.stringify({ error: String(e) });
  }
}
