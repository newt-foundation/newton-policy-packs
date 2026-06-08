// Usage: tsx scripts/cmd/deploy-client.ts <name> --pack <pack>
//
// Deploys a HelloWorldPolicyClient (constructor args: [taskManager, owner])
// using the bytecode + abi vendored from ../newton-dashboard. Mirrors
// useDeployHelloWorldPolicyClient.tsx exactly.
//
// TODO(multi-policy): once we add a custom multi-attestation contract we'd
// branch here on `--kind multi` and deploy a different bytecode (or shell out
// to forge for a project-local Solidity build).
import { loadConfig, updateConfig } from '../lib/config.ts';
import { HELLO_WORLD_POLICY_CLIENT_ABI, HELLO_WORLD_POLICY_CLIENT_BYTECODE } from '../lib/abis/HelloWorldPolicyClient.ts';
import { buildClients } from '../lib/newton.ts';
import { getChainConfig } from '../lib/chains.ts';
import { err, kv, step } from '../lib/log.ts';

async function main() {
  const args = process.argv.slice(2);
  const name = args.find(a => !a.startsWith('--'));
  const packIdx = args.indexOf('--pack');
  const pack = packIdx >= 0 ? args[packIdx + 1] : undefined;
  if (!name) throw new Error('Usage: tsx scripts/cmd/deploy-client.ts <name> [--pack <pack>]');

  const cfg = loadConfig();
  const { walletClient, publicClient, account } = buildClients(cfg);
  const { taskManager } = getChainConfig(cfg.chainId);

  step(`deploy-client ${name} (pack=${pack ?? '<unset>'})`);
  kv('taskManager', taskManager);
  kv('owner', account.address);

  const hash = await walletClient.deployContract({
    abi: HELLO_WORLD_POLICY_CLIENT_ABI,
    bytecode: HELLO_WORLD_POLICY_CLIENT_BYTECODE,
    args: [taskManager, account.address],
  });
  kv('deploy txHash', hash);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status === 'reverted') throw new Error(`deployContract reverted: ${hash}`);
  if (!receipt.contractAddress) throw new Error('No contractAddress in deploy receipt');

  const address = receipt.contractAddress;
  kv('Deployed PolicyClient address', address);

  updateConfig(c => {
    c.deployments.policyClients[name] = {
      address,
      kind: 'single',
      ...(pack ? { pack } : {}),
    };
  });

  step('deploy-client complete');
}

main().catch(err);
