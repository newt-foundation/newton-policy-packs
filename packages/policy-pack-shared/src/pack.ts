import type { Address, Hex, PublicClient } from "viem";
import type { z } from "zod";
import type { ChainId, Deployment } from "./deployment";

/**
 * Inputs that a pack's `prepareQuery` reads at intent-build time.
 *
 * The Shield SDK passes a viem `PublicClient` (so the pack can read on-chain
 * state) and the vault address the curator is acting on. Packs that don't
 * need on-chain state can ignore both — `prepareQuery` is optional.
 */
export interface PrepareQueryArgs {
	readonly publicClient: PublicClient;
	readonly vault: Address;
}

/**
 * `wasmArgs` payload (untyped at this layer; each pack narrows it via its own
 * `WasmArgsSchema`) plus an optional pre-image hash for binding the AVS-side
 * evaluation to a specific on-chain state. VaultsFYI uses this to bind the
 * evaluation to a `keccak(supplyQueue)` snapshot so the policy can reject
 * attestations whose underlying allocation has shifted between intent build
 * and on-chain submission.
 */
export interface PrepareQueryResult<TWasmArgs> {
	readonly wasmArgs: TWasmArgs;
	readonly freshnessHash?: Hex;
}

/**
 * Canonical typed contract every published `@newton-xyz/policy-pack-<name>`
 * package implements. `@newton-xyz/newton-shield-sdk`'s `createShield(...)`
 * accepts `PolicyPack<P, W, S>` as the curator's pack argument.
 *
 * Type parameters:
 * - `TParams`   — the shape stored on-chain in `NewtonPolicyData.policyParams`
 *                  (e.g. risk envelope thresholds for VaultsFYI).
 * - `TWasmArgs` — the shape passed to the policy's WASM oracle at evaluation
 *                  time (e.g. `{ vault, network, lastKnownAllocationHash }`).
 * - `TSecrets`  — required API credentials uploaded before any run/sim.
 *
 * The fields:
 * - `id`             — stable identifier of the form `<pack>/<purpose>/<version>`,
 *                       e.g. `vaultsfyi/risk-envelope/v1`. Used for telemetry
 *                       and for cross-referencing the `policy_metadata.json`.
 * - `paramsSchema`   — zod schema enforced at curator setup time when the
 *                       pack is bound to a `NewtonPolicyData`.
 * - `wasmArgsSchema` — zod schema enforced per call when the SDK builds the
 *                       intent and forwards `wasmArgs` to the gateway.
 * - `secretsSchema`  — zod schema enforced at upload-time. Validates the
 *                       shape of the secrets the operator stores in the AVS.
 * - `encodeParams` / `decodeParams` — ABI round-trip for the on-chain
 *                       `policyParams` bytes. Must round-trip cleanly so the
 *                       SDK can read the on-chain value back and confirm it
 *                       matches the curator's intended config.
 * - `prepareQuery`   — optional. When present, the SDK invokes it on every
 *                       call to gather chain-state freshness inputs. Packs
 *                       that don't need this (e.g. KYC-only packs) omit it.
 * - `deployments`    — `chainId → Deployment` map sliced from the upstream
 *                       `deployments.json` for this pack only. The SDK reads
 *                       `deployments[chainId].policy` to wire the clone.
 * - `metadata`       — static identity from the pack's `policy_metadata.json`.
 */
export interface PolicyPack<TParams, TWasmArgs, TSecrets> {
	readonly id: string;
	readonly paramsSchema: z.ZodType<TParams>;
	readonly wasmArgsSchema: z.ZodType<TWasmArgs>;
	readonly secretsSchema: z.ZodType<TSecrets>;
	encodeParams(params: TParams): Hex;
	decodeParams(encoded: Hex): TParams;
	prepareQuery?(args: PrepareQueryArgs): Promise<PrepareQueryResult<TWasmArgs>>;
	readonly deployments: Readonly<Record<ChainId, Deployment>>;
	readonly metadata: {
		readonly name: string;
		readonly version: string;
		readonly description: string;
		readonly author?: string;
		readonly link?: string;
	};
}
