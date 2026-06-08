import { type Address, type Hex, toHex } from 'viem';
import type { AnyWalletClient } from './newton.ts';

// EIP712 domain + types are copied verbatim from
// ../newton-dashboard/src/hooks/eth/useExecuteIntent.tsx so the gateway sees
// an identical payload. Domain matches NewtonPolicyWallet.sol's
// EIP712("NewtonPolicyWallet","1") with verifyingContract = the deployed wallet.
export const INTENT_EIP712_TYPES = {
  Intent: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'data', type: 'bytes' },
    { name: 'chainId', type: 'uint256' },
    { name: 'functionSignature', type: 'bytes' },
  ],
} as const;

export interface RawIntent {
  from: Address;
  to: Address;
  value: Hex; // editor-style hex string ("0x1", "0xde0b6b3a7640000")
  data: Hex;
  chainId: number;
  functionSignature: Hex;
}

export async function signIntent(
  walletClient: AnyWalletClient,
  policyClient: Address,
  intent: RawIntent,
): Promise<Hex> {
  return walletClient.signTypedData({
    account: walletClient.account!,
    domain: {
      name: 'NewtonPolicyWallet',
      version: '1',
      chainId: intent.chainId,
      verifyingContract: policyClient,
    },
    types: INTENT_EIP712_TYPES,
    primaryType: 'Intent',
    message: {
      from: intent.from,
      to: intent.to,
      value: BigInt(intent.value),
      data: intent.data,
      chainId: BigInt(intent.chainId),
      functionSignature: intent.functionSignature,
    },
  });
}

// Per docs: the SDK wants the FULL human-readable ABI string hex-encoded —
// not the 4-byte selector. Using the selector causes silent decoding failures.
export function functionSignatureToHex(humanReadable: string): Hex {
  const bytes = new TextEncoder().encode(humanReadable);
  return toHex(bytes);
}

// Exact string for the wallet's gating function — matches NewtonPolicyWallet.sol
// (and HelloWorldPolicyClient.ts).
export const VALIDATE_AND_EXECUTE_DIRECT_SIGNATURE =
  'validateAndExecuteDirect(address,uint256,bytes,(bytes32,address,uint32,uint32,(address,address,uint256,bytes,uint256,bytes),bytes,bytes,bytes,uint256),(bytes32,address,bytes32,address,(address,address,uint256,bytes,uint256,bytes),bytes,bytes,(bytes32,address,bytes,(bytes,bytes,address,uint32)[]),(bytes,uint32),uint256),bytes)';
