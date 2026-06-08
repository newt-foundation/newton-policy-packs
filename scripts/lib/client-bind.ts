import { bytesToHex, toBytes, type Address, type Hex } from 'viem';
import { HELLO_WORLD_POLICY_CLIENT_ABI } from './abis/HelloWorldPolicyClient.ts';
import { buildClients } from './newton.ts';
import { kv, step } from './log.ts';
import type { Config } from './config.ts';

// Hardcoded to one year in seconds — matches the dashboard's useSetPolicy.tsx.
const EXPIRE_AFTER = 31_536_000;

export async function setPolicyAddress(
  cfg: Config,
  client: Address,
  policy: Address,
): Promise<Hex> {
  const { walletClient, publicClient } = buildClients(cfg);
  step(`setPolicyAddress(${policy}) on client ${client}`);
  const hash = await walletClient.writeContract({
    address: client,
    abi: HELLO_WORLD_POLICY_CLIENT_ABI,
    functionName: 'setPolicyAddress',
    args: [policy],
  });
  kv('setPolicyAddress txHash', hash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status === 'reverted') throw new Error(`setPolicyAddress reverted: ${hash}`);
  return hash;
}

export async function setPolicy(
  cfg: Config,
  client: Address,
  params: Record<string, unknown>,
): Promise<{ txHash: Hex }> {
  const { walletClient, publicClient } = buildClients(cfg);

  // The dashboard appends a trailing newline so the bytes match Solidity's
  // vm.readFile() byte-for-byte. We do the same to be diff-clean.
  const json = JSON.stringify(params);
  const policyParamsBytes = bytesToHex(toBytes(json + '\n'));
  kv('setPolicy params (json)', json);
  kv('setPolicy params (hex)', policyParamsBytes);

  step(`setPolicy on client ${client} (expireAfter=${EXPIRE_AFTER}s)`);
  const hash = await walletClient.writeContract({
    address: client,
    abi: HELLO_WORLD_POLICY_CLIENT_ABI,
    functionName: 'setPolicy',
    args: [{ policyParams: policyParamsBytes, expireAfter: EXPIRE_AFTER }],
  });
  kv('setPolicy txHash', hash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status === 'reverted') throw new Error(`setPolicy reverted: ${hash}`);
  return { txHash: hash };
}
