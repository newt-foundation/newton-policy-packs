import { fetch as httpFetch } from "newton:provider/http@0.2.0";
import { get as getHostSecrets } from "newton:provider/secrets@0.2.0";

// Phase 0 § Stream B (NEWT-1539): pack-side namespacing. Keep PACK_ID in sync
// with the folder name and metadata.ts PACK_NAME.
const PACK_ID = "xerberus_common_cause";

function wrapOutput(packId, valueOrError) {
  const out = JSON.stringify({ [packId]: valueOrError });
  return out;
}

// Xerberus exposes its risk functions as MCP tools over JSON-RPC 2.0, not as
// REST paths: every call is a `tools/call` POST to this one endpoint.
const XERBERUS_MCP = "https://mcp.xerberus.io/enterprise/mcp";
const TOOL = "common_cause";

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
const MAX_SUBJECTS = 25;
const MAX_ENTRIES = 25;

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

function list(x) {
  return Array.isArray(x) ? x : [];
}

function lower(x) {
  const s = str(x);
  return s == null ? null : s.toLowerCase();
}

// Largest first, then capped: the Rego only ever needs the biggest entries,
// and an unbounded array risks the large-object crash in the component.
function topBy(items, key, limit) {
  return items.sort((a, b) => (b[key] ?? 0) - (a[key] ?? 0)).slice(0, limit);
}

function maxOf(items, key) {
  let best = null;
  for (const it of items) {
    const n = it[key];
    if (n != null && (best == null || n > best)) best = n;
  }
  return best;
}

export function run(input) {
  try {
    const parsed = JSON.parse(input);
    const myArgs = parsed[PACK_ID] ?? parsed;
    _secrets = { ...parsed };
    delete _secrets[PACK_ID];
    loadHostSecrets();

    const wallets = normaliseWallets(myArgs.wallets);
    const chain = normaliseChain(myArgs.chain);
    const window = normaliseWindow(myArgs.window);

    const apiKey = secret("XERBERUS_API_KEY");
    if (!apiKey) throw new Error("missing XERBERUS_API_KEY");

    const args = { wallets, chain };
    if (window != null) args.window = window;

    const c = callTool(TOOL, args, apiKey);
    const dataWindow = str(c?.data_window ?? c?.window);

    const subjects = list(c?.subjects_compared).map((s) => ({
      subject: str(s?.subject),
      scored: s?.scored === true,
      exposure_usd: num(s?.exposure_usd) ?? 0,
    }));

    // Shared missing safeguards: the same absent protection (e.g. an oracle
    // price-deviation circuit breaker) across several venues, so one failure
    // hits them together.
    const gaps = list(c?.shared_missing_safeguards).map((g) => ({
      tag: str(g?.tag),
      failure_class: lower(g?.failure_class),
      subject_count: list(g?.subjects).length,
      combined_exposure_usd: num(g?.combined_exposure_usd) ?? 0,
    }));

    const dependencies = list(c?.shared_declared_dependencies).map((d) => ({
      target: lower(d?.target),
      connection_types: list(d?.connection_types).map(str).slice(0, 10),
      subject_count: list(d?.subjects).length,
    }));

    const collateral = list(c?.shared_collateral_tokens).map((t) => ({
      token: lower(t?.token),
      symbol: str(t?.symbol),
      subject_count: list(t?.subjects).length,
      combined_exposure_usd: num(t?.combined_exposure_usd) ?? 0,
    }));

    return wrapOutput(PACK_ID, {
      wallets,
      chain,
      subjects_compared_count: subjects.length,
      scored_subjects_count: subjects.filter((s) => s.scored).length,
      total_exposure_usd: subjects.reduce((sum, s) => sum + s.exposure_usd, 0),
      unscored_subjects: topBy(
        subjects.filter((s) => !s.scored),
        "exposure_usd",
        MAX_SUBJECTS,
      ).map(({ subject, exposure_usd }) => ({ subject, exposure_usd })),
      largest_shared_gap_exposure_usd: maxOf(gaps, "combined_exposure_usd") ?? 0,
      shared_gaps: topBy(gaps, "combined_exposure_usd", MAX_ENTRIES),
      shared_dependencies: topBy(dependencies, "subject_count", MAX_ENTRIES),
      largest_shared_collateral_exposure_usd: maxOf(collateral, "combined_exposure_usd") ?? 0,
      shared_collateral: topBy(collateral, "combined_exposure_usd", MAX_ENTRIES),
      basis: str(c?.basis),
      requested_window: window ?? null,
      data_window: dataWindow,
      window_honored: windowHonored(window, dataWindow),
      is_stale: typeof c?.is_stale === "boolean" ? c.is_stale : null,
      data_age_seconds: ageSecondsFrom(dataWindow),
      timestamp: Date.now(),
    });
  } catch (e) {
    return wrapOutput(PACK_ID, { error: String(e) });
  }
}
