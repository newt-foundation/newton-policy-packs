import { fetch as httpFetch } from "newton:provider/http@0.2.0";
import { get as getHostSecrets } from "newton:provider/secrets@0.2.0";

// Phase 0 § Stream B (NEWT-1539): pack-side namespacing. See
// arkham_entity/policy.js for the full rationale — `policy.js` goes
// straight to `jco componentize` with only the `newton:provider/*` host
// imports wired, so a top-level npm import does not resolve. Keep PACK_ID
// in sync with the folder name and metadata.ts PACK_NAME.
const PACK_ID = "arkham_counterparty";

function wrapOutput(packId, valueOrError) {
  const out = JSON.stringify({ [packId]: valueOrError });
  return out;
}

const ARKHAM_API = "https://api.arkm.com";
const DEFAULT_WINDOW_DAYS = 90;

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

// The `status >= 400` throw is load-bearing — see arkham_entity/policy.js.
function getJson(url, apiKey) {
  const r = httpFetch({
    url,
    method: "GET",
    headers: [
      ["accept", "application/json"],
      ["API-Key", apiKey],
    ],
    body: null,
  });
  if (typeof r === "string") throw new Error(`http: ${r}`);
  if (r.tag === "err") throw new Error(`http: ${r.val}`);
  const resp = r.val ?? r;
  const status = resp.status ?? 200;
  const text = new TextDecoder().decode(new Uint8Array(resp.body));
  if (status >= 400) throw new Error(`arkham ${status}: ${text.slice(0, 200)}`);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`arkham: invalid json: ${text.slice(0, 200)}`);
  }
  return parsed;
}

function num(x) {
  if (x == null) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

// Both Arkham endpoints key their payload by chain slug at the TOP level
// (`ethereum`, `base`, `polygon`, ...), each holding its own array. There is
// no flat list. When the caller scopes to specific chains we take those
// slices; otherwise we aggregate across every chain, because "the wallet's
// normal outflow" is a property of the wallet, not of one network.
function chainSlices(payload, chainsArg) {
  if (!payload || typeof payload !== "object") return [];
  let wanted = null;
  if (typeof chainsArg === "string" && chainsArg.length > 0) {
    wanted = {};
    const parts = chainsArg.split(",");
    for (let i = 0; i < parts.length; i++) {
      const c = parts[i].trim();
      if (c) wanted[c] = true;
    }
  }
  const out = [];
  const keys = Object.keys(payload);
  for (let i = 0; i < keys.length; i++) {
    const chain = keys[i];
    if (wanted && wanted[chain] !== true) continue;
    const value = payload[chain];
    if (Array.isArray(value)) out.push(value);
  }
  return out;
}

// A counterparty entry nests the full enriched address record under
// `address`, so the raw hex lives at `entry.address.address` — NOT at
// `entry.address`, which is an object.
function counterpartyAddress(entry) {
  const raw = entry?.address?.address;
  return typeof raw === "string" ? raw.toLowerCase() : null;
}

function counterpartyLabel(entry) {
  const e = entry?.address?.arkhamEntity;
  if (e && (e.name || e.id)) return String(e.name ?? e.id);
  const l = entry?.address?.arkhamLabel;
  return l?.name ? String(l.name) : null;
}

// Collapse the per-chain daily flow series into one wallet-wide series,
// summing outflow across chains for the same day. `time` is an ISO date
// string, so it sorts lexicographically.
//
// Plain object + indexed loops on purpose. A `Map` keyed by day (~1950 entries
// for an active wallet) crashes the componentize-js runtime outright — the
// fetch and a full `JSON.parse` of the same payload both succeed, and only the
// Map build fails. Same for `for...of` with destructuring. Keep aggregation
// here to plain objects and classic `for` loops.
function mergedOutflowByDay(payload, chainsArg) {
  const byDay = {};
  const slices = chainSlices(payload, chainsArg);
  for (let si = 0; si < slices.length; si++) {
    const series = slices[si];
    for (let i = 0; i < series.length; i++) {
      const point = series[i];
      const day = point && point.time;
      if (typeof day !== "string") continue;
      const v = num(point.outflow);
      if (v == null) continue;
      byDay[day] = (byDay[day] || 0) + Math.abs(v);
    }
  }
  const days = Object.keys(byDay);
  days.sort();
  const out = [];
  for (let i = 0; i < days.length; i++) out.push([days[i], byDay[days[i]]]);
  return out;
}

// The most recent day is what we are judging; the baseline is the mean of the
// `windowDays` days before it. Scoping the baseline to a recent window (rather
// than all history, which can span years) keeps "normal" meaningful for a
// wallet whose activity has changed. Excluding the latest day is deliberate:
// otherwise a single anomalous day inflates its own baseline and hides itself.
function outflowBaseline(payload, chainsArg, windowDays) {
  const series = mergedOutflowByDay(payload, chainsArg);
  if (series.length === 0) return { normal: null, recent: null, ratio: null };
  const recent = series[series.length - 1][1];
  const from = Math.max(0, series.length - 1 - windowDays);
  let sum = 0;
  let n = 0;
  for (let i = from; i < series.length - 1; i++) {
    sum += series[i][1];
    n++;
  }
  if (n === 0) return { normal: null, recent, ratio: null };
  const normal = sum / n;
  const ratio = normal > 0 ? recent / normal : null;
  return { normal, recent, ratio };
}

export function run(input) {
  try {
    const parsed = JSON.parse(input);
    const myArgs = parsed[PACK_ID] ?? parsed;
    _secrets = { ...parsed };
    delete _secrets[PACK_ID];
    loadHostSecrets();

    const { sender_address, destination_address, chains } = myArgs;
    if (!sender_address) throw new Error("missing sender_address");
    if (!destination_address) throw new Error("missing destination_address");
    // Unscoped, /flow/address returns every chain's full daily history — over
    // 1MB for an active wallet, which exhausts the WASM heap. Require a scope.
    if (!chains) throw new Error("missing chains (required to bound the flow response)");

    const apiKey = secret("ARKHAM_API_KEY");
    if (!apiKey) throw new Error("missing ARKHAM_API_KEY");

    const amountUsd = num(myArgs.transaction_amount_usd) ?? 0;
    if (amountUsd < 0) throw new Error("transaction_amount_usd must be >= 0");

    const windowDays = num(myArgs.history_window_days) ?? DEFAULT_WINDOW_DAYS;
    if (windowDays < 1 || windowDays > 365) {
      throw new Error("history_window_days must be between 1 and 365");
    }

    const chainQuery = chains ? `&chains=${encodeURIComponent(chains)}` : "";
    const counterparties = getJson(
      `${ARKHAM_API}/counterparties/address/${sender_address}?timeLast=${windowDays}d${chainQuery}`,
      apiKey,
    );
    const flow = getJson(
      `${ARKHAM_API}/flow/address/${sender_address}?chains=${encodeURIComponent(chains ?? "")}`,
      apiKey,
    );

    const target = destination_address.toLowerCase();

    // Sum across chains: the same counterparty can appear once per network.
    let matchUsd = 0;
    let matchTxCount = 0;
    let matchFound = false;
    let matchLabel = null;
    let matchFlow = null;
    let totalUsdAllCounterparties = 0;

    const cpSlices = chainSlices(counterparties, chains);
    for (let si = 0; si < cpSlices.length; si++) {
      const entries = cpSlices[si];
      for (let ei = 0; ei < entries.length; ei++) {
        const entry = entries[ei];
        const usd = Math.abs(num(entry?.usd) ?? 0);
        totalUsdAllCounterparties += usd;
        if (counterpartyAddress(entry) !== target) continue;
        matchFound = true;
        matchUsd += usd;
        matchTxCount += num(entry?.transactionCount) ?? 0;
        matchLabel = matchLabel ?? counterpartyLabel(entry);
        matchFlow = matchFlow ?? (entry?.flow ? String(entry.flow) : null);
      }
    }

    // Null rather than 0 when there is no history to average — a zero average
    // would make every payment look infinitely anomalous.
    const avgUsd = matchFound && matchTxCount > 0 ? matchUsd / matchTxCount : null;
    const concentration =
      matchFound && totalUsdAllCounterparties > 0
        ? (matchUsd / totalUsdAllCounterparties) * 100
        : null;

    const { normal, recent, ratio } = outflowBaseline(flow, chains, windowDays);

    return wrapOutput(PACK_ID, {
      sender_address,
      destination_address,
      chains: chains ?? null,
      is_known_counterparty: matchFound,
      counterparty_label: matchLabel,
      counterparty_flow_direction: matchFlow,
      counterparty_transaction_count: matchTxCount,
      counterparty_total_usd: matchUsd,
      counterparty_avg_usd: avgUsd,
      // Arkham's counterparties endpoint returns no per-relationship
      // timestamp, so recency is unavailable and the Rego's
      // `stale_relationship` rule fail-softs on null. See README.
      counterparty_last_seen_days: null,
      counterparty_concentration_pct: concentration,
      normal_daily_outflow_usd: normal,
      recent_daily_outflow_usd: recent,
      outflow_ratio: ratio,
      transaction_amount_usd: amountUsd,
      data_age_seconds: null,
      timestamp: Date.now(),
    });
  } catch (e) {
    return wrapOutput(PACK_ID, { error: String(e) });
  }
}
