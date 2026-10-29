import { fetch as httpFetch } from "newton:provider/http@0.2.0";
import { get as getHostSecrets } from "newton:provider/secrets@0.2.0";

// Phase 0 § Stream B (NEWT-1539): pack-side namespacing. Keep PACK_ID in sync
// with the folder name and metadata.ts PACK_NAME.
const PACK_ID = "xerberus_liquidity_exit";

function wrapOutput(packId, valueOrError) {
  const out = JSON.stringify({ [packId]: valueOrError });
  return out;
}

// Xerberus exposes its risk functions as MCP tools over JSON-RPC 2.0, not as
// REST paths: every call is a `tools/call` POST to this one endpoint.
const XERBERUS_MCP = "https://mcp.xerberus.io/mcp";
const TOOL = "liquidity_exit_quote";

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

const OK_STATUSES = new Set(["scored", "ok"]);

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
  const payload = toolPayload(result);
  // Refusals (bad_request, retired, not_covered, unknown_subject, ...) come
  // back as ordinary results carrying `status: {value, cause}`. Only a scored
  // answer, or one with no status at all, is data.
  const st = payload?.status;
  if (st && typeof st === "object" && st.value != null && !OK_STATUSES.has(st.value)) {
    throw new Error(`xerberus ${name} ${st.value}: ${String(st.cause ?? "").slice(0, 200)}`);
  }
  return payload;
}

// Freshness lives in its own block; `window` is a timestamp on some tools and
// a `{start, latest}` object on others, so prefer `freshness.window`.
function freshnessOf(payload) {
  const f = payload?.freshness ?? {};
  const w = payload?.window;
  const top = typeof w === "string" ? w : w?.start;
  return {
    window: str(f.window ?? top),
    latestWindow: str(f.latest_window),
    isStale: typeof f.is_stale === "boolean" ? f.is_stale : null,
  };
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

export function run(input) {
  try {
    const parsed = JSON.parse(input);
    const myArgs = parsed[PACK_ID] ?? parsed;
    _secrets = { ...parsed };
    delete _secrets[PACK_ID];
    loadHostSecrets();

    const token = normaliseToken(myArgs.token);
    const usdNotional = optionalPositive(myArgs.usd_notional, "usd_notional");
    if (usdNotional == null) throw new Error("missing usd_notional");
    const impactPct = optionalPositive(myArgs.impact_pct, "impact_pct", 100);
    const chain = normaliseChain(myArgs.chain);
    const window = normaliseWindow(myArgs.window);

    const apiKey = secret("XERBERUS_API_KEY");
    if (!apiKey) throw new Error("missing XERBERUS_API_KEY");

    // The tool takes no chain argument; `chain` is validated above and echoed.
    const args = { token, usd_notional: usdNotional };
    if (impactPct != null) args.impact_pct = impactPct;
    if (window != null) args.window = window;

    const q = callTool(TOOL, args, apiKey);
    const fresh = freshnessOf(q);

    return wrapOutput(PACK_ID, {
      token,
      symbol: str(q?.symbol),
      chain,
      notional_usd: num(q?.notional_usd) ?? usdNotional,
      impact_band_pct: num(q?.impact_band_pct),
      max_sale_per_day_usd: num(q?.max_sale_per_day_usd),
      // The DEX floor: selling on-chain inside the impact band. Kept as the
      // gated figure because it needs no protocol cooperation; the faster
      // native routes are reported beside it.
      days_to_exit: num(q?.days_to_exit),
      exit_horizon: str(q?.exit_horizon),
      fastest_route: str(q?.fastest_route ?? q?.headline?.route),
      fastest_days_to_exit: num(q?.headline?.days_to_exit),
      redemption_route_status: str(q?.redemption_route?.status),
      redemption_days_to_exit: num(q?.redemption?.days_to_exit_redemption),
      cex_status: str(q?.cex?.status),
      requested_window: window ?? null,
      data_window: fresh.window,
      latest_window: fresh.latestWindow,
      window_honored: windowHonored(window, fresh.window),
      is_stale: fresh.isStale,
      data_age_seconds: ageSecondsFrom(fresh.window),
      timestamp: Date.now(),
    });
  } catch (e) {
    return wrapOutput(PACK_ID, { error: String(e) });
  }
}
