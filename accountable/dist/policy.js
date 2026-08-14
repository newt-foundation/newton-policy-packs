import { fetch as httpFetch } from "newton:provider/http@0.2.0";
import { get as getHostSecrets } from "newton:provider/secrets@0.2.0";

// Phase 0 § Stream B (NEWT-1539): pack-side namespacing. Inlined `PACK_ID`
// and `wrapOutput` mirror @newton-xyz/policy-pack-shared/src/wrap.ts —
// `policy.js` is fed straight to `jco componentize` with only the
// `newton:provider/*` host imports wired, so a top-level npm import does
// not resolve. See vaultsfyi PR #41 / redstone, chainalysis for the
// canonical pattern this pack follows.
const PACK_ID = "accountable";

function wrapOutput(packId, valueOrError) {
  const out = JSON.stringify({ [packId]: valueOrError });
  return out;
}

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
    // fall through. Every node observed at authoring time (axis.accountable.
    // capital:8443) served /dashboard with no auth header at all, so this
    // pack works with zero secrets configured; a key is only read if a given
    // deployment's node requires one.
  }
}

function secret(name) {
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
  const status = resp.status ?? 200;
  const body = new TextDecoder().decode(new Uint8Array(resp.body));
  return { status, body };
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

// Accountable's real architecture (confirmed 2026-08-13 against a live node
// at axis.accountable.capital:8443, via browser — their apex domain 403s
// server-side fetches) is one self-hosted node PER ATTESTED ENTITY, not one
// shared multi-tenant API with a /venues/{id} path. `GET {nodeUrl}/dashboard`
// on that node returns everything for that entity in one payload: a
// `dataSources` map (one entry per connected source: banks, exchanges,
// wallets — each with its own `verificationLevel`, `type`, `lastUpdated`,
// `frequency`), plus `reserves`/`total_reserves`/`total_supply`/
// `collateralization`, plus a TEE (Nitro) hardware-attestation blob. No
// `snapshot_status` or `carry_forward` field was present on that payload —
// see README "Verified against a live node" for what this changed from the
// original field-list-only design.
function getDashboard(nodeUrl, apiKey) {
  const url = `${nodeUrl.replace(/\/+$/, "")}/dashboard`;
  const headers = apiKey
    ? [
        ["accept", "application/json"],
        ["x-api-key", apiKey],
      ]
    : [["accept", "application/json"]];
  const { status, body } = getJson(url, headers);
  if (status >= 400) {
    throw new Error(`accountable dashboard ${status}: ${body.slice(0, 200)}`);
  }
  const parsed = JSON.parse(body);
  if (parsed.res !== "ok") {
    throw new Error(`accountable dashboard res: ${JSON.stringify(parsed.res)}`);
  }
  return parsed.data;
}

// Mirrors redstone's onchainOracle pattern: an eth_call to a fixed selector
// (e.g. an ERC-4626 share-price accessor), scaled by decimals. Which price
// counts as authoritative is the mandate author's call (per Tempora's own
// framing — "which price is authoritative" belongs to them), so this is a
// wasm_args input, never a pack-side default.
function getOnchainPrice(rpcUrl, address, selector, decimals) {
  const resp = postJson(rpcUrl, {
    jsonrpc: "2.0",
    id: 1,
    method: "eth_call",
    params: [{ to: address, data: selector }, "latest"],
  });
  if (resp.error) {
    throw new Error(`rpc: ${resp.error.message ?? JSON.stringify(resp.error)}`);
  }
  if (!resp.result || resp.result === "0x") throw new Error("rpc: empty result");
  const raw = BigInt(resp.result);
  const d = decimals ?? 18;
  return Number(raw) / Math.pow(10, d);
}

export function run(input) {
  try {
    const parsed = JSON.parse(input);
    // Phase 0 § Stream B input-unwrap shim. AVS forwards one `wasm_args`
    // blob to every PolicyData WASM in a policy. Composite execution
    // produces `{ accountable: {...}, <sibling>: {...} }`; nullish
    // coalescing reads our slice when present, falls back to flat for
    // legacy single-pack callers.
    const myArgs = parsed[PACK_ID] ?? parsed;
    // Strip our own slot from `_secrets` so it can't shadow a same-named
    // host secret. Sibling pack slots are intentionally left in place.
    _secrets = { ...parsed };
    delete _secrets[PACK_ID];
    loadHostSecrets();

    const {
      nodeUrl,
      dataSource,
      rpcUrl,
      onchainPrice,
      prevSnapshot,
      roster,
      networkStatus,
    } = myArgs;
    if (!nodeUrl) throw new Error("missing nodeUrl");
    if (!dataSource) throw new Error("missing dataSource");
    if (!rpcUrl) throw new Error("missing rpcUrl");
    if (!onchainPrice?.address) throw new Error("missing onchainPrice.address");
    if (!onchainPrice?.selector) throw new Error("missing onchainPrice.selector");

    const apiKey = secret("ACCOUNTABLE_API_KEY"); // unauthenticated on every node observed; only read if configured

    const dashboard = getDashboard(nodeUrl, apiKey);
    const source = dashboard.dataSources?.[dataSource];

    // Confirmed live: verificationLevel is a per-data-source integer (4 seen
    // on API/CEX connectors, 6 on the on-chain Wallet source) — matches
    // Tempora's claimed 1-6 ladder directly, just addressed per-source
    // rather than per-"venue". BUT this is not universal: a second live
    // node (aegis.accountable.capital, a different attested entity) has no
    // `dataSources` map at all, so `verifiability` is null there and this
    // pack correctly fail-closes (denies) rather than allowing without a
    // proof. That node instead exposes only an aggregate
    // `reserves.verifiability` score ("100"-style, not a 1-6 rung) - a
    // different scale entirely. Deliberately NOT auto-mapped into
    // `verifiability` below: collapsing a percentage-like aggregate onto a
    // 1-6 ordinal is a policy call for whoever owns the mandate's ladder,
    // not something this pack should decide silently. Surfaced as its own
    // raw field instead, unused by any deny rule, so it's visible without
    // being trusted as equivalent.
    const verifiability =
      typeof source?.verificationLevel === "number" ? source.verificationLevel : null;
    const entityVerifiabilityScoreRaw =
      dashboard.reserves?.verifiability !== undefined ? dashboard.reserves.verifiability : null;

    // lastUpdated is a millisecond epoch, serialized as a STRING on every
    // node observed (e.g. "1786653902510") — not the unix-SECONDS number
    // Tempora's brief assumed. Parse defensively either way.
    const lastUpdatedMs =
      source?.lastUpdated !== undefined && source?.lastUpdated !== null
        ? Number(source.lastUpdated)
        : null;
    const nowMs = Date.now();
    const snapshotAgeSeconds =
      Number.isFinite(lastUpdatedMs) && lastUpdatedMs !== null
        ? Math.max(0, (nowMs - lastUpdatedMs) / 1000)
        : null;

    // No `snapshot_status` field exists on the raw node. The closest real
    // signal is: did the source come back at all, and did the HTTP call
    // itself report ok (checked in getDashboard, which throws otherwise).
    const snapshotStatus = source ? "ok" : "missing";

    // No `carry_forward` field exists on the raw node either. Computed the
    // same way redstone computes sustained-drift state: the caller passes
    // the previous evaluation's lastUpdated for this exact dataSource: if
    // the node is still serving the identical lastUpdated, nothing new
    // arrived since last check, regardless of how "fresh" the age looks.
    const carryForward = Boolean(
      prevSnapshot &&
        Number.isFinite(Number(prevSnapshot.lastUpdatedMs)) &&
        lastUpdatedMs !== null &&
        Number(prevSnapshot.lastUpdatedMs) === lastUpdatedMs,
    );

    // Attested value: the per-unit backing ratio (total reserves / total
    // supply), which is the quantity actually comparable to an on-chain
    // share price or redemption rate — not the raw reserves total, which
    // is an absolute USD figure with no on-chain analog to diverge against.
    const totalReserves = dashboard.reserves?.total_reserves?.value;
    const totalSupply = dashboard.reserves?.total_supply?.value;
    const attestedValue =
      typeof totalReserves === "number" && typeof totalSupply === "number" && totalSupply !== 0
        ? totalReserves / totalSupply
        : null;

    const price = getOnchainPrice(
      rpcUrl,
      onchainPrice.address,
      onchainPrice.selector,
      onchainPrice.decimals ?? 18,
    );

    const navDeviationPct =
      typeof attestedValue === "number" && price !== 0
        ? (Math.abs(attestedValue - price) / Math.abs(price)) * 100
        : null;

    // Roster membership and network-wide success/total counts are NOT
    // obtainable from a single Accountable node — a node only knows about
    // itself, it has no visibility into which other entities the DVN
    // covers or how the network overall is performing. Per Tempora's own
    // original framing ("αCV assembles the facts, Newton evaluates"), these
    // two are caller-supplied facts from whatever layer aggregates across
    // nodes (Tempora's own registry), not something this oracle fetches.
    const onRoster = typeof roster?.onRoster === "boolean" ? roster.onRoster : null;
    const successCount = Number.isFinite(Number(networkStatus?.successCount))
      ? Number(networkStatus.successCount)
      : null;
    const totalCount = Number.isFinite(Number(networkStatus?.totalCount))
      ? Number(networkStatus.totalCount)
      : null;
    const successRatio =
      successCount !== null && totalCount !== null && totalCount > 0
        ? successCount / totalCount
        : null;

    return wrapOutput(PACK_ID, {
      node_url: nodeUrl,
      data_source: dataSource,
      verifiability,
      entity_verifiability_score_raw: entityVerifiabilityScoreRaw,
      attested_value: attestedValue,
      onchain_price: price,
      nav_deviation_pct: navDeviationPct,
      snapshot_last_updated_ms: lastUpdatedMs,
      snapshot_age_seconds: snapshotAgeSeconds,
      snapshot_status: snapshotStatus,
      carry_forward: carryForward,
      on_roster: onRoster,
      success_count: successCount,
      total_count: totalCount,
      success_ratio: successRatio,
      timestamp: nowMs,
    });
  } catch (e) {
    return wrapOutput(PACK_ID, { error: String(e) });
  }
}
