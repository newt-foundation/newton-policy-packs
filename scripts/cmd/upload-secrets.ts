// Usage: tsx scripts/cmd/upload-secrets.ts <clientName>
//
// Uploads the configured secrets for the bound pack via @newton-xyz/sdk's
// storeEncryptedSecrets — same call shape the dashboard uses in
// useAddPolicyClientSecret.tsx.
import { storeEncryptedSecrets } from '@newton-xyz/sdk';
import { getPack, getPackDeployment, getPolicyClient, loadConfig } from '../lib/config.ts';
import { err, info, kv, step } from '../lib/log.ts';

async function main() {
  const args = process.argv.slice(2);
  const clientName = args[0];
  if (!clientName) throw new Error('Usage: tsx scripts/cmd/upload-secrets.ts <clientName>');

  const cfg = loadConfig();
  const client = getPolicyClient(cfg, clientName);
  if (!client.pack) throw new Error(`policyClients.${clientName}.pack is not set`);
  const pack = client.pack;
  const packCfg = getPack(cfg, pack);
  const packDeployment = getPackDeployment(cfg, pack);

  if (!packCfg.secrets || Object.keys(packCfg.secrets).length === 0) {
    info(`No secrets configured for pack ${pack}; nothing to do.`);
    return;
  }
  if (!packDeployment.policyDataAddress) {
    throw new Error(`deployments.${pack}.policyDataAddress missing — needed to scope the secrets envelope.`);
  }

  step(`upload-secrets ${clientName} -> pack=${pack}`);
  kv('policyClient', client.address);
  kv('policyDataAddress', packDeployment.policyDataAddress);
  kv('secret keys', Object.keys(packCfg.secrets));

  // @newton-xyz/sdk standalone form: (chainId, apiKey, params, gatewayUrl?).
  // The dashboard passes `${GATEWAY_TESTNET_URL}/rpc`; we mirror that.
  const result = await storeEncryptedSecrets(
    cfg.chainId,
    cfg.newton.apiKey,
    {
      policyClient: client.address,
      policyDataAddress: packDeployment.policyDataAddress as `0x${string}`,
      plaintext: packCfg.secrets,
      chainId: cfg.chainId,
    },
    cfg.newton.gatewayApiUrl,
  );

  kv('storeEncryptedSecrets result', result);
  if (!result.success) throw new Error(`storeEncryptedSecrets failed: ${result.error}`);
  step('upload-secrets complete');
}

main().catch(err);
