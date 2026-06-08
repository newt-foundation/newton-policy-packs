// Usage:
//   tsx scripts/cmd/simulate.ts <clientName> [--mode full|policy-data]
//
// full       (default): walletClient.simulatePolicy — full Rego eval against
//                       deployed PolicyData. Best end-to-end pre-flight.
// policy-data:          walletClient.simulatePolicyDataWithClient — pure WASM
//                       run using secrets ALREADY uploaded for the policyClient
//                       (run upload-secrets first). Caller must own the client.
//
// Inputs: pulls policy.rego, intent (from <pack>/configs/intent.json if
// present, else config.packs.<pack> at minimum), wasmArgs, params, secrets.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toHex, type Hex } from 'viem';
import { buildClients } from '../lib/newton.ts';
import { functionSignatureToHex, VALIDATE_AND_EXECUTE_DIRECT_SIGNATURE } from '../lib/intent.ts';
import { getPack, getPackDeployment, getPolicyClient, loadConfig } from '../lib/config.ts';
import { err, kv, step, safeStringify } from '../lib/log.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

interface IntentFile {
  from: `0x${string}`;
  to: `0x${string}`;
  value: string; // decimal or hex string
  data?: `0x${string}`;
  function_name?: string;
  args?: unknown[];
  chain_id: string | number;
  function_signature?: `0x${string}`;
}

function loadIntent(pack: string, _chainId: number) {
  // configs/intent.json mirrors what the simulate CLI uses today.
  let intent: IntentFile;
  try {
    intent = JSON.parse(readFileSync(join(REPO_ROOT, pack, 'configs', 'intent.json'), 'utf8'));
  } catch {
    throw new Error(`Missing ${pack}/configs/intent.json — create one or extend simulate.ts.`);
  }
  const valueHex = (intent.value.startsWith('0x')
    ? intent.value
    : toHex(BigInt(intent.value))) as Hex;

  return {
    from: intent.from,
    to: intent.to,
    value: valueHex,
    data: (intent.data ?? '0x') as Hex,
    chainId: typeof intent.chain_id === 'string' ? Number(intent.chain_id) : intent.chain_id,
    functionSignature:
      intent.function_signature ??
      functionSignatureToHex(VALIDATE_AND_EXECUTE_DIRECT_SIGNATURE),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const clientName = args.find(a => !a.startsWith('--'));
  if (!clientName) throw new Error('Usage: tsx scripts/cmd/simulate.ts <clientName> [--mode full|policy-data]');
  const modeIdx = args.indexOf('--mode');
  const mode = (modeIdx >= 0 ? args[modeIdx + 1] : 'full') as 'full' | 'policy-data';

  const cfg = loadConfig();
  const client = getPolicyClient(cfg, clientName);
  if (!client.pack) throw new Error(`policyClients.${clientName}.pack is not set`);
  const pack = client.pack;
  const packCfg = getPack(cfg, pack);
  const packDeployment = getPackDeployment(cfg, pack);
  if (!packDeployment.policyDataAddress) throw new Error(`deployments.${pack}.policyDataAddress missing`);

  const { walletClient } = buildClients(cfg);
  const intent = loadIntent(pack, cfg.chainId);

  // Both modes hit the gateway directly because the SDK forgets to send
  // `chain_id` on simulatePolicy + simulatePolicyDataWithClient (see
  // scripts/bugs.md #3). The request shapes mirror the SDK's own functions
  // verbatim — same field names, same wire encoding — just with chain_id added.
  const stripHex = (h: string) => (h.startsWith('0x') ? h.slice(2) : h);
  async function gatewayPost(method: string, params: unknown) {
    const body = { jsonrpc: '2.0', method, params, id: crypto.randomUUID() };
    kv('Gateway request', body);
    const resp = await fetch(cfg.newton.gatewayApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.newton.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    const text = await resp.text();
    if (!resp.ok) {
      throw new Error(`Gateway ${resp.status} ${resp.statusText}: ${text || '(empty body)'}`);
    }
    return JSON.parse(text);
  }

  if (mode === 'policy-data') {
    // simulatePolicyDataWithClient: gateway pulls the encrypted secrets stored
    // against (policyClient, policyDataAddress) — no inline envelope. Requires
    // you've run `upload-secrets` first and that the API key's linked wallet
    // matches the on-chain PolicyClient owner.
    step(`simulatePolicyDataWithClient pack=${pack}`);
    const wasmArgsHex = toHex(new TextEncoder().encode(JSON.stringify(packCfg.wasmArgs)));
    kv('policyClient', client.address);
    kv('policyDataAddress', packDeployment.policyDataAddress);
    kv('wasmArgs (json)', packCfg.wasmArgs);
    kv('wasmArgs (hex)', wasmArgsHex);
    const response = await gatewayPost('newt_simulatePolicyDataWithClient', {
      policy_data_address: packDeployment.policyDataAddress,
      policy_client: client.address,
      wasm_args: stripHex(wasmArgsHex),
      chain_id: cfg.chainId,
    });
    kv('Gateway response', safeStringify(response, 2));
    return;
  }

  // mode = "full"
  step(`simulatePolicy pack=${pack}`);
  const rego = readFileSync(join(REPO_ROOT, pack, 'policy.rego'), 'utf8');
  // TODO(multi-policy): when running against a multi-pack client, policy_data[]
  // grows to N entries; per-pack wasmArgs/params get flattened (TO VERIFY).
  const response = await gatewayPost('newt_simulatePolicy', {
    policy_client: client.address,
    policy: rego,
    intent: {
      from: intent.from,
      to: intent.to,
      value: intent.value,
      data: intent.data,
      chain_id: intent.chainId,
      function_signature: intent.functionSignature,
    },
    entrypoint:
      (packDeployment.policyCids as { entrypoint?: string } | undefined)?.entrypoint ??
      'vault_risk_rating.allow',
    policy_data: [{ policy_data_address: packDeployment.policyDataAddress }],
    policy_params: packCfg.params,
    chain_id: cfg.chainId,
  });
  kv('Gateway response', safeStringify(response, 2));
}

main().catch(err);
