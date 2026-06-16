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
 * On-chain identity + content addressing for a pack's deployed oracle
 * (`NewtonPolicyData`) on a given chain. Mirrors the per-pack-per-chain
 * entries in the upstream `deployments.json`.
 *
 * A pack ships a reusable **oracle** (`NewtonPolicyData`), NOT a blessed
 * policy. There is no `policy` (`NewtonPolicy`) field: the pack's `policy.rego`
 * is a *reference* that curators copy and deploy as their own `NewtonPolicy`
 * — single-pack (one `policyData`) or composite (N `policyData`). The
 * reusable, verifiable artifacts a curator references are `policyData` +
 * `wasmCid`; see `docs/writing-composite-policies.md`.
 *
 * - `policyData`   — the `NewtonPolicyData` contract address. The reusable
 *                    oracle. A curator's `NewtonPolicy` references one (or
 *                    more, for composites) of these via
 *                    `--policy-data-address`.
 * - `wasmCid`      — IPFS CID of the compiled WASM oracle. Pinned by Pinata
 *                    in production; serves as the WASM identity in the
 *                    Newton AVS evaluation contract, and the value a
 *                    depositor verifies against `INewtonPolicyData.getWasmCid()`.
 * - `policyCodeHash` — keccak hash of the deployed `policy.rego` source plus
 *                      WASM bytecode. The AVS uses this to refuse
 *                      attestations against an unverified pack version.
 * - `deployedAt`   — date the pack version landed on this chain (ISO date,
 *                    no time of day; redeploys overwrite).
 */
export interface Deployment {
	readonly policyData: Address;
	readonly wasmCid: string;
	/**
	 * WASM cids this pack's oracle previously served on this `(chainId, env)`
	 * cell, before redeploys superseded them. Recorded by
	 * `scripts/sync-deployments.sh` on each redeploy (the superseded `wasmCid` is
	 * appended). The composite builder's historical-pin path treats
	 * `{wasmCid} ∪ priorWasmCids` as this module's attested cid set, so a curator
	 * pinning a genuinely-historical address can only claim a cid the module
	 * actually produced — this is what binds a pinned `(address, cid)` to the
	 * module's identity. Absent on cells that have never been redeployed (there
	 * is nothing to attest yet, and the historical-pin path falls back to
	 * curator-asserted trust for such modules).
	 */
	readonly priorWasmCids?: readonly string[];
	readonly policyCodeHash: Hex;
	readonly deployedAt: string;
}
