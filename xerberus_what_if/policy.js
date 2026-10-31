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
const XERBERUS_MCP = "https://mcp.xerberus.io/mcp";
const TOOL = "what_if";
// `what_if` reports exposure by token but no exit clocks, so the 30-day ladder
// and slowest exit are rebuilt from each token's per-day sale capacity.
const LADDER_TOOL = "portfolio_ladder";
const QUOTE_TOOL = "liquidity_exit_quote";

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
  // (or ok) answer, or one with no status at all, is data; a status of any
  // other shape throws.
  const st = payload?.status;
  if (st != null && !(typeof st === "object" && OK_STATUSES.has(st.value))) {
    const value = typeof st === "object" ? st.value : st;
    throw new Error(`xerberus ${name} ${String(value).slice(0, 200)}: ${String(st.cause ?? "").slice(0, 200)}`);
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
const MAX_LEGS = 12;
const MAX_ISSUES = 10;
const LEG_ACTIONS = new Set(["add", "remove"]);
const LEG_SIDES = new Set(["supply", "collateral", "borrow"]);
const LADDER_DAYS = 30;
// The enclave allows 10 HTTP calls per run: what_if, portfolio_ladder and the quotes.
const MAX_HTTP_CALLS = 10;

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

// Xerberus market ids are `<protocol>:<key>`, e.g. `aave_v3:0x7f39…` or
// `crvusd:0x100d…`. Only the shape is checked here; Xerberus resolves them.
function normaliseMarketUid(value, label) {
  if (typeof value !== "string" || !/^[a-z0-9_]+:0x[0-9a-fA-F]+$/.test(value.trim())) {
    throw new Error(`invalid ${label}: ${String(value)}`);
  }
  const [protocol, key] = value.trim().split(":");
  return `${protocol}:${key.toLowerCase()}`;
}

function normaliseLegs(value) {
  if (!Array.isArray(value) || value.length === 0) throw new Error("missing legs");
  if (value.length > MAX_LEGS) throw new Error(`too many legs: ${value.length} > ${MAX_LEGS}`);
  return value.map((l, i) => {
    const action = String(l?.action ?? "").toLowerCase();
    if (!LEG_ACTIONS.has(action)) throw new Error(`invalid legs[${i}].action: ${String(l?.action)}`);
    const side = String(l?.side ?? "").toLowerCase();
    if (!LEG_SIDES.has(side)) throw new Error(`invalid legs[${i}].side: ${String(l?.side)}`);
    const usd = optionalPositive(l?.usd, `legs[${i}].usd`);
    if (usd == null) throw new Error(`missing legs[${i}].usd`);
    return { action, side, market_uid: normaliseMarketUid(l?.market_uid, `legs[${i}].market_uid`), usd };
  });
}

// token address -> USD, dropping zero rows.
function exposure(state) {
  const out = new Map();
  for (const [token, usd] of Object.entries(state?.exposure_by_token ?? {})) {
    const n = num(usd);
    if (n != null && n > 0) out.set(token.toLowerCase(), n);
  }
  return out;
}

function bookUsd(state, exp) {
  const reported = num(state?.assets_usd);
  if (reported != null) return reported;
  let sum = 0;
  for (const usd of exp.values()) sum += usd;
  return sum;
}

function largest(exp, book) {
  let best = null;
  for (const [token, usd] of exp) {
    if (best == null || usd > best.usd) best = { token, usd };
  }
  return best && book > 0 ? { token: best.token, pct: (best.usd / book) * 100 } : null;
}

// Share of the book (percent) sellable inside LADDER_DAYS at the impact band,
// tokens sold in parallel. A token with no depth curve exits nothing.
function ladderPct(exp, book, capacity) {
  if (!(book > 0)) return null;
  let exitable = 0;
  for (const [token, usd] of exp) {
    const perDay = capacity.get(token);
    if (perDay != null && perDay > 0) exitable += Math.min(usd, perDay * LADDER_DAYS);
  }
  return (exitable / book) * 100;
}

// Days to exit the slowest token that has a depth curve.
function slowestDays(exp, capacity) {
  let worst = null;
  for (const [token, usd] of exp) {
    const perDay = capacity.get(token);
    if (perDay == null || perDay <= 0) continue;
    const days = usd / perDay;
    if (worst == null || days > worst) worst = days;
  }
  return worst;
}

function diff(after, before) {
  if (after == null || before == null) return null;
  return after - before;
}

// Pure removals that leave every levered pool at least as healthy. Pulling
// collateral from a pool with debt is a removal that ADDS risk, so the
// per-pool health factor is checked rather than the leg actions alone.
function riskReducing(legs, before, after) {
  if (!legs.every((l) => l.action === "remove")) return false;
  if ((num(after?.debt_usd) ?? 0) > (num(before?.debt_usd) ?? 0)) return false;
  const hfBefore = new Map();
  for (const p of Array.isArray(before?.pools) ? before.pools : []) {
    hfBefore.set(p?.pool_uid, num(p?.health_factor));
  }
  for (const p of Array.isArray(after?.pools) ? after.pools : []) {
    const hf = num(p?.health_factor);
    const prior = hfBefore.get(p?.pool_uid);
    if (hf == null || prior == null) {
      if (num(p?.debt_usd) > 0) return false;
      continue;
    }
    if (hf < prior) return false;
  }
  return true;
}

function issueText(x) {
  return (typeof x === "string" ? x : JSON.stringify(x)).slice(0, 200);
}

export function run(input) {
  try {
    const parsed = JSON.parse(input);
    const myArgs = parsed[PACK_ID] ?? parsed;
    _secrets = { ...parsed };
    delete _secrets[PACK_ID];
    loadHostSecrets();

    const wallets = normaliseWallets(myArgs.wallets);
    const legs = normaliseLegs(myArgs.legs);
    const impactPct = optionalPositive(myArgs.impact_pct, "impact_pct", 100);
    const chain = normaliseChain(myArgs.chain);
    const window = normaliseWindow(myArgs.window);

    const apiKey = secret("XERBERUS_API_KEY");
    if (!apiKey) throw new Error("missing XERBERUS_API_KEY");

    const args = { addresses: wallets, legs };
    if (window != null) args.window = window;
    const w = callTool(TOOL, args, apiKey);
    const fresh = freshnessOf(w);
    if (fresh.window == null) throw new Error("what_if returned no data window");
    const before = w?.before;
    const after = w?.after;

    // Pin the capacity reads to the window the simulation answered from, so
    // every figure below comes from one snapshot.
    const ladderArgs = { wallets, window: fresh.window };
    if (impactPct != null) ladderArgs.impact_pct = impactPct;
    const ladder = callTool(LADDER_TOOL, ladderArgs, apiKey);
    const ladderWindow = freshnessOf(ladder).window;
    if (!windowHonored(fresh.window, ladderWindow)) {
      throw new Error(`portfolio_ladder answered from ${ladderWindow}, not ${fresh.window}`);
    }
    const capacity = new Map();
    for (const r of Array.isArray(ladder?.rungs) ? ladder.rungs : []) {
      if (r?.token != null) capacity.set(String(r.token).toLowerCase(), num(r?.max_sale_per_day_usd));
    }

    const expBefore = exposure(before);
    const expAfter = exposure(after);
    const issues = (Array.isArray(w?.notes) ? w.notes : []).map(issueText);

    // A token the legs bring in (or one the ladder did not rung) needs its own
    // quote. Capacity at a band does not depend on size, so one call each.
    const unrunged = [...expAfter.keys()].filter((token) => !capacity.has(token));
    if (2 + unrunged.length > MAX_HTTP_CALLS) {
      throw new Error(`too many tokens to quote: ${unrunged.length} > ${MAX_HTTP_CALLS - 2}`);
    }
    for (const [token, usd] of expAfter) {
      if (capacity.has(token)) continue;
      const qArgs = { token, usd_notional: usd, window: fresh.window };
      if (impactPct != null) qArgs.impact_pct = impactPct;
      const q = callTool(QUOTE_TOOL, qArgs, apiKey);
      const qWindow = freshnessOf(q).window;
      if (!windowHonored(fresh.window, qWindow)) {
        throw new Error(`${QUOTE_TOOL} answered ${token} from ${qWindow}, not ${fresh.window}`);
      }
      capacity.set(token, num(q?.max_sale_per_day_usd));
    }
    for (const [token, usd] of expAfter) {
      const perDay = capacity.get(token);
      if ((perDay == null || perDay <= 0) && usd > (expBefore.get(token) ?? 0)) {
        issues.push(`no exit depth for ${token}, which the legs increase`);
      }
    }

    const bookBefore = bookUsd(before, expBefore);
    const bookAfter = bookUsd(after, expAfter);
    const top = largest(expAfter, bookAfter);
    const hhiBefore = num(before?.hhi_token);
    const hhiAfter = num(after?.hhi_token);
    const ladderBefore = ladderPct(expBefore, bookBefore, capacity);
    const ladderAfter = ladderPct(expAfter, bookAfter, capacity);
    const slowBefore = slowestDays(expBefore, capacity);
    const slowAfter = slowestDays(expAfter, capacity);

    return wrapOutput(PACK_ID, {
      wallets,
      chain,
      legs,
      is_risk_reducing: riskReducing(legs, before, after),
      book_usd_before: bookBefore,
      book_usd_after: bookAfter,
      post_largest_token: top?.token ?? null,
      post_largest_token_pct: top?.pct ?? null,
      // The same token's share before the change; a token not held reads as 0,
      // which can only make the change look MORE concentrating.
      pre_largest_token_pct: top && bookBefore > 0 ? ((expBefore.get(top.token) ?? 0) / bookBefore) * 100 : null,
      hhi_before: hhiBefore,
      hhi_after: hhiAfter,
      hhi_delta: num(w?.delta?.hhi_token) ?? diff(hhiAfter, hhiBefore),
      ladder_30d_before_pct: ladderBefore,
      ladder_30d_after_pct: ladderAfter,
      ladder_30d_delta_pp: diff(ladderAfter, ladderBefore),
      slowest_exit_days_before: slowBefore,
      slowest_exit_days_after: slowAfter,
      slowest_exit_delta_days: diff(slowAfter, slowBefore),
      weakest_health_factor_before: num(before?.weakest_health_factor),
      weakest_health_factor_after: num(after?.weakest_health_factor),
      issues: issues.slice(0, MAX_ISSUES),
      issues_count: issues.length,
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
