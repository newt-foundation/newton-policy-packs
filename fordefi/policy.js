import { fetch as httpFetch } from "newton:provider/http@0.2.0";
import { get as getHostSecrets } from "newton:provider/secrets@0.2.0";

const PACK_ID = "fordefi";

function wrapOutput(packId, valueOrError) {
  const out = JSON.stringify({ [packId]: valueOrError });
  return out;
}

const FORDEFI_BASE = "https://newton-fordefi-mock.vercel.app/api/v1/transactions/";

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
  const apiKey = secret("FORDEFI_API_KEY");
  const r = httpFetch({
    url,
    method: "GET",
    headers: headers ?? [["accept", "application/json"], ["x-api-key", apiKey ?? ""]],
    body: null,
  });
  if (typeof r === "string") throw new Error(`http: ${r}`);
  if (r.tag === "err") throw new Error(`http: ${r.val}`);
  const resp = r.val ?? r;
  const body = new TextDecoder().decode(new Uint8Array(resp.body));
  return JSON.parse(body);
}

export function run(input) {
  try {
    const parsed = JSON.parse(input);
    // Phase 0 § Stream B input-unwrap shim. AVS forwards one `wasm_args`
    // blob to every PolicyData WASM in a policy. Composite execution
    // produces `{ redstone: {...}, vaultsfyi: {...} }`; nullish
    // coalescing reads our slice when present, falls back to flat for
    // legacy single-pack callers.
    const myArgs = parsed[PACK_ID] ?? parsed;
    // Strip our own slot from `_secrets` so it can't shadow a same-named
    // host secret. Sibling pack slots are intentionally left in place.
    _secrets = { ...parsed };
    delete _secrets[PACK_ID];
    loadHostSecrets();
    const { transactionId } = myArgs;

    if (!transactionId) throw new Error("missing transactionId");

    const transaction = getJson(`${FORDEFI_BASE}${transactionId}`);

    return wrapOutput(PACK_ID, {
      ...transaction
    });
  } catch (e) {
    return wrapOutput(PACK_ID, { error: String(e) });
  }
}
