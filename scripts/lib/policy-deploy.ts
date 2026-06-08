import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { keccak256, parseEventLogs, type Address, type Hex } from 'viem';
import { NEWTON_POLICY_FACTORY_ABI } from './abis/NewtonPolicyFactory.ts';
import { POLICY_DATA_ABI } from './abis/PolicyData.ts';
import { getChainConfig } from './chains.ts';
import { componentize } from './build.ts';
import { pinJSON, pinText, pinBinary } from './pinata.ts';
import { rawCidV1, isRawCid } from './cid.ts';
import { buildClients } from './newton.ts';
import { info, kv, step } from './log.ts';
import type { Config, PackName } from './config.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface PolicyCidsFile {
  entrypoint: string;
  policyCid: string;
  policyCodeHash: Hex;
  policyDataMetadataCid: string;
  policyMetadataCid: string;
  schemaCid: string;
  secretsSchemaCid: string;
  wasmCid: string;
}

export interface DeployPolicyResult {
  policyCids: PolicyCidsFile;
  policyDataAddress: Address;
  policyAddress: Address;
}

interface DeployPolicyOptions {
  pack: PackName;
  // If true, skip jco + Pinata + redeploy of PolicyData and reuse the
  // existing wasmCid + policyDataAddress from config. Mirrors the dashboard's
  // happy path which never rebuilds WASM.
  reusePolicyData?: boolean;
  // Override entrypoint (defaults to existing policy_cids.json or "<pkg>.allow").
  entrypoint?: string;
}

function readPackFile(pack: string, file: string): string {
  return readFileSync(join(REPO_ROOT, pack, file), 'utf8');
}

function readExistingCids(pack: string): Partial<PolicyCidsFile> | null {
  try {
    return JSON.parse(readFileSync(join(REPO_ROOT, pack, 'dist', 'policy_cids.json'), 'utf8'));
  } catch {
    return null;
  }
}

function regoPackageName(rego: string): string {
  const m = rego.match(/^\s*package\s+([a-zA-Z_][a-zA-Z0-9_]*)/m);
  if (!m) throw new Error('Could not parse `package <name>` from policy.rego');
  return m[1]!;
}

async function pinAll(
  pack: string,
  pinataJwt: string,
  wasmBytes: Uint8Array,
): Promise<Pick<
  PolicyCidsFile,
  'wasmCid' | 'policyCid' | 'schemaCid' | 'policyMetadataCid' | 'policyDataMetadataCid' | 'secretsSchemaCid'
>> {
  const rego = readPackFile(pack, 'policy.rego');
  const paramsSchema = JSON.parse(readPackFile(pack, 'params_schema.json'));
  const policyMetadata = JSON.parse(readPackFile(pack, 'policy_metadata.json'));
  const policyDataMetadata = JSON.parse(readPackFile(pack, 'policy_data_metadata.json'));

  let secretsSchema: unknown | null = null;
  try {
    secretsSchema = JSON.parse(readPackFile(pack, 'secrets_schema.json'));
  } catch {
    // ok — pack has no secrets schema
  }

  step('Pinning artifacts to Pinata IPFS');
  const wasmCid = await pinBinary(pinataJwt, wasmBytes, 'policy.wasm');
  kv('wasmCid', wasmCid);
  // Text upload for .rego preserves newlines (matches CLI + dashboard behaviour).
  const policyCid = await pinText(pinataJwt, rego, 'policy.rego');
  kv('policyCid', policyCid);

  // Cross-check raw CIDs locally. We can only verify text/json (raw codec);
  // wasm CIDs land as bafybei (dag-pb) and depend on chunk size, so just log.
  const policyCidLocal = await rawCidV1(new TextEncoder().encode(rego));
  if (isRawCid(policyCid) && policyCid !== policyCidLocal) {
    throw new Error(`policyCid mismatch: pinata=${policyCid} local=${policyCidLocal}`);
  }

  const schemaCid = await pinJSON(pinataJwt, paramsSchema, 'params_schema.json');
  kv('schemaCid', schemaCid);
  const policyMetadataCid = await pinJSON(pinataJwt, policyMetadata, 'policy_metadata.json');
  kv('policyMetadataCid', policyMetadataCid);
  const policyDataMetadataCid = await pinJSON(
    pinataJwt,
    policyDataMetadata,
    'policy_data_metadata.json',
  );
  kv('policyDataMetadataCid', policyDataMetadataCid);

  let secretsSchemaCid = '';
  if (secretsSchema && Object.keys(secretsSchema as object).length > 0) {
    secretsSchemaCid = await pinJSON(pinataJwt, secretsSchema, 'secrets_schema.json');
    kv('secretsSchemaCid', secretsSchemaCid);
  }

  return {
    wasmCid,
    policyCid,
    schemaCid,
    policyMetadataCid,
    policyDataMetadataCid,
    secretsSchemaCid,
  };
}

// Resolves a PolicyDataFactory address by reading .factory() on an existing
// PolicyData contract. This is how we avoid hardcoding the factory address
// (the docs don't list it) — vaultsfyi already has a deployed PolicyData at
// 0xad76f5c6... so we can look up its parent factory on demand.
async function resolvePolicyDataFactory(
  publicClient: ReturnType<typeof buildClients>['publicClient'],
  existingPolicyData: Address,
): Promise<Address> {
  const factoryAddr = (await publicClient.readContract({
    address: existingPolicyData,
    abi: POLICY_DATA_ABI,
    functionName: 'factory',
  })) as Address;
  return factoryAddr;
}

export async function deployPolicy(
  cfg: Config,
  opts: DeployPolicyOptions,
): Promise<DeployPolicyResult> {
  const { pack } = opts;
  const { walletClient, publicClient, account } = buildClients(cfg);
  const { policyFactory } = getChainConfig(cfg.chainId);

  const rego = readPackFile(pack, 'policy.rego');
  const policyCodeHash = keccak256(new TextEncoder().encode(rego));
  kv('policyCodeHash', policyCodeHash);

  const entrypoint =
    opts.entrypoint ?? readExistingCids(pack)?.entrypoint ?? `${regoPackageName(rego)}.allow`;
  kv('entrypoint', entrypoint);

  // Step A: pin artifacts (or reuse existing CIDs).
  let cids: Pick<
    PolicyCidsFile,
    | 'wasmCid'
    | 'policyCid'
    | 'schemaCid'
    | 'policyMetadataCid'
    | 'policyDataMetadataCid'
    | 'secretsSchemaCid'
  >;

  if (opts.reusePolicyData) {
    step('Reusing existing pinned artifacts (--reuse-policy-data)');
    const existing = readExistingCids(pack);
    if (!existing?.wasmCid || !existing?.policyCid) {
      throw new Error(
        `--reuse-policy-data needs a complete dist/policy_cids.json for ${pack}. Run without the flag to repin.`,
      );
    }
    cids = {
      wasmCid: existing.wasmCid,
      // We always re-pin the rego when its hash changes, since policyCodeHash
      // is keccak256(regoBytes) and the factory keys deduplication on
      // (policyCid, codeHash). Keeping policyCid lazy:
      policyCid: existing.policyCid,
      schemaCid: existing.schemaCid ?? '',
      policyMetadataCid: existing.policyMetadataCid ?? '',
      policyDataMetadataCid: existing.policyDataMetadataCid ?? '',
      secretsSchemaCid: existing.secretsSchemaCid ?? '',
    };
  } else {
    const wasmPath = componentize(pack);
    const wasmBytes = readFileSync(wasmPath);
    cids = await pinAll(pack, cfg.pinata.jwt, new Uint8Array(wasmBytes));
  }

  const policyCidsFile: PolicyCidsFile = {
    entrypoint,
    policyCodeHash,
    ...cids,
  };

  // Persist dist/policy_cids.json — same shape the existing committed file uses.
  const distDir = join(REPO_ROOT, pack, 'dist');
  mkdirSync(distDir, { recursive: true });
  writeFileSync(join(distDir, 'policy_cids.json'), JSON.stringify(policyCidsFile, null, 2) + '\n');

  // Step B: PolicyData address. We REUSE the address from config by default,
  // which mirrors the dashboard's flow exactly (it never deploys PolicyData).
  // TODO(multi-policy): when adding a second pack, accept multiple
  // existingPolicyData addresses and aggregate them into the policyData[] array
  // passed to deployPolicy below. Each pack still maps to one PolicyData.
  const existingDataAddress = (cfg.deployments as Record<string, { policyDataAddress?: string }>)[
    pack
  ]?.policyDataAddress as Address | undefined;
  if (!existingDataAddress) {
    throw new Error(
      `deployments.${pack}.policyDataAddress missing. First-pass script reuses an existing PolicyData. Set it in config.json or extend this script to deploy a fresh one (call resolvePolicyDataFactory + write your own deployPolicyData).`,
    );
  }
  const policyDataAddress = existingDataAddress;

  // Sanity: confirm we can resolve the factory (will be needed when we wire up
  // PolicyData deploys in a future pass). Cheap read; logs the answer.
  try {
    const f = await resolvePolicyDataFactory(publicClient, policyDataAddress);
    kv('PolicyDataFactory (read from existing PolicyData.factory())', f);
  } catch (e) {
    info(`Warning: could not read PolicyData.factory() from ${policyDataAddress}: ${(e as Error).message}`);
  }

  // Step C: deploy fresh Policy via NewtonPolicyFactory. Args order matches
  // ../newton-dashboard/src/hooks/eth/useDeployPolicy.tsx.
  step('Deploying Policy via NewtonPolicyFactory.deployPolicy');
  const deployArgs = [
    policyCidsFile.entrypoint,
    policyCidsFile.policyCid,
    policyCidsFile.schemaCid,
    [policyDataAddress],
    policyCidsFile.policyMetadataCid,
    account.address,
    policyCidsFile.policyCodeHash,
  ] as const;
  kv('deployPolicy args', {
    entrypoint: deployArgs[0],
    policyCid: deployArgs[1],
    schemaCid: deployArgs[2],
    policyData: deployArgs[3],
    metadataCid: deployArgs[4],
    owner: deployArgs[5],
    policyCodeHash: deployArgs[6],
  });

  const hash = await walletClient.writeContract({
    address: policyFactory,
    abi: NEWTON_POLICY_FACTORY_ABI,
    functionName: 'deployPolicy',
    args: deployArgs,
  });
  kv('deployPolicy txHash', hash);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status === 'reverted') throw new Error(`deployPolicy reverted: ${hash}`);

  const events = parseEventLogs({
    abi: NEWTON_POLICY_FACTORY_ABI,
    eventName: 'PolicyDeployed',
    logs: receipt.logs,
  });
  const policyAddress = (events[0]?.args as { policy?: Address } | undefined)?.policy;
  if (!policyAddress) {
    throw new Error('PolicyDeployed event not found in deployPolicy receipt');
  }
  kv('Deployed Policy address', policyAddress);

  return { policyCids: policyCidsFile, policyDataAddress, policyAddress };
}
