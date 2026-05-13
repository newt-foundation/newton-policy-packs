import { readFileSync } from "fs";

const args = JSON.parse(
  readFileSync("configs/vault_risk_rating/wasm_args.json", "utf-8")
);

const VAULTS_FYI_BASE = "https://api.vaults.fyi/v2";
const API_KEY = args.VAULTS_FYI_API_KEY;
const { network, vaultAddress } = args;

async function getJson(url) {
  const res = await fetch(url, {
    headers: { accept: "application/json", "x-api-key": API_KEY },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
  return res.json();
}

console.log(`Fetching vault ${vaultAddress} on ${network}...\n`);

const detailUrl = `${VAULTS_FYI_BASE}/detailed-vaults/${network}/${vaultAddress}`;
console.log(`GET ${detailUrl}\n`);
const detail = await getJson(detailUrl);
console.log("=== detailed-vaults response ===");
console.log(JSON.stringify(detail, null, 2));

const now = Math.floor(Date.now() / 1000);
const thirtyDaysAgo = now - 30 * 24 * 60 * 60;
const historyUrl = `${VAULTS_FYI_BASE}/historical/${network}/${vaultAddress}?granularity=1day&fromTimestamp=${thirtyDaysAgo}&perPage=30`;
console.log(`\nGET ${historyUrl}\n`);
const history = await getJson(historyUrl);
console.log("=== historical response ===");
console.log(JSON.stringify(history, null, 2));
