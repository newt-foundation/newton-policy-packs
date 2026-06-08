import { sepolia, baseSepolia } from 'viem/chains';
import type { Chain } from 'viem';

// Addresses copied verbatim from ../newton-dashboard/src/constants/env.ts so
// the script and dashboard target identical contracts. PolicyDataFactory is
// NOT hardcoded — we read it from any existing PolicyData via .factory() at
// runtime (see lib/policy-deploy.ts).
export interface ChainConfig {
  chain: Chain;
  policyFactory: `0x${string}`;
  taskManager: `0x${string}`;
  policyClientRegistry: `0x${string}`;
}

const CHAINS: Record<number, ChainConfig> = {
  [sepolia.id]: {
    chain: sepolia,
    policyFactory: '0xe37952d9003d399579670e97b4c67b175112d0cd',
    taskManager: '0xecb741f4875770f9a5f060cb30f6c9eb5966ed13',
    policyClientRegistry: '0x0dbd6e44a1814f5efe4f67a00b7f28642e3064dd',
  },
  [baseSepolia.id]: {
    chain: baseSepolia,
    policyFactory: '0x4302e64b36706411e96d120ae539dd84febac59c',
    taskManager: '0xa5e104ad7f09df5d9036d1e9ad60fada11140071',
    policyClientRegistry: '0x2a7b31e48e8b8962b71c36c9377e5a1023b89b0d',
  },
};

export function getChainConfig(chainId: number): ChainConfig {
  const c = CHAINS[chainId];
  if (!c) throw new Error(`Unsupported chainId: ${chainId}. Add it to scripts/lib/chains.ts.`);
  return c;
}
