import type { Address, Hex } from "viem";

/**
 * Decimal-string chain id, e.g. `"11155111"` for Ethereum Sepolia.
 *
 * Kept as a string union (not `number`) so the shape matches the upstream
 * `deployments.json` keys verbatim — JSON object keys are always strings,
 * and downstream consumers iterating `Object.entries(deployments)` get the
 * same type they'd see at runtime.
 */
export type ChainId = string;

/**
 * Newton AVS environment. Mirrors `@newton-xyz/newton-shield-sdk`'s
 * `GatewayEnv`. The same `(chainId)` may have separate deployments under
 * each env — distinct gateways, distinct TaskManager addresses, distinct
 * registered operators. A pack policy deployed under `stagef` will not be
 * evaluated by `prod` operators and vice versa.
 */
export type GatewayEnv = "stagef" | "prod";

/**
 * On-chain address pair + content addressing for a deployed Newton policy
 * on a given chain. Mirrors the per-pack-per-chain entries in the upstream
 * `deployments.json`.
 *
 * - `policy`       — the `NewtonPolicy` contract address. The Shield clone's
 *                    `setPolicyAddress(policy)` argument.
 * - `policyData`   — the `NewtonPolicyData` contract address. Holds the
 *                    on-chain `policyParams` blob the SDK encodes via the
 *                    pack's `ParamsSchema`.
 * - `wasmCid`      — IPFS CID of the compiled WASM oracle. Pinned by Pinata
 *                    in production; serves as the WASM identity in the
 *                    Newton AVS evaluation contract.
 * - `policyCodeHash` — keccak hash of the deployed `policy.rego` source plus
 *                      WASM bytecode. The AVS uses this to refuse
 *                      attestations against an unverified pack version.
 * - `deployedAt`   — date the pack version landed on this chain (ISO date,
 *                    no time of day; redeploys overwrite).
 */
export interface Deployment {
	readonly policy: Address;
	readonly policyData: Address;
	readonly wasmCid: string;
	readonly policyCodeHash: Hex;
	readonly deployedAt: string;
}
