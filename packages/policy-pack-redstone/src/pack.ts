// Hand-written canonical export — survives `pnpm gen:bindings` regen.
// The generated `index.ts` re-exports `pack.ts` when present.
import {
	type OracleModule,
	oracleModuleFromPack,
	type PolicyPack,
} from "@newton-xyz/policy-pack-shared";
import { deployments } from "./deployments";
import { PACK_AUTHOR, PACK_DESCRIPTION, PACK_LINK, PACK_NAME, PACK_VERSION } from "./metadata";
import { type Params, ParamsSchema } from "./params";
import { prepareQuery } from "./prepare-query";
import { type Secrets, SecretsSchema } from "./secrets";
import { type WasmArgs, WasmArgsSchema } from "./wasm-args";

export { type PrepareQueryOptions, prepareQuery } from "./prepare-query";

/**
 * The RedStone oracle-divergence `PolicyPack`.
 *
 * Pass to `createShield(...)` from `@newton-xyz/newton-shield-sdk`. Encoding
 * for the on-chain `policyParams` blob is handled by `encodePolicyParams` /
 * `decodePolicyParams` in `@newton-xyz/policy-pack-shared` (UTF-8 JSON,
 * sorted keys) — not per-pack.
 *
 * `prepareQuery` accepts the curator-configured `symbol`, `rpcUrl`,
 * `onchainOracle`, optional `provider`, and the prior-call
 * `prevSnapshot` ({divergenceBp, timestampMs}) via the per-call options
 * bag. The snapshot drives sustained-divergence tracking — mirrors
 * VaultsFYI's `previousAllocationHash` freshness pattern.
 */
export const redstone: PolicyPack<Params, WasmArgs, Secrets> = {
	id: `${PACK_NAME}/oracle-divergence/v1`,
	paramsSchema: ParamsSchema,
	wasmArgsSchema: WasmArgsSchema,
	secretsSchema: SecretsSchema,
	prepareQuery,
	deployments,
	metadata: {
		name: PACK_NAME,
		version: PACK_VERSION,
		description: PACK_DESCRIPTION,
		author: PACK_AUTHOR || undefined,
		link: PACK_LINK || undefined,
	},
};

/**
 * Composite-policy view of the redstone pack. Pass to `defineComposite(...)`
 * (Phase 2 — see `docs/composite-policies.md`) when stacking redstone with
 * other packs in one Shield. Strict subset of the `PolicyPack` above —
 * shares the same `id`, schemas, and deployments.
 */
export const redstoneOracleModule: OracleModule<Params, WasmArgs, Secrets> =
	oracleModuleFromPack(redstone);
