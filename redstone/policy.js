import { fetch as httpFetch } from "newton:provider/http@0.1.0";

const REDSTONE_BASE = "https://api.redstone.finance/prices";

let _secrets = {};

function secret(name) {
  if (typeof getSecret === "function") return getSecret(name);
  return _secrets[name];
}

function getJson(url, headers) {
  const r = httpFetch({
    url,
    method: "GET",
    headers: headers ?? [["accept", "application/json"]],
    body: null,
  });
  if (typeof r === "string") throw new Error(`http: ${r}`);
  if (r.tag === "err") throw new Error(`http: ${r.val}`);
  const resp = r.val ?? r;
  const body = new TextDecoder().decode(new Uint8Array(resp.body));
  return JSON.parse(body);
}

function postJson(url, payload, headers) {
  const body = new TextEncoder().encode(JSON.stringify(payload));
  const r = httpFetch({
    url,
    method: "POST",
    headers: headers ?? [["content-type", "application/json"]],
    body,
  });
  if (typeof r === "string") throw new Error(`http: ${r}`);
  if (r.tag === "err") throw new Error(`http: ${r.val}`);
  const resp = r.val ?? r;
  const text = new TextDecoder().decode(new Uint8Array(resp.body));
  return JSON.parse(text);
}

function getRedstonePrice(symbol, provider) {
  const url = `${REDSTONE_BASE}/?symbol=${encodeURIComponent(symbol)}&provider=${encodeURIComponent(provider)}&limit=1`;
  const arr = getJson(url);
  if (!Array.isArray(arr) || arr.length === 0) {
    throw new Error(`redstone: no price for symbol=${symbol} provider=${provider}`);
  }
  const { value, timestamp } = arr[0];
  return { price: Number(value), timestampMs: Number(timestamp) };
}

function getOnchainOraclePrice(rpcUrl, oracleAddress, selector, decimals) {
  const resp = postJson(rpcUrl, {
    jsonrpc: "2.0",
    id: 1,
    method: "eth_call",
    params: [{ to: oracleAddress, data: selector }, "latest"],
  });
  if (resp.error) throw new Error(`rpc: ${resp.error.message ?? JSON.stringify(resp.error)}`);
  if (!resp.result || resp.result === "0x") throw new Error(`rpc: empty result`);
  const raw = BigInt(resp.result);
  const d = decimals ?? 18;
  return Number(raw) / Math.pow(10, d);
}

export function run(input) {
  try {
    const parsed = JSON.parse(input);
    _secrets = parsed;
    const { symbol, provider, rpcUrl, onchainOracle, prevSnapshot } = parsed;

    if (!symbol) throw new Error("missing symbol");
    if (!rpcUrl) throw new Error("missing rpcUrl");
    if (!onchainOracle?.address) throw new Error("missing onchainOracle.address");
    if (!onchainOracle?.selector) throw new Error("missing onchainOracle.selector");

    const { price: redstonePrice, timestampMs } = getRedstonePrice(symbol, provider ?? "redstone");
    const onchainPrice = getOnchainOraclePrice(
      rpcUrl,
      onchainOracle.address,
      onchainOracle.selector,
      onchainOracle.decimals ?? 18,
    );

    const divergenceBp = Math.round(
      (Math.abs(redstonePrice - onchainPrice) / Math.max(redstonePrice, 1e-18)) * 10000,
    );
    const nowMs = Date.now();
    const feedAgeSeconds = Math.max(0, (nowMs - timestampMs) / 1000);

    let prevSnapshotPresent = false;
    let sustainedSeconds = 0;
    if (
      prevSnapshot &&
      Number.isFinite(Number(prevSnapshot.divergenceBp)) &&
      Number.isFinite(Number(prevSnapshot.timestampMs))
    ) {
      prevSnapshotPresent = true;
      sustainedSeconds = Math.max(0, (nowMs - Number(prevSnapshot.timestampMs)) / 1000);
    }

    return JSON.stringify({
      symbol,
      provider: provider ?? "redstone",
      redstone_price: redstonePrice,
      onchain_price: onchainPrice,
      divergence_bp: divergenceBp,
      redstone_feed_age_seconds: feedAgeSeconds,
      prev_snapshot_present: prevSnapshotPresent,
      prev_divergence_bp: prevSnapshotPresent ? Number(prevSnapshot.divergenceBp) : null,
      sustained_seconds: sustainedSeconds,
      timestamp: nowMs,
    });
  } catch (e) {
    return JSON.stringify({ error: String(e) });
  }
}
