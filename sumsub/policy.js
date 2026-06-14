import { fetch as httpFetch } from "newton:provider/http@0.2.0";
import { get as getHostSecrets } from "newton:provider/secrets@0.2.0";

// Phase 0 § Stream B (NEWT-1539): pack-side namespacing. Inlined `PACK_ID`
// and `wrapOutput` mirror @newton-xyz/policy-pack-shared/src/wrap.ts —
// see vaultsfyi PR #41 for the canonical pattern. PACK_ID drift enforced
// at `pnpm test` time. Note: sumsub has THREE return paths (early
// no-applicant, success, catch) — every one wrapped via wrapOutput.
const PACK_ID = "sumsub";

function wrapOutput(packId, valueOrError) {
  const out = JSON.stringify({ [packId]: valueOrError });
  return out;
}

const SUMSUB_BASE = "https://api.sumsub.com";

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

// ---------------------------------------------------------------------------
// SHA-256 (FIPS 180-4) + HMAC-SHA256 in pure JS.
//
// componentize-js does NOT reliably expose `crypto.subtle` or
// `crypto.createHmac`, and SumSub requires every request be HMAC-SHA256
// signed with the secret key. We implement both primitives here, inline,
// and run a self-test (RFC 4231 case 1) at module load. If the self-test
// fails the WASM throws on first invocation rather than silently signing
// requests with a broken HMAC.
// ---------------------------------------------------------------------------

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function rotr(x, n) {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

function sha256Bytes(bytes) {
  // Pre-processing: pad to 512-bit blocks.
  const len = bytes.length;
  const bitLen = len * 8;
  // 1 byte for 0x80, then enough zeros so total length % 64 == 56, then 8 bytes for length.
  const padLen = (56 - ((len + 1) % 64) + 64) % 64;
  const total = len + 1 + padLen + 8;
  const msg = new Uint8Array(total);
  msg.set(bytes, 0);
  msg[len] = 0x80;
  // Big-endian 64-bit length. JS bitwise ops are 32-bit so we split.
  const hi = Math.floor(bitLen / 0x100000000);
  const lo = bitLen >>> 0;
  msg[total - 8] = (hi >>> 24) & 0xff;
  msg[total - 7] = (hi >>> 16) & 0xff;
  msg[total - 6] = (hi >>> 8) & 0xff;
  msg[total - 5] = hi & 0xff;
  msg[total - 4] = (lo >>> 24) & 0xff;
  msg[total - 3] = (lo >>> 16) & 0xff;
  msg[total - 2] = (lo >>> 8) & 0xff;
  msg[total - 1] = lo & 0xff;

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  const w = new Array(64);
  for (let i = 0; i < total; i += 64) {
    for (let t = 0; t < 16; t++) {
      const j = i + t * 4;
      w[t] = ((msg[j] << 24) | (msg[j + 1] << 16) | (msg[j + 2] << 8) | msg[j + 3]) >>> 0;
    }
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;

    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[t] + w[t]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const mj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + mj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const hs = [h0, h1, h2, h3, h4, h5, h6, h7];
  for (let i = 0; i < 8; i++) {
    out[i * 4] = (hs[i] >>> 24) & 0xff;
    out[i * 4 + 1] = (hs[i] >>> 16) & 0xff;
    out[i * 4 + 2] = (hs[i] >>> 8) & 0xff;
    out[i * 4 + 3] = hs[i] & 0xff;
  }
  return out;
}

function hmacSha256Bytes(keyBytes, msgBytes) {
  const blockSize = 64;
  let k = keyBytes;
  if (k.length > blockSize) k = sha256Bytes(k);
  if (k.length < blockSize) {
    const padded = new Uint8Array(blockSize);
    padded.set(k, 0);
    k = padded;
  }
  const ipad = new Uint8Array(blockSize);
  const opad = new Uint8Array(blockSize);
  for (let i = 0; i < blockSize; i++) {
    ipad[i] = k[i] ^ 0x36;
    opad[i] = k[i] ^ 0x5c;
  }
  const inner = new Uint8Array(blockSize + msgBytes.length);
  inner.set(ipad, 0);
  inner.set(msgBytes, blockSize);
  const innerHash = sha256Bytes(inner);
  const outer = new Uint8Array(blockSize + innerHash.length);
  outer.set(opad, 0);
  outer.set(innerHash, blockSize);
  return sha256Bytes(outer);
}

function bytesToHex(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    const h = bytes[i].toString(16);
    s += h.length === 1 ? "0" + h : h;
  }
  return s;
}

function utf8(s) {
  return new TextEncoder().encode(s);
}

// RFC 4231 test case 1 — runs once at module load. If the HMAC implementation
// is broken we fail loud immediately rather than signing requests with bogus
// signatures that will be rejected (or worse, accepted) by SumSub.
(function selfTest() {
  const key = new Uint8Array(20);
  for (let i = 0; i < 20; i++) key[i] = 0x0b;
  const data = utf8("Hi There");
  const expected = "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7";
  const got = bytesToHex(hmacSha256Bytes(key, data));
  if (got !== expected) {
    throw new Error(`HMAC-SHA256 self-test failed: expected ${expected} got ${got}`);
  }
})();

// ---------------------------------------------------------------------------
// SumSub HTTP helper.
// ---------------------------------------------------------------------------

function sumsubGet(path) {
  const appToken = secret("SUMSUB_APP_TOKEN");
  const secretKey = secret("SUMSUB_SECRET_KEY");
  if (!appToken) throw new Error("missing SUMSUB_APP_TOKEN");
  if (!secretKey) throw new Error("missing SUMSUB_SECRET_KEY");

  const ts = Math.floor(Date.now() / 1000).toString();
  const method = "GET";
  const body = "";
  const toSign = ts + method + path + body;
  const sig = bytesToHex(hmacSha256Bytes(utf8(secretKey), utf8(toSign)));

  const r = httpFetch({
    url: SUMSUB_BASE + path,
    method,
    headers: [
      ["accept", "application/json"],
      ["x-app-token", appToken],
      ["x-app-access-sig", sig],
      ["x-app-access-ts", ts],
    ],
    body: null,
  });
  if (typeof r === "string") throw new Error(`http: ${r}`);
  if (r.tag === "err") throw new Error(`http: ${r.val}`);
  const resp = r.val ?? r;
  const text = new TextDecoder().decode(new Uint8Array(resp.body));
  // SumSub returns 404 (with a JSON error body) when no applicant exists for
  // the given externalUserId. Treat that specifically; surface other errors.
  if (resp.status === 404) return { __notFound: true, status: 404, body: text };
  if (resp.status >= 400) {
    throw new Error(`sumsub ${resp.status}: ${text}`);
  }
  return JSON.parse(text);
}

function getApplicantByExternalUserId(walletAddress) {
  const path = `/resources/applicants/-;externalUserId=${encodeURIComponent(walletAddress)}/one`;
  const res = sumsubGet(path);
  if (res && res.__notFound) return null;
  return res;
}

function getApplicantStatus(applicantId) {
  const path = `/resources/applicants/${encodeURIComponent(applicantId)}/status`;
  return sumsubGet(path);
}

function daysSince(isoOrEpoch) {
  if (isoOrEpoch == null) return null;
  let t;
  if (typeof isoOrEpoch === "number") {
    t = isoOrEpoch < 1e12 ? isoOrEpoch * 1000 : isoOrEpoch;
  } else {
    t = Date.parse(isoOrEpoch);
  }
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24));
}

function ageYearsFromDob(dob) {
  if (!dob) return null;
  const t = Date.parse(dob);
  if (!Number.isFinite(t)) return null;
  const ms = Date.now() - t;
  if (ms < 0) return null;
  return Math.floor(ms / (1000 * 60 * 60 * 24 * 365.25));
}

export function run(input) {
  try {
    const parsed = JSON.parse(input);
    // Phase 0 § Stream B input-unwrap shim. AVS forwards one `wasm_args`
    // blob to every PolicyData WASM in a policy. Composite execution
    // produces `{ sumsub: {...}, vaultsfyi: {...} }`; nullish coalescing
    // reads our slice when present, falls back to flat for legacy
    // single-pack callers.
    const myArgs = parsed[PACK_ID] ?? parsed;
    // Strip our own slot from `_secrets` so it can't shadow a same-named
    // host secret. Sibling pack slots are intentionally left in place.
    _secrets = { ...parsed };
    delete _secrets[PACK_ID];
    loadHostSecrets();
    const { walletAddress } = myArgs;
    if (!walletAddress) throw new Error("missing walletAddress");

    const applicant = getApplicantByExternalUserId(walletAddress);

    if (!applicant) {
      return wrapOutput(PACK_ID, {
        has_applicant: false,
        applicant_id: null,
        review_status: null,
        review_answer: null,
        applicant_age_days: null,
        country_code: null,
        age_years: null,
        timestamp: Date.now(),
      });
    }

    const applicantId = applicant.id ?? null;
    const info = applicant.info ?? {};
    const countryCode = info.country ?? null;
    const ageYears = ageYearsFromDob(info.dob);
    const applicantAgeDays = daysSince(applicant.createdAt);

    let reviewStatus = null;
    let reviewAnswer = null;
    if (applicantId) {
      const status = getApplicantStatus(applicantId);
      reviewStatus = status?.reviewStatus ?? null;
      reviewAnswer = status?.reviewResult?.reviewAnswer ?? null;
    }

    return wrapOutput(PACK_ID, {
      has_applicant: true,
      applicant_id: applicantId,
      review_status: reviewStatus,
      review_answer: reviewAnswer,
      applicant_age_days: applicantAgeDays,
      country_code: countryCode,
      age_years: ageYears,
      timestamp: Date.now(),
    });
  } catch (e) {
    return wrapOutput(PACK_ID, { error: String(e) });
  }
}
