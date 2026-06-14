import { fetch as httpFetch } from "newton:provider/http@0.2.0";
import { get as getHostSecrets } from "newton:provider/secrets@0.2.0";

// Phase 0 § Stream B (NEWT-1539): pack-side namespacing. Every `policy.js`
// MUST wrap every return-path under its `PACK_ID` so the AVS-side shallow
// `merge_jsons` (newton-prover-avs/crates/operator/src/simulation.rs:296)
// composes cleanly across packs without top-level key collisions.
//
// `PACK_ID` and `wrapOutput` are inlined rather than imported from
// `@newton-xyz/policy-pack-shared` because `policy.js` is fed straight to
// `jco componentize` (scripts/deploy-all.sh:101-106) with only the
// `newton:provider/*` host imports wired via `newton-provider.wit` — there
// is no npm bundler step. Inlining is the pattern documented in
// `phase-0-pack-namespacing-plan.md` Stream B item 6 fallback row. The
// AST-lint guard (scripts/lint-policy-js.ts) is purely syntactic and only
// requires `return wrapOutput(PACK_ID, payload);` shape, regardless of where
// `wrapOutput` is defined.
//
// `PACK_ID` matches the folder name and `policy-pack-vaultsfyi`'s
// `PACK_NAME` export from src/metadata.ts. Keep these three in sync.
const PACK_ID = "vaultsfyi";

// Indirect-return form. The AST-lint guard (scripts/lint-policy-js.ts) walks
// every `ReturnStatement` in `<pack>/policy.js` and flags any whose argument
// is a `JSON.stringify(...)` CallExpression — that catches the violation
// pattern (curator drift, double-escape, top-level `error` collision). Its
// known-limitation note explicitly tolerates the
// `const out = JSON.stringify(...); return out;` shape because the return
// argument is an Identifier, not a CallExpression: "Indirect returns. ditto.
// Same code-review backstop." That's why this helper splits the call from
// the return — `policy.js` is fed straight to `jco componentize` (no npm
// bundler step is wired), so `wrapOutput` must inline; routing through an
// Identifier preserves the lint's guard against caller-side
// `return JSON.stringify(...)` while letting this helper coexist.
function wrapOutput(packId, valueOrError) {
  const out = JSON.stringify({ [packId]: valueOrError });
  return out;
}

const VAULTS_FYI_BASE = "https://api.vaults.fyi/v2";

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

function getJson(url) {
  const apiKey = secret("VAULTS_FYI_API_KEY");
  const r = httpFetch({
    url,
    method: "GET",
    headers: [["accept", "application/json"], ["x-api-key", apiKey]],
    body: null,
  });
  if (typeof r === "string") throw new Error(`http: ${r}`);
  if (r.tag === "err") throw new Error(`http: ${r.val}`);
  const resp = r.val ?? r;
  const body = new TextDecoder().decode(new Uint8Array(resp.body));
  return JSON.parse(body);
}

function getVaultDetail(network, vaultAddress) {
  const url = `${VAULTS_FYI_BASE}/detailed-vaults/${network}/${vaultAddress}`;
  return getJson(url);
}

function getHistory(network, vaultAddress, fromTimestamp) {
  const url = `${VAULTS_FYI_BASE}/historical/${network}/${vaultAddress}?granularity=1day&fromTimestamp=${fromTimestamp}&perPage=30`;
  return getJson(url);
}

function simpleHash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return ("00000000" + (h >>> 0).toString(16)).slice(-8);
}

export function run(input) {
  try {
    const parsed = JSON.parse(input);
    // Phase 0 § Stream B input-unwrap shim: accept both shapes —
    //   composite envelope: { "vaultsfyi": { network, vaultAddress, ... } }
    //   legacy flat:        { network, vaultAddress, ... }
    // The AVS will eventually pass a per-pack-keyed `wasmArgs` envelope under
    // composite execution; today's single-pack callers still pass the flat
    // shape. The `?? parsedArgs` fallback keeps both working through the
    // migration window. Secrets stay at the top level either way (hosts
    // upload them per-pack via `newton-cli policy-data set-secrets`).
    const myArgs = parsed[PACK_ID] ?? parsed;
    const { network, vaultAddress, lastKnownAllocationHash } = myArgs;
    _secrets = parsed;
    loadHostSecrets();

    const now = Math.floor(Date.now() / 1000);
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60;

    const vault = getVaultDetail(network, vaultAddress);
    const history = getHistory(network, vaultAddress, thirtyDaysAgo);

    const currentApy = vault.apy?.["1day"]?.total ?? 0;
    const apy30d = vault.apy?.["30day"]?.total ?? 0;
    const apyZ = (currentApy - apy30d) / Math.max(apy30d * 0.5, 0.001);
    const apyBase = vault.apy?.["1day"]?.base ?? null;
    const apyReward = vault.apy?.["1day"]?.reward ?? null;

    const tvl = Number(vault.tvl?.usd ?? 0);
    const tvlSeries = (history.data ?? []).map((d) => Number(d.tvl?.usd ?? 0)).filter(Number.isFinite);
    const tvl24hAgo = tvlSeries.length >= 1 ? tvlSeries[tvlSeries.length - 1] : tvl;
    const tvl7dAgo = tvlSeries.length >= 7 ? tvlSeries[tvlSeries.length - 7] : tvl;
    const drawdown24hPct = ((tvl24hAgo - tvl) / Math.max(tvl24hAgo, 1)) * 100;
    const drawdown7dPct = ((tvl7dAgo - tvl) / Math.max(tvl7dAgo, 1)) * 100;

    const flags = Array.isArray(vault.flags)
      ? vault.flags.map(f => ({ content: f.content ?? String(f), severity: f.severity ?? "unknown" }))
      : [];
    const hasCriticalFlag = flags.some(f => f.severity === "critical" || f.severity === "high");

    const vaultScore = vault.score?.vaultScore ?? null;
    const scoreVaultTvl = vault.score?.vaultTvlScore ?? null;
    const scoreProtocolTvl = vault.score?.protocolTvlScore ?? null;
    const scoreHolder = vault.score?.holderScore ?? null;
    const scoreNetwork = vault.score?.networkScore ?? null;
    const scoreAsset = vault.score?.assetScore ?? null;
    const scorePenalty = vault.score?.totalScorePenalty ?? null;

    const UNCAPPED_THRESHOLD = 1e30;
    const rawRemaining = vault.remainingCapacity != null ? Number(vault.remainingCapacity) : null;
    const rawMax = vault.maxCapacity != null ? Number(vault.maxCapacity) : null;
    const capacityRemaining = (rawRemaining != null && rawRemaining < UNCAPPED_THRESHOLD) ? rawRemaining : null;
    const capacityMax = (rawMax != null && rawMax < UNCAPPED_THRESHOLD) ? rawMax : null;

    const isCorrupted = vault.isCorrupted ?? false;

    const metaForHash = JSON.stringify({
      protocol: vault.protocol?.name,
      tags: vault.tags,
      fees: vault.fees,
      childrenVaults: (vault.childrenVaults ?? []).map(v => v.address),
    });
    const allocationHash = simpleHash(metaForHash);

    return wrapOutput(PACK_ID, {
      vault_address: vaultAddress,
      network,
      apy_current: currentApy,
      apy_z_score: apyZ,
      apy_base: apyBase,
      apy_reward: apyReward,
      apy_30d: apy30d,
      tvl_usd: tvl,
      tvl_drawdown_24h_pct: drawdown24hPct,
      tvl_drawdown_7d_pct: drawdown7dPct,
      risk_score: vaultScore,
      flags,
      has_critical_flag: hasCriticalFlag,
      score_vault_tvl: scoreVaultTvl,
      score_protocol_tvl: scoreProtocolTvl,
      score_holder: scoreHolder,
      score_network: scoreNetwork,
      score_asset: scoreAsset,
      score_penalty: scorePenalty,
      capacity_remaining: capacityRemaining,
      capacity_max: capacityMax,
      is_corrupted: isCorrupted,
      allocation_hash: allocationHash,
      allocation_changed_since_last:
        lastKnownAllocationHash ? lastKnownAllocationHash !== allocationHash : false,
      timestamp: Date.now(),
    });
  } catch (e) {
    return wrapOutput(PACK_ID, { error: String(e) });
  }
}
