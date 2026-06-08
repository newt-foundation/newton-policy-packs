// Usage: tsx scripts/cmd/deploy-policy.ts <pack> [--reuse-policy-data]
//
// Mirrors `newton-cli policy deploy` but in TS via viem + Pinata. By default
// rebuilds WASM with jco, pins all artifacts, then deploys a fresh Policy via
// NewtonPolicyFactory.deployPolicy. With --reuse-policy-data, skips jco/Pinata
// and reuses the CIDs already in <pack>/dist/policy_cids.json.
//
// PolicyData address is ALWAYS reused from config.deployments.<pack>
// (the dashboard's flow never deploys a fresh PolicyData).
import { loadConfig, updateConfig } from '../lib/config.ts';
import { deployPolicy } from '../lib/policy-deploy.ts';
import { err, info, kv, step } from '../lib/log.ts';

async function main() {
  const args = process.argv.slice(2);
  const pack = args.find(a => !a.startsWith('--'));
  if (!pack) throw new Error('Usage: tsx scripts/cmd/deploy-policy.ts <pack> [--reuse-policy-data]');

  const reusePolicyData = args.includes('--reuse-policy-data');

  const cfg = loadConfig();
  step(`deploy-policy ${pack} (chainId=${cfg.chainId})`);
  if (reusePolicyData) info('Reusing CIDs from dist/policy_cids.json (--reuse-policy-data)');

  const result = await deployPolicy(cfg, { pack, reusePolicyData });

  updateConfig(c => {
    const slot = (c.deployments as Record<string, unknown>)[pack] as Record<string, unknown> | undefined;
    const updated = {
      ...(slot ?? {}),
      policyDataAddress: result.policyDataAddress,
      policyAddress: result.policyAddress,
      policyCids: result.policyCids,
    };
    (c.deployments as Record<string, unknown>)[pack] = updated;
  });

  step('deploy-policy complete');
  kv('policyDataAddress', result.policyDataAddress);
  kv('policyAddress', result.policyAddress);
  kv('policyCids', result.policyCids);
}

main().catch(err);
