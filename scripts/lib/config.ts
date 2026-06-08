import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONFIG_PATH = join(REPO_ROOT, 'config.json');

// Cast to viem template-literal types so callers don't need `as 0x${string}`
// at every SDK boundary.
const HEX = z.string().regex(/^0x[0-9a-fA-F]*$/, 'must be 0x-prefixed hex').transform(s => s as `0x${string}`);
const ADDRESS = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'must be a 40-char hex address').transform(s => s as `0x${string}`);

const PackConfig = z.object({
  wasmArgs: z.record(z.unknown()).default({}),
  params: z.record(z.unknown()).default({}),
  secrets: z.record(z.string()).default({}),
});

const PolicyCids = z.object({
  entrypoint: z.string(),
  policyCid: z.string(),
  policyCodeHash: HEX,
  policyDataMetadataCid: z.string(),
  policyMetadataCid: z.string(),
  schemaCid: z.string(),
  secretsSchemaCid: z.string(),
  wasmCid: z.string(),
});

const PackDeployment = z.object({
  policyDataAddress: z.string(),
  policyAddress: z.string(),
  policyCids: PolicyCids.partial().optional(),
});

const PolicyClient = z.object({
  address: ADDRESS,
  kind: z.enum(['single', 'multi']),
  pack: z.string().optional(),
  // TODO(multi-policy): when kind === 'multi', this lists the packs gating the client.
  policies: z.array(z.string()).optional(),
});

const ConfigSchema = z.object({
  chainId: z.number().int().positive(),
  rpcUrl: z.string().url(),
  deployerPrivateKey: HEX,
  newton: z.object({
    apiKey: z.string().min(1),
    gatewayApiUrl: z.string().url(),
  }),
  pinata: z.object({
    jwt: z.string().min(1),
    gateway: z.string().url().optional(),
  }),
  packs: z.record(PackConfig),
  deployments: z
    .object({
      policyClients: z.record(PolicyClient).default({}),
    })
    .catchall(PackDeployment.partial())
    .default({ policyClients: {} }),
});

export type Config = z.infer<typeof ConfigSchema>;
export type PackName = string;

export function loadConfig(): Config {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(
      `config.json not found at ${CONFIG_PATH}. Copy config.example.json -> config.json and fill it in.`,
    );
  }
  const raw = readFileSync(CONFIG_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  return ConfigSchema.parse(parsed);
}

// Atomic write: serialise -> tmp -> rename. Avoids half-written files if the
// process dies mid-save.
export function saveConfig(cfg: Config): void {
  const tmp = join(tmpdir(), `newton-config-${process.pid}-${Date.now()}.json`);
  writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  renameSync(tmp, CONFIG_PATH);
}

// Common helper: load, mutate via callback, save. Keeps each cmd's persistence
// step terse.
export function updateConfig(mutator: (cfg: Config) => void): Config {
  const cfg = loadConfig();
  mutator(cfg);
  saveConfig(cfg);
  return cfg;
}

export function getPack(cfg: Config, pack: string) {
  const p = cfg.packs[pack];
  if (!p) throw new Error(`Pack "${pack}" not in config.json under packs.${pack}`);
  return p;
}

export function getPackDeployment(cfg: Config, pack: string) {
  const d = (cfg.deployments as Record<string, unknown>)[pack] as
    | { policyDataAddress?: string; policyAddress?: string; policyCids?: Record<string, string> }
    | undefined;
  if (!d) throw new Error(`No deployments.${pack} entry in config.json. Run deploy-policy first.`);
  return d;
}

export function getPolicyClient(cfg: Config, name: string) {
  const c = cfg.deployments.policyClients[name];
  if (!c) throw new Error(`No policyClient "${name}" in config.json. Run deploy-client first.`);
  return c;
}
