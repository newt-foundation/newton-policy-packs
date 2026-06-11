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
 *
 * Encoding is *not* a per-pack concern. The on-chain `policyParams` byte
 * format is a Newton-protocol invariant — UTF-8 JSON, sorted keys —
 * implemented once in this package as `encodePolicyParams` /
 * `decodePolicyParams`. See `./encoding.ts`. Earlier shapes of this
 * interface required each pack to ship its own `encodeParams` /
 * `decodeParams`; that structurally invited drift (vaultsfyi@0.2.0 shipped
 * ABI bytes against an AVS that reads `serde_json::from_str`, breaking
 * every call). The interface now leaves byte-format to the protocol.
 *
 * - `prepareQuery`   — optional. When present, the SDK invokes it on every
 *                       call to gather chain-state freshness inputs. Packs
 *                       that don't need this (e.g. KYC-only packs) omit it.
 *                       The optional second `options` argument is a
 *                       pack-typed escape hatch for per-call overrides —
 *                       e.g. VaultsFYI's `previousAllocationHash` for
 *                       freshness binding. Each concrete pack narrows it
 *                       via its own `prepareQuery` signature; the shared
 *                       interface keeps it `unknown` so the SDK can
 *                       forward it verbatim.
 * - `deployments`    — `chainId → Deployment` map sliced from the upstream
 *                       `deployments.json` for this pack only. Typed as
 *                       `Partial<Record<ChainId, Deployment>>` so callers
 *                       must handle `undefined` for unsupported chains
 *                       rather than silently reading `.policy` off nothing.
 *                       Use `getDeployment(pack, chainId)` from this package
 *                       for the safe lookup.
 * - `metadata`       — static identity from the pack's `policy_metadata.json`.
 */
export interface PolicyPack<TParams, TWasmArgs, TSecrets> {
	readonly id: string;
	readonly paramsSchema: z.ZodType<TParams>;
	readonly wasmArgsSchema: z.ZodType<TWasmArgs>;
	readonly secretsSchema: z.ZodType<TSecrets>;
	prepareQuery?(args: PrepareQueryArgs, options?: unknown): Promise<PrepareQueryResult<TWasmArgs>>;
	readonly deployments: Readonly<Partial<Record<ChainId, Deployment>>>;
	readonly metadata: {
		readonly name: string;
		readonly version: string;
		readonly description: string;
		readonly author?: string;
		readonly link?: string;
	};
}

/**
 * Safe lookup helper. Returns the `Deployment` for `chainId` if the pack is
 * deployed on that chain, or throws `UnsupportedChainError` with the list of
 * chain ids the pack is known to support. Use this at every SDK callsite that
 * reads `pack.deployments[chainId]` so unsupported-chain failures surface
 * immediately rather than as `undefined.policy` further down.
 */
export function getDeployment<TParams, TWasmArgs, TSecrets>(
	pack: PolicyPack<TParams, TWasmArgs, TSecrets>,
	chainId: ChainId,
): Deployment {
	const deployment = pack.deployments[chainId];
	if (!deployment) {
		const supported = Object.keys(pack.deployments).sort().join(", ") || "(none)";
		throw new UnsupportedChainError(
			`Pack \`${pack.id}\` is not deployed on chain ${chainId}. Supported: ${supported}.`,
			pack.id,
			chainId,
			Object.keys(pack.deployments),
		);
	}
	return deployment;
}

/**
 * Thrown by `getDeployment` when a pack is asked for a chain it isn't
 * deployed on. SDK consumers can catch this specifically to surface a
 * curator-friendly error rather than a `TypeError: Cannot read property
 * 'policy' of undefined`.
 */
export class UnsupportedChainError extends Error {
	override readonly name = "UnsupportedChainError";
	constructor(
		message: string,
		readonly packId: string,
		readonly chainId: ChainId,
		readonly supportedChainIds: ReadonlyArray<ChainId>,
	) {
		super(message);
	}
}
