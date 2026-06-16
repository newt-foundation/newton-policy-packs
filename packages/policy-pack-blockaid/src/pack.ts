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
 * The Blockaid transaction-scan `PolicyPack`.
 *
 * Pass to `createShield(...)` from `@newton-xyz/newton-shield-sdk`. Encoding
 * for the on-chain `policyParams` blob is handled by `encodePolicyParams` /
 * `decodePolicyParams` in `@newton-xyz/policy-pack-shared` (UTF-8 JSON,
 * sorted keys) — not per-pack.
 *
 * `prepareQuery` derives the Blockaid `chain` slug from `publicClient.chain.id`
 * and reads `from`/`to`/`value`/`data` from the SDK's per-call options bag —
 * these mirror the on-chain transaction the depositor is about to submit, so
 * they can't be inferred from `PrepareQueryArgs` alone.
 */
export const blockaid: PolicyPack<Params, WasmArgs, Secrets> = {
	id: `${PACK_NAME}/transaction-scan/v1`,
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
 * Composite-policy view of the blockaid pack. Pass to `defineComposite(...)`
 * (Phase 2 — see `docs/composite-policies.md`) when stacking blockaid with
 * other packs in one Shield. Strict subset of the `PolicyPack` above —
 * shares the same `id`, schemas, and deployments.
 */
export const blockaidOracleModule: OracleModule<Params, WasmArgs, Secrets> =
	oracleModuleFromPack(blockaid);
