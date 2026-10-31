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
const XERBERUS_MCP = "https://mcp.xerberus.io/mcp";
// `common_cause` is retired on /mcp. The book's venues are read from
// `get_positions` and handed to `shared_dependencies_nodes` as `market:<uid>`
// nodes; each shared upstream node is then priced by the venue USD behind it.
const POSITIONS_TOOL = "get_positions";
const SHARED_TOOL = "shared_dependencies_nodes";

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

// The enclave allows 10 HTTP calls per run: 9 get_positions + 1 shared_dependencies_nodes.
const MAX_WALLETS = 9;
// `shared_dependencies_nodes` takes 2 to 50 nodes.
const MAX_VENUES = 50;
// Xerberus's own dust floor for wallet expansion.
const DUST_USD = 100;
// Enough to return every shared node for a 50-venue book without truncation
// in practice (a 14-venue book shares ~120); the server caps top_k at 500.
const TOP_K = 200;
const ASSET_SIDES = new Set(["supply", "collateral"]);

// Every dependency family except DEX liquidity: `liquidity_venue` and
// `lp_constituent` edges point at the pools a token trades in, which carry no
// loss rate and would otherwise fill the ranking ahead of oracles, issuers and
// governance.
const DEP_TYPES = [
  "wrapper",
  "lp_constituent",
  "collateral",
  "vault_alloc",
  "leverage_loop",
  "backing",
  "liquidity_venue",
  "runs_on",
  "issuer",
  "irm",
  "oracle",
  "operates",
  "governance",
  "obligor",
];
const DEFAULT_RELATIONS = DEP_TYPES.filter((r) => r !== "liquidity_venue" && r !== "lp_constituent");

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

function normaliseRelations(value) {
  if (value == null) return DEFAULT_RELATIONS;
  if (!Array.isArray(value) || value.length === 0) throw new Error("invalid relations");
  const out = [];
  for (const r of value) {
    const rel = String(r).toLowerCase();
    if (!DEP_TYPES.includes(rel)) throw new Error(`unknown relation: ${rel}`);
    if (!out.includes(rel)) out.push(rel);
  }
  return out;
}

// Xerberus answers are read strictly: a missing or mistyped field throws
// rather than reading as an empty list, false or 0 that the deny rules pass.
function need(value, type, where, field) {
  let ok;
  if (type === "array") ok = Array.isArray(value);
  else if (type === "number") ok = Number.isFinite(value);
  else ok = typeof value === type && value !== null && value !== "";
  if (!ok) throw new Error(`xerberus ${where}: invalid ${field}: ${String(value).slice(0, 200)}`);
  return value;
}

// Venue = lending market or vault the book sits in, keyed `market:<uid>` as
// the dependency graph names it. Its exposure is the supply and collateral
// held there: debt is owed to the venue, not lost with it.
function addPositions(venues, payload, wallet) {
  const where = `${POSITIONS_TOOL} ${wallet}`;
  const totals = { book: 0, debt: 0 };
  for (const [i, p] of need(payload?.positions, "array", where, "positions").entries()) {
    const at = `positions[${i}]`;
    need(p, "object", where, at);
    if (p.position_kind === "spot" || !need(p.in_model, "boolean", where, `${at}.in_model`)) continue;
    const uid = need(p.market_uid, "string", where, `${at}.market_uid`).toLowerCase();
    const usd = Math.abs(need(p.amount_usd, "number", where, `${at}.amount_usd`));
    if (!ASSET_SIDES.has(need(p.side, "string", where, `${at}.side`).toLowerCase())) {
      totals.debt += usd;
      continue;
    }
    const node = `market:${uid}`;
    venues.set(node, (venues.get(node) ?? 0) + usd);
    totals.book += usd;
  }
  return totals;
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
    const relations = normaliseRelations(myArgs.relations);

    const apiKey = secret("XERBERUS_API_KEY");
    if (!apiKey) throw new Error("missing XERBERUS_API_KEY");

    // The first wallet fixes the window (latest unless one was pinned); every
    // later read is pinned to it so the book and the graph describe one state.
    const venues = new Map();
    let fresh = null;
    let bookUsd = 0;
    let debtUsd = 0;
    for (const wallet of wallets) {
      const args = { wallet };
      const pin = fresh?.window ?? window;
      if (pin != null) args.window = pin;
      const positions = callTool(POSITIONS_TOOL, args, apiKey);
      const f = freshnessOf(positions);
      if (fresh == null) {
        if (f.window == null) throw new Error("get_positions returned no data window");
        fresh = f;
      } else if (!windowHonored(fresh.window, f.window)) {
        throw new Error(`get_positions answered ${wallet} from ${f.window}, not ${fresh.window}`);
      }
      const totals = addPositions(venues, positions, wallet);
      bookUsd += totals.book;
      debtUsd += totals.debt;
    }

    const ranked = [...venues.entries()]
      .filter(([, usd]) => usd >= DUST_USD)
      .sort((a, b) => b[1] - a[1]);
    const targets = ranked.slice(0, MAX_VENUES);
    const omittedUsd = ranked.slice(MAX_VENUES).reduce((sum, [, usd]) => sum + usd, 0);

    // Fewer than two venues leaves nothing to compare; report it rather than
    // call a tool that requires two, and let the Rego decide.
    let shared = [];
    let unresolved = [];
    let truncated = false;
    if (targets.length >= 2) {
      const sd = callTool(
        SHARED_TOOL,
        {
          nodes: targets.map(([node]) => node),
          relations,
          min_shared: 2,
          top_k: TOP_K,
          window: fresh.window,
        },
        apiKey,
      );
      const sdWindow = freshnessOf(sd).window;
      if (!windowHonored(fresh.window, sdWindow)) {
        throw new Error(`${SHARED_TOOL} answered from ${sdWindow}, not ${fresh.window}`);
      }
      truncated = need(sd?.truncated, "boolean", SHARED_TOOL, "truncated");
      unresolved = need(sd?.unresolved_targets, "array", SHARED_TOOL, "unresolved_targets").map((n, i) => {
        const venue = need(n, "string", SHARED_TOOL, `unresolved_targets[${i}]`).toLowerCase();
        return { venue, exposure_usd: venues.get(venue) ?? 0 };
      });
      shared = need(sd?.shared_dependencies, "array", SHARED_TOOL, "shared_dependencies").map((d, i) => {
        const at = `shared_dependencies[${i}]`;
        need(d, "object", SHARED_TOOL, at);
        const by = need(d.shared_by, "array", SHARED_TOOL, `${at}.shared_by`).map((n, j) =>
          need(n, "string", SHARED_TOOL, `${at}.shared_by[${j}]`).toLowerCase(),
        );
        return {
          node: need(d.node, "string", SHARED_TOOL, `${at}.node`).toLowerCase(),
          node_type: need(d.node_type, "string", SHARED_TOOL, `${at}.node_type`).toLowerCase(),
          label: str(d?.label),
          venue_count: num(d?.n_targets) ?? by.length,
          exposure_usd: by.reduce((sum, n) => sum + (venues.get(n) ?? 0), 0),
          // null is Xerberus's "zero exit value", which it carries as 0.
          expected_loss_share:
            d.expected_loss_share === null
              ? 0
              : need(d.expected_loss_share, "number", SHARED_TOOL, `${at}.expected_loss_share`),
          combined_weight: need(d.combined_weight, "number", SHARED_TOOL, `${at}.combined_weight`),
          combined_contribution: need(d.combined_contribution, "number", SHARED_TOOL, `${at}.combined_contribution`),
        };
      });
      shared.sort((a, b) => b.exposure_usd - a.exposure_usd);
    }

    const largest = shared[0] ?? null;
    return wrapOutput(PACK_ID, {
      wallets,
      chain,
      relations,
      venues_compared_count: targets.length,
      book_usd: bookUsd,
      debt_usd: debtUsd,
      venues_omitted_usd: omittedUsd,
      unresolved_venues: unresolved,
      shared_node_count: shared.length,
      shared_nodes_truncated: truncated,
      largest_shared_node: largest?.node ?? null,
      largest_shared_exposure_usd: largest?.exposure_usd ?? 0,
      shared_nodes: shared,
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
