import { fetch as httpFetch } from "newton:provider/http@0.1.0";

const VAULTS_FYI_BASE = "https://api.vaults.fyi/v2";

let _secrets = {};

function secret(name) {
  if (typeof getSecret === "function") return getSecret(name);
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

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

function mad(xs, m) {
  return median(xs.map((x) => Math.abs(x - m)));
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
    _secrets = parsed;

    const now = Math.floor(Date.now() / 1000);
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60;

    const vault = getVaultDetail(network, vaultAddress);
    const history = getHistory(network, vaultAddress, thirtyDaysAgo);

    const currentApy = vault.apy?.["1day"]?.total ?? 0;
    const apySeries = (history.data ?? []).map((d) => d.apy?.total ?? 0).filter(Number.isFinite);
    const med30d = apySeries.length ? median(apySeries) : currentApy;
    const mad30d = apySeries.length ? mad(apySeries, med30d) : 1e-9;
    const apyZ = (currentApy - med30d) / Math.max(mad30d, 1e-9);

    const tvl = Number(vault.tvl?.usd ?? 0);
    const tvlSeries = (history.data ?? []).map((d) => Number(d.tvl?.usd ?? 0)).filter(Number.isFinite);
    const tvl24hAgo = tvlSeries.length >= 1 ? tvlSeries[tvlSeries.length - 1] : tvl;
    const tvl7dAgo = tvlSeries.length >= 7 ? tvlSeries[tvlSeries.length - 7] : tvl;
    const drawdown24hPct = ((tvl24hAgo - tvl) / Math.max(tvl24hAgo, 1)) * 100;
    const drawdown7dPct = ((tvl7dAgo - tvl) / Math.max(tvl7dAgo, 1)) * 100;

    const vaultScore = vault.score?.vaultScore ?? null;

    const metaForHash = JSON.stringify({
      protocol: vault.protocol?.name,
      tags: vault.tags,
      fees: vault.fees,
    });
    const allocationHash = simpleHash(metaForHash);

    return JSON.stringify({
      vault_address: vaultAddress,
      network,
      apy_current: currentApy,
      apy_z_score: apyZ,
      tvl_usd: tvl,
      tvl_drawdown_24h_pct: drawdown24hPct,
      tvl_drawdown_7d_pct: drawdown7dPct,
      risk_score: vaultScore,
      allocation_hash: allocationHash,
      allocation_changed_since_last:
        lastKnownAllocationHash ? lastKnownAllocationHash !== allocationHash : false,
      timestamp: Date.now(),
    });
  } catch (e) {
    return JSON.stringify({ error: String(e) });
  }
}
