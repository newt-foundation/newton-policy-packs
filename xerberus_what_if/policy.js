import { fetch as httpFetch } from "newton:provider/http@0.2.0";
import { get as getHostSecrets } from "newton:provider/secrets@0.2.0";

// Phase 0 § Stream B (NEWT-1539): pack-side namespacing. Keep PACK_ID in sync
// with the folder name and metadata.ts PACK_NAME.
const PACK_ID = "xerberus_what_if";

function wrapOutput(packId, valueOrError) {
  const out = JSON.stringify({ [packId]: valueOrError });
  return out;
}

// Xerberus exposes its risk functions as MCP tools over JSON-RPC 2.0, not as
// REST paths: every call is a `tools/call` POST to this one endpoint.
const XERBERUS_MCP = "https://mcp.xerberus.io/enterprise/mcp";
const TOOL = "what_if";

// Stay under the host's ~1 MiB WASM HTTP limit and the ~1.14 MB JSON.parse
// ceiling that traps the component. A trap is worse than a deny, so throw.
const MAX_BODY_BYTES = 900 * 1024;

// The only chain Xerberus scores today.
const SUPPORTED_CHAINS = new Set(["ethereum"]);

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

// --- MCP transport (identical across the xerberus_* packs) -----------------

let _rpcId = 0;

function headerValue(headers, name) {
  for (const [k, v] of headers ?? []) {
    if (String(k).toLowerCase() === name) return String(v);
  }
  return null;
}

// Streamable-HTTP MCP servers may answer a POST with a single-shot SSE stream
// instead of a JSON body. The host hands us the whole buffered body, so split
// it into events and pick the JSON-RPC response carrying our request id.
function parseSse(text, id) {
  const messages = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data) continue;
    try {
      messages.push(JSON.parse(data));
    } catch (_) {
      // Keep-alive or non-JSON event — not our response.
    }
  }
  return messages.find((m) => m?.id === id) ?? null;
}

function toolText(result) {
  const content = Array.isArray(result?.content) ? result.content : [];
  return content
    .filter((c) => c?.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("");
}

// Prefer `structuredContent`; otherwise the tool's JSON lives in its text
// content blocks. FastMCP-style servers wrap non-object outputs as
// `{"result": ...}`, so unwrap that single-key envelope too.
function toolPayload(result) {
  const sc = result?.structuredContent;
  if (sc && typeof sc === "object") {
    const keys = Object.keys(sc);
    if (keys.length === 1 && keys[0] === "result" && sc.result && typeof sc.result === "object") {
      return sc.result;
    }
    return sc;
  }
  const text = toolText(result);
  if (!text) throw new Error("xerberus: tool returned no content");
  try {
    return JSON.parse(text);
  } catch (_) {
    throw new Error(`xerberus: tool returned non-JSON text: ${text.slice(0, 200)}`);
  }
}

function callTool(name, args, apiKey) {
  const id = ++_rpcId;
  const body = new TextEncoder().encode(
    JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }),
  );
  const r = httpFetch({
    url: XERBERUS_MCP,
    method: "POST",
    headers: [
      ["accept", "application/json, text/event-stream"],
      ["content-type", "application/json"],
      ["x-api-key", apiKey],
    ],
    body,
  });
  if (typeof r === "string") throw new Error(`http: ${r}`);
  if (r.tag === "err") throw new Error(`http: ${r.val}`);
  const resp = r.val ?? r;
  const status = resp.status ?? 200;
  const bytes = resp.body ?? [];
  if (bytes.length > MAX_BODY_BYTES) {
    throw new Error(`xerberus ${name}: response too large (${bytes.length} bytes)`);
  }
  const text = new TextDecoder().decode(new Uint8Array(bytes));
  // The host returns Ok for every HTTP status. Without this check an error
  // body could parse cleanly and be read as data.
  if (status < 200 || status >= 300) {
    throw new Error(`xerberus ${name} http ${status}: ${text.slice(0, 200)}`);
  }

  const contentType = (headerValue(resp.headers, "content-type") ?? "").toLowerCase();
  let msg;
  if (contentType.includes("text/event-stream") || /^\s*(event|data|id):/.test(text)) {
    msg = parseSse(text, id);
  } else {
    try {
      msg = JSON.parse(text);
    } catch (_) {
      throw new Error(`xerberus ${name}: invalid json: ${text.slice(0, 200)}`);
    }
  }
  if (!msg || typeof msg !== "object") throw new Error(`xerberus ${name}: no JSON-RPC response`);
  if (msg.error) {
    throw new Error(`xerberus ${name} rpc: ${msg.error.message ?? JSON.stringify(msg.error)}`);
  }
  const result = msg.result;
  if (!result || typeof result !== "object") throw new Error(`xerberus ${name}: missing result`);
  if (result.isError) {
    throw new Error(`xerberus ${name} tool error: ${toolText(result).slice(0, 200)}`);
  }
  return toolPayload(result);
}

// --- input + normalisation helpers ------------------------------------------

function num(x) {
  if (x == null) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function str(x) {
  if (x == null) return null;
  return typeof x === "string" ? x : String(x);
}

// Token contract addresses are canonicalised to lowercase so Rego can match
// them against the intent. Symbols are passed through (Xerberus accepts them)
// but cannot be bound to an intent — prefer addresses in production.
function normaliseToken(value) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`invalid token: ${String(value)}`);
  const t = value.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(t)) return t.toLowerCase();
  if (t.startsWith("0x") || t.length > 32) throw new Error(`invalid token: ${t}`);
  return t;
}

function optionalPositive(value, label, max) {
  if (value == null) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || (max != null && n > max)) throw new Error(`invalid ${label}: ${String(value)}`);
  return n;
}

function normaliseChain(value) {
  const chain = value == null ? "ethereum" : String(value).toLowerCase();
  if (!SUPPORTED_CHAINS.has(chain)) throw new Error(`unsupported chain: ${chain}`);
  return chain;
}

function normaliseWindow(value) {
  if (value == null) return undefined;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error(`invalid window: ${String(value)}`);
  }
  return value;
}

function ageSecondsFrom(value) {
  if (value == null) return null;
  const ms = Date.parse(String(value));
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.floor((Date.now() - ms) / 1000));
}

// null when no window was requested; otherwise whether Xerberus answered from
// the window we pinned. Compared as instants, so `+00:00` and `Z` agree.
function windowHonored(requested, returned) {
  if (requested == null) return null;
  if (returned == null) return false;
  return Date.parse(requested) === Date.parse(returned);
}

const MAX_WALLETS = 10;
const MAX_CHANGES = 10;
const MAX_ISSUES = 10;

function normaliseAddress(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`invalid ${label}: ${String(value)}`);
  }
  return value.toLowerCase();
}

function normaliseWallets(value) {
  if (!Array.isArray(value) || value.length === 0) throw new Error("missing wallets");
  if (value.length > MAX_WALLETS) throw new Error(`too many wallets: ${value.length} > ${MAX_WALLETS}`);
  const out = [];
  for (const w of value) {
    const addr = normaliseAddress(w, "wallet");
    if (!out.includes(addr)) out.push(addr);
  }
  return out;
}

function normaliseChanges(value, label) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`invalid ${label}: expected an array`);
  if (value.length > MAX_CHANGES) throw new Error(`too many ${label} entries: ${value.length} > ${MAX_CHANGES}`);
  return value.map((c, i) => {
    const usd = optionalPositive(c?.usd, `${label}[${i}].usd`);
    if (usd == null) throw new Error(`missing ${label}[${i}].usd`);
    return { token: normaliseToken(c?.token), usd };
  });
}

function sameToken(a, b) {
  return a != null && b != null && String(a).toLowerCase() === String(b).toLowerCase();
}

function positions(state) {
  return Array.isArray(state?.top_positions) ? state.top_positions : [];
}

// Share of book in percent. Derived from `usd / book_usd` when both are
// present so the unit never depends on whether Xerberus reports `pct` as a
// fraction or a percentage; falls back to the reported `pct`.
function sharePct(position, bookUsd) {
  const usd = num(position?.usd);
  if (usd != null && bookUsd != null && bookUsd > 0) return (usd / bookUsd) * 100;
  return num(position?.pct);
}

function largestPosition(state) {
  const book = num(state?.book_usd);
  let best = null;
  for (const p of positions(state)) {
    const pct = sharePct(p, book);
    if (pct == null) continue;
    if (best == null || pct > best.pct) best = { token: str(p?.token), pct };
  }
  return best;
}

// The same token's share before the change. A token outside the reported top
// positions reads as 0, which can only make the change look MORE
// concentrating — the conservative direction.
function shareOf(state, token) {
  const book = num(state?.book_usd);
  for (const p of positions(state)) {
    if (sameToken(p?.token, token)) return sharePct(p, book) ?? 0;
  }
  return 0;
}

function ladder30d(state) {
  return num(state?.ladder_pct_of_book?.["30d"]);
}

function diff(delta, after, before) {
  if (delta != null) return delta;
  if (after == null || before == null) return null;
  return after - before;
}

function isEmpty(x) {
  if (x == null || x === false || x === "") return true;
  if (Array.isArray(x)) return x.length === 0;
  if (typeof x === "object") return Object.keys(x).length === 0;
  return false;
}

// `issues` is untyped in the tool contract. Flatten whatever arrives into a
// short list of strings; empty containers are not issues.
function issuesList(issues) {
  if (isEmpty(issues)) return [];
  let items;
  if (Array.isArray(issues)) {
    items = issues.filter((x) => !isEmpty(x)).map((x) => (typeof x === "string" ? x : JSON.stringify(x)));
  } else if (typeof issues === "object") {
    items = Object.entries(issues)
      .filter(([, value]) => !isEmpty(value))
      .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
  } else {
    items = [String(issues)];
  }
  return items.map((s) => s.slice(0, 200));
}

export function run(input) {
  try {
    const parsed = JSON.parse(input);
    const myArgs = parsed[PACK_ID] ?? parsed;
    _secrets = { ...parsed };
    delete _secrets[PACK_ID];
    loadHostSecrets();

    const wallets = normaliseWallets(myArgs.wallets);
    const add = normaliseChanges(myArgs.add, "add");
    const remove = normaliseChanges(myArgs.remove, "remove");
    if (add.length === 0 && remove.length === 0) throw new Error("what_if needs at least one add or remove");
    const impactPct = optionalPositive(myArgs.impact_pct, "impact_pct", 100);
    const chain = normaliseChain(myArgs.chain);
    const window = normaliseWindow(myArgs.window);

    const apiKey = secret("XERBERUS_API_KEY");
    if (!apiKey) throw new Error("missing XERBERUS_API_KEY");

    const args = { wallets, add, remove, chain };
    if (impactPct != null) args.impact_pct = impactPct;
    if (window != null) args.window = window;

    const w = callTool(TOOL, args, apiKey);
    const before = w?.before;
    const after = w?.after;
    const delta = w?.delta;
    const dataWindow = str(w?.data_window ?? w?.window);

    const largest = largestPosition(after);
    const hhiBefore = num(before?.token_hhi);
    const hhiAfter = num(after?.token_hhi);
    const ladderBefore = ladder30d(before);
    const ladderAfter = ladder30d(after);
    const slowestBefore = num(before?.slowest_token_days);
    const slowestAfter = num(after?.slowest_token_days);
    const issues = issuesList(w?.issues);

    return wrapOutput(PACK_ID, {
      wallets,
      chain,
      add,
      remove,
      is_risk_reducing: add.length === 0 && remove.length > 0,
      book_usd_before: num(before?.book_usd),
      book_usd_after: num(after?.book_usd),
      post_largest_token: largest?.token ?? null,
      post_largest_token_pct: largest?.pct ?? null,
      pre_largest_token_pct: largest ? shareOf(before, largest.token) : null,
      hhi_before: hhiBefore,
      hhi_after: hhiAfter,
      hhi_delta: diff(num(delta?.token_hhi), hhiAfter, hhiBefore),
      ladder_30d_before_pct: ladderBefore,
      ladder_30d_after_pct: ladderAfter,
      ladder_30d_delta_pp: diff(num(delta?.ladder_pp?.["30d"]), ladderAfter, ladderBefore),
      slowest_exit_days_before: slowestBefore,
      slowest_exit_days_after: slowestAfter,
      slowest_exit_delta_days: diff(num(delta?.slowest_token_days), slowestAfter, slowestBefore),
      issues: issues.slice(0, MAX_ISSUES),
      issues_count: issues.length,
      requested_window: window ?? null,
      data_window: dataWindow,
      window_honored: windowHonored(window, dataWindow),
      is_stale: typeof w?.is_stale === "boolean" ? w.is_stale : null,
      data_age_seconds: ageSecondsFrom(dataWindow),
      timestamp: Date.now(),
    });
  } catch (e) {
    return wrapOutput(PACK_ID, { error: String(e) });
  }
}
