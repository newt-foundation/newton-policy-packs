// Hand-written canonical export — survives `pnpm gen:bindings` regen.
// The generated `index.ts` re-exports `pack.ts` when present.
import {
	type OracleModule,
	oracleModuleFromPack,
	type PolicyPack,
} from "@newton-xyz/policy-pack-shared";
import { deployments } from "./deployments";
import { PACK_AUTHOR, PACK_DESCRIPTION, PACK_LINK, PACK_NAME, PACK_VERSION } from "./metadata";
import { type Params, ParamsJsonSchema, ParamsSchema } from "./params";
import { prepareQuery } from "./prepare-query";
import { type Secrets, SecretsSchema } from "./secrets";
import { type WasmArgs, WasmArgsSchema } from "./wasm-args";

export { type PrepareQueryOptions, prepareQuery } from "./prepare-query";

/**
 * The Chainalysis sanctions + screening `PolicyPack`.
 *
 * Pass to `createShield(...)` from `@newton-xyz/newton-shield-sdk`. Encoding
 * for the on-chain `policyParams` blob is handled by `encodePolicyParams` /
 * `decodePolicyParams` in `@newton-xyz/policy-pack-shared` (UTF-8 JSON,
 * sorted keys) — not per-pack.
 *
 * `prepareQuery` reads the `address` to screen from the SDK's per-call
 * options bag (typically `IntentArgs.from`).
 */
export const chainalysis: PolicyPack<Params, WasmArgs, Secrets> = {
	id: `${PACK_NAME}/screening/v1`,
	paramsSchema: ParamsSchema,
	paramsJsonSchema: ParamsJsonSchema,
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
 * Composite-policy view of the chainalysis pack. Pass to
 * `defineComposite(...)` (Phase 2 — see `docs/composite-policies.md`) when
 * stacking chainalysis with other packs in one Shield. Strict subset of the
 * `PolicyPack` above — shares the same `id`, schemas, and deployments.
 */
export const chainalysisOracleModule: OracleModule<Params, WasmArgs, Secrets> =
	oracleModuleFromPack(chainalysis);
