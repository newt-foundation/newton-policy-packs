import {
  createPublicClient,
  createWalletClient,
  http,
  type Hex,
  type WalletClient,
  type PublicClient,
  type Account,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { newtonWalletClientActions, newtonPublicClientActions } from '@newton-xyz/sdk';
import type { Config } from './config.ts';
import { getChainConfig } from './chains.ts';

// We assemble a viem walletClient with the Newton SDK extension applied.
// The dashboard does the same in src/libs/magic.ts via getNewtonWalletClient.
// Difference: we use a static private key from config.json instead of Magic.

export interface NewtonClients {
  account: Account;
  walletClient: ReturnType<typeof buildWalletClient>;
  publicClient: ReturnType<typeof buildPublicClient>;
}

export function buildWalletClient(cfg: Config) {
  const { chain } = getChainConfig(cfg.chainId);
  const account = privateKeyToAccount(cfg.deployerPrivateKey as Hex);
  return createWalletClient({
    account,
    chain,
    transport: http(cfg.rpcUrl),
  }).extend(
    newtonWalletClientActions(
      { apiKey: cfg.newton.apiKey },
      { gatewayApiUrl: cfg.newton.gatewayApiUrl },
    ),
  );
}

export function buildPublicClient(cfg: Config) {
  const { chain } = getChainConfig(cfg.chainId);
  return createPublicClient({
    chain,
    transport: http(cfg.rpcUrl),
  }).extend(newtonPublicClientActions({}, { gatewayApiUrl: cfg.newton.gatewayApiUrl }));
}

export function buildClients(cfg: Config): NewtonClients {
  const walletClient = buildWalletClient(cfg);
  const publicClient = buildPublicClient(cfg);
  const account = privateKeyToAccount(cfg.deployerPrivateKey as Hex);
  return { account, walletClient, publicClient };
}

// Used as the basic write/read viem types so callers don't have to import the
// @newton-xyz return-type shapes everywhere.
export type AnyWalletClient = WalletClient & ReturnType<typeof buildWalletClient>;
export type AnyPublicClient = PublicClient & ReturnType<typeof buildPublicClient>;
