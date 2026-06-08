// Usage: tsx scripts/cmd/bind.ts <clientName>
//
// (Re)binds the Policy contract currently in config.json to a PolicyClient.
// Two transactions, in order:
//   1. setPolicyAddress(policyAddress)  — useInitializePolicy.tsx
//   2. setPolicy({policyParams, expireAfter})  — useSetPolicy.tsx
//
// Works for both first-time binding and rebinding after a Rego/WASM change:
// just rerun deploy-policy (or deploy-policy-data + deploy-policy for WASM
// changes) to write a fresh policyAddress into config, then run this.
import { getPack, getPackDeployment, getPolicyClient, loadConfig } from '../lib/config.ts';
import { setPolicy, setPolicyAddress } from '../lib/client-bind.ts';
import { err, kv, step } from '../lib/log.ts';
import type { Address } from 'viem';

async function main() {
  const args = process.argv.slice(2);
  const clientName = args[0];
  if (!clientName) throw new Error('Usage: tsx scripts/cmd/bind.ts <clientName>');

  const cfg = loadConfig();
  const client = getPolicyClient(cfg, clientName);
  if (!client.pack) throw new Error(`policyClients.${clientName}.pack is not set`);
  const pack = client.pack;
  const packDeployment = getPackDeployment(cfg, pack);
  const packCfg = getPack(cfg, pack);

  if (!packDeployment.policyAddress) {
    throw new Error(`deployments.${pack}.policyAddress missing — run deploy-policy ${pack} first`);
  }

  step(`bind ${clientName} -> policy ${packDeployment.policyAddress} (pack=${pack})`);
  kv('client', client.address);
  kv('policyAddress', packDeployment.policyAddress);
  kv('policyParams', packCfg.params);

  await setPolicyAddress(cfg, client.address as Address, packDeployment.policyAddress as Address);
  await setPolicy(cfg, client.address as Address, packCfg.params);

  step('bind complete');
}

main().catch(err);
