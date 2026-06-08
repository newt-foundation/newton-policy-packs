import { fetch as httpFetch } from "newton:provider/http@0.2.0";
import { get as getSecrets } from "newton:provider/secrets@0.2.0";

// revision: v3 — uses newton:provider/secrets WIT import; built with jco --disable http,random,stdio,fetch-event
const VAULTS_FYI_BASE = "https://api.vaults.fyi/v2";

// Lazy cache for the decrypted secrets blob the host gives us via the
// `newton:provider/secrets` interface. The host scopes this to
// (policy_client, policy_data) automatically, so we don't pass any name.
let _cachedSecrets = null;

function loadSecrets() {
  if (_cachedSecrets !== null) return _cachedSecrets;
  try {
    const r = getSecrets();
    if (typeof r === "string") throw new Error(`secrets: ${r}`);
    if (r.tag === "err") throw new Error(`secrets: ${r.val}`);
    const resp = r.val ?? r;
    const body = new TextDecoder().decode(new Uint8Array(resp.value));
    _cachedSecrets = body ? JSON.parse(body) : {};
  } catch (e) {
    _cachedSecrets = { __error: String(e) };
  }
  return _cachedSecrets;
}

function secret(name) {
  const s = loadSecrets();
  return s[name];
}

function getJson(url) {
  const apiKey = secret("VAULTS_FYI_API_KEY");
  if (!apiKey) {
    // Surface a clear, debuggable message in `data.wasm.error` rather than
    // crashing inside the WIT-typed httpFetch with "expected a string".
    throw new Error(
      `missing VAULTS_FYI_API_KEY in stored secrets (got keys: ${Object.keys(loadSecrets()).join(",") || "(none)"})`,
    );
  }
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
    const { network, vaultAddress, lastKnownAllocationHash } = parsed;

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

    return JSON.stringify({
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
    return JSON.stringify({ error: String(e) });
  }
}
