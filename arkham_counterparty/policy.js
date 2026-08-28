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

function asList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.counterparties)) return payload.counterparties;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function addressOf(entry) {
  const raw = entry?.address ?? entry?.counterpartyAddress ?? entry?.counterparty?.address;
  return typeof raw === "string" ? raw.toLowerCase() : null;
}

// Arkham reports the last interaction as a unix timestamp under one of a
// few names depending on endpoint version. Null (not 0) when absent, so
// the Rego's `!= null` guard fail-softs instead of reading "today".
function lastSeenDays(entry) {
  const ts = num(entry?.lastTransactionTime ?? entry?.lastSeen ?? entry?.last_transaction_time);
  if (ts == null || ts <= 0) return null;
  const seconds = ts > 1e12 ? ts / 1000 : ts;
  return Math.max(0, (Date.now() / 1000 - seconds) / 86400);
}

// Collapse the flow time-series into a "normal" daily outflow and a
// "recent" one. The most recent bucket is what we are judging; the
// baseline is the mean of everything before it, so a single anomalous day
// cannot inflate its own baseline and hide itself.
function outflowBaseline(flow) {
  const series = Array.isArray(flow)
    ? flow
    : Array.isArray(flow?.flows)
      ? flow.flows
      : Array.isArray(flow?.data)
        ? flow.data
        : [];
  const outflows = [];
  for (const point of series) {
    const v = num(point?.outflow ?? point?.outflowUsd ?? point?.usdOutflow);
    if (v != null) outflows.push(Math.abs(v));
  }
  if (outflows.length === 0) return { normal: null, recent: null, ratio: null };
  const recent = outflows[outflows.length - 1];
  const prior = outflows.slice(0, -1);
  if (prior.length === 0) return { normal: null, recent, ratio: null };
  const normal = prior.reduce((a, b) => a + b, 0) / prior.length;
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
      `${ARKHAM_API}/flow/address/${sender_address}?${chainQuery.slice(1)}`,
      apiKey,
    );

    const entries = asList(counterparties);
    const target = destination_address.toLowerCase();

    let match = null;
    let totalUsdAllCounterparties = 0;
    for (const entry of entries) {
      const usd = Math.abs(num(entry?.usd ?? entry?.usdValue) ?? 0);
      totalUsdAllCounterparties += usd;
      if (addressOf(entry) === target) match = entry;
    }

    const isKnown = match !== null;
    const txCount = isKnown ? (num(match.transactionCount ?? match.txCount) ?? 0) : 0;
    const totalUsd = isKnown ? Math.abs(num(match.usd ?? match.usdValue) ?? 0) : 0;
    // Null rather than 0 when there is no history to average — a zero
    // average would read as "every payment is infinitely anomalous".
    const avgUsd = isKnown && txCount > 0 ? totalUsd / txCount : null;
    const concentration =
      isKnown && totalUsdAllCounterparties > 0
        ? (totalUsd / totalUsdAllCounterparties) * 100
        : null;

    const { normal, recent, ratio } = outflowBaseline(flow);

    return wrapOutput(PACK_ID, {
      sender_address,
      destination_address,
      chains: chains ?? null,
      is_known_counterparty: isKnown,
      counterparty_transaction_count: txCount,
      counterparty_total_usd: totalUsd,
      counterparty_avg_usd: avgUsd,
      counterparty_last_seen_days: isKnown ? lastSeenDays(match) : null,
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
