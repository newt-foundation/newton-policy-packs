// Usage: tsx scripts/cmd/run.ts <clientName>
//
// THE BUG REPRO TARGET. Mirrors useExecuteIntent.tsx:
//   1. Build intent (from <pack>/configs/intent.json + wasmArgs)
//   2. EIP712 sign with deployer key (domain "NewtonPolicyWallet"/"1")
//   3. evaluateIntentDirect({..., includeValidateCalldata: true}) via SDK
//   4. sendTransaction({to: policyClient, data: result.validate_calldata})
//
// Heavy logging — every payload crossing the SDK is dumped so we can diff
// against the dashboard's network panel for the same call.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toHex, type Hex } from 'viem';
import { buildClients } from '../lib/newton.ts';
import {
  functionSignatureToHex,
  signIntent,
  VALIDATE_AND_EXECUTE_DIRECT_SIGNATURE,
} from '../lib/intent.ts';
import { getPack, getPolicyClient, loadConfig } from '../lib/config.ts';
import { err, info, kv, step, safeStringify } from '../lib/log.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EVALUATION_TIMEOUT_SECONDS = 30;

interface IntentFile {
  from: `0x${string}`;
  to: `0x${string}`;
  value: string;
  data?: `0x${string}`;
  chain_id: string | number;
  function_signature?: `0x${string}`;
}

function loadIntent(pack: string) {
  const path = join(REPO_ROOT, pack, 'configs', 'intent.json');
  const raw = JSON.parse(readFileSync(path, 'utf8')) as IntentFile;
  const valueHex = (raw.value.startsWith('0x')
    ? raw.value
    : toHex(BigInt(raw.value))) as Hex;
  return {
    from: raw.from,
    to: raw.to,
    value: valueHex,
    data: (raw.data ?? '0x') as Hex,
    chainId: typeof raw.chain_id === 'string' ? Number(raw.chain_id) : raw.chain_id,
    functionSignature:
      raw.function_signature ?? functionSignatureToHex(VALIDATE_AND_EXECUTE_DIRECT_SIGNATURE),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const clientName = args[0];
  if (!clientName) throw new Error('Usage: tsx scripts/cmd/run.ts <clientName>');

  const cfg = loadConfig();
  const client = getPolicyClient(cfg, clientName);
  if (!client.pack) throw new Error(`policyClients.${clientName}.pack is not set`);
  const pack = client.pack;
  const packCfg = getPack(cfg, pack);

  const { walletClient, publicClient } = buildClients(cfg);
  const intent = loadIntent(pack);
  const wasmArgsHex = toHex(new TextEncoder().encode(JSON.stringify(packCfg.wasmArgs)));

  step('1. Build intent + sign');
  kv('policyClient', client.address);
  kv('intent (raw)', intent);
  kv('wasmArgs (json)', packCfg.wasmArgs);
  kv('wasmArgs (hex)', wasmArgsHex);

  const intentSignature = await signIntent(walletClient, client.address, intent);
  kv('intentSignature', intentSignature);

  step('2. createTask via gateway (bypassing SDK)');
  // We hit the gateway directly here instead of `walletClient.evaluateIntentDirect`
  // because the SDK's response builder drops `validate_calldata` even when we
  // ask for it (see scripts/bugs.md #4). The request body shape mirrors what
  // function `F` in node_modules/@newton-xyz/sdk/dist/es/modules/avs/index.mjs
  // sends — same fields, same `direct_broadcast: true`.
  // TODO(multi-policy): for a multi-attestation client we'd call this per
  // bound policy and collect (task, taskResponse, blsSignature) per pack —
  // OR, if a single PolicyClient gates multiple PolicyData with flattened
  // wasmArgs, only one call here. Confirm shape with gateway team.
  const stripHex = (h: string) => (h.startsWith('0x') ? h.slice(2) : h);
  const gatewayBody = {
    jsonrpc: '2.0',
    method: 'newt_createTask',
    params: {
      policy_client: client.address,
      intent: {
        from: intent.from,
        to: intent.to,
        value: intent.value,
        data: intent.data,
        chain_id: intent.chainId,
        function_signature: intent.functionSignature,
      },
      intent_signature: stripHex(intentSignature),
      quorum_number: null,
      quorum_threshold_percentage: null,
      wasm_args: stripHex(wasmArgsHex),
      timeout: EVALUATION_TIMEOUT_SECONDS,
      direct_broadcast: true,
      identity_domain: null,
      encrypted_data_refs: null,
      user_signature: null,
      app_signature: null,
      user_pubkey: null,
      app_pubkey: null,
      proof_cid: null,
      include_validate_calldata: true,
    },
    id: crypto.randomUUID(),
  };
  kv('Gateway request', gatewayBody);

  const httpResp = await fetch(cfg.newton.gatewayApiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.newton.apiKey}`,
    },
    body: JSON.stringify(gatewayBody),
  });
  const respText = await httpResp.text();
  if (!httpResp.ok) {
    throw new Error(`Gateway ${httpResp.status} ${httpResp.statusText}: ${respText || '(empty body)'}`);
  }
  const response = JSON.parse(respText) as {
    result?: {
      task_id?: string;
      task_response?: { evaluation_result: number[] };
      validate_calldata?: string;
      error?: string | null;
    };
    error?: unknown;
  };
  kv('Gateway response', safeStringify(response, 2));

  if (response.error) throw new Error(`Gateway error: ${safeStringify(response.error)}`);
  const result = response.result;
  if (!result) throw new Error('Empty result from gateway');
  if (result.error) throw new Error(`Gateway operator error: ${result.error}`);

  // evaluation_result is a 32-byte big-endian uint as a number array — last
  // byte non-zero = ALLOW.
  const evalBytes = result.task_response?.evaluation_result ?? [];
  const evaluationResult = evalBytes.some(b => b !== 0);
  kv('evaluationResult', evaluationResult);

  if (!evaluationResult) {
    info('Policy DENIED — not sending tx');
    process.exit(2);
  }

  const calldata = result.validate_calldata;
  if (!calldata) {
    throw new Error(
      'Gateway did not return validate_calldata — set includeValidateCalldata: true and try again',
    );
  }
  const validateCalldata = (calldata.startsWith('0x') ? calldata : `0x${calldata}`) as Hex;
  kv('validate_calldata', validateCalldata);

  // Persist calldata so we can replay it through eth_call if the tx reverts.
  const fs = await import('node:fs');
  fs.writeFileSync(join(REPO_ROOT, 'scripts', '.last-validate-calldata.hex'), validateCalldata);
  kv('calldata saved to', 'scripts/.last-validate-calldata.hex');

  step('3. eth_call dry-run to surface revert reason if any');
  try {
    await publicClient.call({
      account: walletClient.account!.address,
      to: client.address,
      data: validateCalldata,
      value: BigInt(intent.value),
    });
    info('eth_call dry-run succeeded — proceeding to send');
  } catch (callErr: unknown) {
    // viem's CallExecutionError nests the actual cause + revert data
    const errObj = callErr as Record<string, unknown>;
    info('eth_call dry-run reverted — full error:');
    kv('shortMessage', errObj?.shortMessage ?? '(none)');
    kv('details', errObj?.details ?? '(none)');
    kv('cause.message', (errObj?.cause as Record<string, unknown> | undefined)?.message ?? '(none)');
    kv('cause.data', (errObj?.cause as Record<string, unknown> | undefined)?.data ?? '(none)');
    kv('full error', errObj?.message ?? String(callErr));
    throw callErr;
  }

  step('4. sendTransaction(validateAndExecuteDirect via raw calldata)');
  const txHash = await walletClient.sendTransaction({
    to: client.address,
    data: validateCalldata,
    value: BigInt(intent.value),
  });
  kv('txHash', txHash);

  step('5. waitForTransactionReceipt');
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  kv('receipt status', receipt.status);
  kv('receipt blockNumber', receipt.blockNumber);
  kv('receipt logs count', receipt.logs.length);
  if (receipt.status === 'reverted') {
    throw new Error(`tx ${txHash} reverted on-chain`);
  }

  step('run complete');
}

main().catch(err);
