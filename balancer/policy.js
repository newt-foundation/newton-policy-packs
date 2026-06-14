import { fetch as httpFetch } from "newton:provider/http@0.2.0";
import { get as getHostSecrets } from "newton:provider/secrets@0.2.0";

// Phase 0 § Stream B (NEWT-1539): pack-side namespacing. Inlined `PACK_ID`
// and `wrapOutput` mirror @newton-xyz/policy-pack-shared/src/wrap.ts —
// `policy.js` is fed straight to `jco componentize` with only the
// `newton:provider/*` host imports wired, so a top-level npm import does
// not resolve. See vaultsfyi PR #41 for the canonical pattern (decided
// 2026-06-14). Indirect-return form satisfies the AST-lint guard. Keep
// PACK_ID literal in sync with the folder name and metadata.ts PACK_NAME
// — packages/policy-pack-balancer/src/pack-id.test.ts enforces this at
// `pnpm test` time.
const PACK_ID = "balancer";

function wrapOutput(packId, valueOrError) {
  const out = JSON.stringify({ [packId]: valueOrError });
  return out;
}

const BALANCER_API = "https://api-v3.balancer.fi/";

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
    headers: headers ?? [
      ["accept", "application/json"],
      ["content-type", "application/json"],
    ],
    body,
  });
  if (typeof r === "string") throw new Error(`http: ${r}`);
  if (r.tag === "err") throw new Error(`http: ${r.val}`);
  const resp = r.val ?? r;
  const text = new TextDecoder().decode(new Uint8Array(resp.body));
  return { status: resp.status ?? 200, body: text };
}

function gql(query, variables) {
  const { status, body } = postJson(BALANCER_API, { query, variables });
  if (status >= 400) {
    throw new Error(`balancer ${status}: ${body.slice(0, 200)}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    throw new Error(`balancer: invalid json: ${body.slice(0, 200)}`);
  }
  if (parsed.errors && parsed.errors.length > 0) {
    const msg = parsed.errors.map((e) => e.message ?? String(e)).join("; ");
    throw new Error(`balancer gql: ${msg}`);
  }
  return parsed.data ?? {};
}

const POOL_QUERY = `
query Pool($id: String!, $chain: GqlChain!) {
  poolGetPool(id: $id, chain: $chain) {
    id
    address
    type
    chain
    dynamicData { totalLiquidity totalShares swapFee }
    poolTokens {
      address
      symbol
      balance
      weight
      hasNestedPool
      nestedPool { address }
      underlyingToken { address symbol }
    }
  }
}`;

const SNAPSHOTS_QUERY = `
query Snapshots($id: String!, $chain: GqlChain!) {
  poolGetSnapshots(id: $id, chain: $chain, range: THIRTY_DAYS) {
    timestamp
    totalLiquidity
  }
}`;

function getPool(poolId, chain) {
  const data = gql(POOL_QUERY, { id: poolId, chain });
  if (!data.poolGetPool) throw new Error(`balancer: pool not found ${poolId} on ${chain}`);
  return data.poolGetPool;
}

function getSnapshots(poolId, chain) {
  try {
    const data = gql(SNAPSHOTS_QUERY, { id: poolId, chain });
    return Array.isArray(data.poolGetSnapshots) ? data.poolGetSnapshots : null;
  } catch (e) {
    return null;
  }
}

function num(x) {
  if (x == null) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function computeMaxWeightPct(poolTokens) {
  if (!Array.isArray(poolTokens) || poolTokens.length === 0) return 0;
  const weights = poolTokens.map((t) => num(t.weight));
  const allWeighted = weights.every((w) => w != null && w >= 0);
  if (allWeighted) {
    return Math.max(...weights) * 100;
  }
  // Fallback for non-weighted pools: derive proportions from balances.
  const balances = poolTokens.map((t) => num(t.balance) ?? 0);
  const total = balances.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  return (Math.max(...balances) / total) * 100;
}

function drawdownPct(current, past) {
  if (current == null || past == null || past <= 0) return null;
  return ((past - current) / past) * 100;
}

function pickSnapshotAt(snapshots, targetTs) {
  if (!Array.isArray(snapshots) || snapshots.length === 0) return null;
  let best = null;
  let bestDiff = Infinity;
  for (const s of snapshots) {
    const ts = num(s.timestamp);
    if (ts == null) continue;
    const diff = Math.abs(ts - targetTs);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = s;
    }
  }
  return best;
}

export function run(input) {
  try {
    const parsed = JSON.parse(input);
    // Phase 0 § Stream B input-unwrap shim. The AVS forwards one
    // `wasm_args` blob to every PolicyData WASM in a policy
    // (newton-prover-avs/crates/data-provider/src/lib.rs fans out a single
    // blob via `wasm_args.clone()` per for-loop iteration). Composite
    // execution will produce `{ balancer: {...}, vaultsfyi: {...} }` so
    // each pack reads its own slice via the namespaced key; nullish
    // coalescing falls back to flat for legacy single-pack callers.
    // Mirrors ADR 0003's `args[PACK_ID] ?? args` shape verbatim.
    const myArgs = parsed[PACK_ID] ?? parsed;
    // Strip our own slot from `_secrets` so it can't shadow a same-named
    // host secret if a future secret name collides with our pack id.
    // Sibling pack slots are left in place — `secret(name)` only reads
    // fixed named keys (e.g. `BALANCER_API_KEY`), and a future composite-
    // secrets shape may legitimately share top-level keys across packs.
    _secrets = { ...parsed };
    delete _secrets[PACK_ID];
    loadHostSecrets();
    const { poolId, chain, allowed_token_addresses } = myArgs;

    if (!poolId) throw new Error("missing poolId");
    if (!chain) throw new Error("missing chain");

    const allowList = Array.isArray(allowed_token_addresses)
      ? allowed_token_addresses
          .filter((a) => typeof a === "string" && a.length > 0)
          .map((a) => a.toLowerCase())
      : [];
    const allowSet = new Set(allowList);

    const pool = getPool(poolId, chain);

    const tvlUsd = num(pool.dynamicData?.totalLiquidity) ?? 0;
    const poolTokens = Array.isArray(pool.poolTokens) ? pool.poolTokens : [];
    const tokenCount = poolTokens.length;
    const maxTokenWeightPct = computeMaxWeightPct(poolTokens);

    let nonAllowlisted = [];
    if (allowSet.size > 0) {
      const seen = new Set();
      for (const t of poolTokens) {
        const addr = typeof t.address === "string" ? t.address.toLowerCase() : null;
        if (!addr) continue;
        if (allowSet.has(addr)) continue;
        if (seen.has(addr)) continue;
        seen.add(addr);
        nonAllowlisted.push(addr);
      }
    }

    const hasBoosted = poolTokens.some(
      (t) => Boolean(t.hasNestedPool) || Boolean(t.underlyingToken),
    );

    const underlyingProtocols = [];
    const seenSym = new Set();
    for (const t of poolTokens) {
      const candidates = [];
      if (t.underlyingToken?.symbol) candidates.push(String(t.underlyingToken.symbol));
      if (t.hasNestedPool && t.symbol) candidates.push(String(t.symbol));
      for (const sym of candidates) {
        if (seenSym.has(sym)) continue;
        seenSym.add(sym);
        underlyingProtocols.push(sym);
      }
    }

    const snapshots = getSnapshots(poolId, chain);
    let drawdown24h = null;
    let drawdown7d = null;
    if (Array.isArray(snapshots) && snapshots.length > 0) {
      const nowSec = Math.floor(Date.now() / 1000);
      const day = 24 * 60 * 60;
      const s24 = pickSnapshotAt(snapshots, nowSec - day);
      const s7d = pickSnapshotAt(snapshots, nowSec - 7 * day);
      const tvl24 = s24 ? num(s24.totalLiquidity) : null;
      const tvl7d = s7d ? num(s7d.totalLiquidity) : null;
      drawdown24h = drawdownPct(tvlUsd, tvl24);
      drawdown7d = drawdownPct(tvlUsd, tvl7d);
    }

    return wrapOutput(PACK_ID, {
      pool_id: pool.id ?? poolId,
      chain: pool.chain ?? chain,
      pool_type: pool.type ?? null,
      tvl_usd: tvlUsd,
      tvl_drawdown_24h_pct: drawdown24h,
      tvl_drawdown_7d_pct: drawdown7d,
      token_count: tokenCount,
      max_token_weight_pct: maxTokenWeightPct,
      non_allowlisted_tokens: nonAllowlisted,
      has_boosted_tokens: hasBoosted,
      underlying_protocols: underlyingProtocols,
      timestamp: Date.now(),
    });
  } catch (e) {
    return wrapOutput(PACK_ID, { error: String(e) });
  }
}
