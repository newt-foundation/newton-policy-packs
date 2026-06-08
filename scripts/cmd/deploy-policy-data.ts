// Usage: tsx scripts/cmd/deploy-policy-data.ts <pack>
//
// Deploys a fresh PolicyData contract on-chain. PolicyData is IMMUTABLE
// w.r.t. its wasmCid — once deployed, it's bonded to that one WASM. So any
// time you change <pack>/policy.js, you need a new PolicyData (which then
// requires a new Policy that wraps it, since Policy holds the policyData[]
// array).
//
// The flow on a WASM change:
//   1. tsx cmd/deploy-policy-data.ts <pack>     ← this script
//   2. tsx cmd/deploy-policy.ts <pack>          ← deploys new Policy with the new PolicyData
//   3. tsx cmd/update.ts <clientName> --new-policy <policyAddress>
//   4. tsx cmd/upload-secrets.ts <clientName>   ← secrets are scoped to (client, policyData)
//
// Why we shell out to newton-cli: neither @newton-xyz/sdk nor
// @magicnewton/newton-protocol-sdk exposes anything that calls
// PolicyDataFactory.deployPolicyData. The dashboard never deploys PolicyData
// either — it always reuses an existing address. Our scripts are pure-TS for
// every other step; this is the one place where calling out to newton-cli is
// genuinely the simplest option until the SDK adds a method (logged in
// scripts/bugs.md).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, updateConfig } from '../lib/config.ts';
import { err, info, kv, step } from '../lib/log.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

async function main() {
  const args = process.argv.slice(2);
  const pack = args.find(a => !a.startsWith('--'));
  if (!pack) throw new Error('Usage: tsx scripts/cmd/deploy-policy-data.ts <pack>');

  const cfg = loadConfig();
  const cidsPath = join(REPO_ROOT, pack, 'dist', 'policy_cids.json');
  if (!existsSync(cidsPath)) {
    throw new Error(
      `${pack}/dist/policy_cids.json not found. Run cmd/deploy-policy.ts first to build wasm + pin CIDs (or just to (re)pin without redeploying Policy).`,
    );
  }

  step(`deploy-policy-data ${pack} (chainId=${cfg.chainId})`);
  const cids = JSON.parse(readFileSync(cidsPath, 'utf8'));
  kv('policy_cids.json', cids);

  // Shell out to newton-cli. We pass keys and RPC explicitly so the CLI
  // doesn't fall back to its toml — the script's config.json is the single
  // source of truth.
  const cliArgs = [
    'policy-data',
    'deploy',
    '--chain-id',
    String(cfg.chainId),
    '--private-key',
    cfg.deployerPrivateKey,
    '--rpc-url',
    cfg.rpcUrl,
    '--policy-cids',
    cidsPath,
    '--quiet',
  ];

  info(`$ newton-cli ${cliArgs.slice(0, 4).join(' ')} --private-key <redacted> ${cliArgs.slice(6).join(' ')}`);
  const result = spawnSync('newton-cli', cliArgs, {
    cwd: REPO_ROOT,
    env: {
      // Pass Pinata creds for any IPFS reads the CLI does internally.
      ...process.env,
      CHAIN_ID: String(cfg.chainId),
      PRIVATE_KEY: cfg.deployerPrivateKey,
      RPC_URL: cfg.rpcUrl,
      PINATA_JWT: cfg.pinata.jwt,
      ...(cfg.pinata.gateway ? { PINATA_GATEWAY: cfg.pinata.gateway } : {}),
    },
    encoding: 'utf8',
  });
  if (result.error) {
    if ((result.error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        'newton-cli not found on PATH. Install it via `newtup` per the project README, or add ~/.newton/bin to PATH.',
      );
    }
    throw result.error;
  }

  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  if (result.status !== 0) {
    throw new Error(`newton-cli policy-data deploy exited with code ${result.status}`);
  }

  // The CLI prints "Policy data deployed successfully at address: 0x..." once
  // the tx confirms. Parse that line out.
  const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const match = combined.match(/0x[a-fA-F0-9]{40}/g);
  if (!match || match.length === 0) {
    throw new Error(
      'Could not find a deployed PolicyData address in newton-cli output. Inspect logs above and update config.json manually.',
    );
  }
  // The last 0x... in the output is the deployed address (CLI also logs the
  // factory address earlier in the run; we want the latest one).
  const policyDataAddress = match[match.length - 1] as `0x${string}`;

  updateConfig(c => {
    const slot = (c.deployments as Record<string, unknown>)[pack] as Record<string, unknown> | undefined;
    (c.deployments as Record<string, unknown>)[pack] = {
      ...(slot ?? {}),
      policyDataAddress,
      // Drop any cached policyAddress — the new PolicyData needs a new Policy
      // wrapping it; deploy-policy.ts will repopulate this on its next run.
      policyAddress: '',
    };
  });

  step('deploy-policy-data complete');
  kv('Deployed PolicyData address', policyDataAddress);
  info('');
  info('Next: tsx cmd/deploy-policy.ts ' + pack);
  info('Then: tsx cmd/update.ts <clientName> --new-policy <newPolicyAddress>');
  info('Then: tsx cmd/upload-secrets.ts <clientName>   (re-upload, since secrets are scoped to the new PolicyData)');
}

main().catch(err);
