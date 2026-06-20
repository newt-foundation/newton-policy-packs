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
import { type Secrets, SecretsSchema } from "./secrets";
import { type WasmArgs, WasmArgsSchema } from "./wasm-args";

/**
 * The Balancer v3 pool risk-gate `PolicyPack`.
 *
 * Pass to `createShield(...)` from `@newton-xyz/newton-shield-sdk`. Encoding
 * for the on-chain `policyParams` blob is handled by `encodePolicyParams` /
 * `decodePolicyParams` in `@newton-xyz/policy-pack-shared` (UTF-8 JSON,
 * sorted keys) — not per-pack.
 *
 * No `prepareQuery`: `wasmArgs` (`poolId`, `chain`, optional
 * `allowed_token_addresses`) is curator-supplied at intent-build time. The
 * pack does not read on-chain state to populate them.
 */
export const balancer: PolicyPack<Params, WasmArgs, Secrets> = {
	id: `${PACK_NAME}/risk-envelope/v1`,
	paramsSchema: ParamsSchema,
	paramsJsonSchema: ParamsJsonSchema,
	wasmArgsSchema: WasmArgsSchema,
	secretsSchema: SecretsSchema,
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
 * Composite-policy view of the balancer pack. Pass to `defineComposite(...)`
 * (Phase 2 — see `docs/composite-policies.md`) when stacking balancer with
 * other packs in one Shield. Strict subset of the `PolicyPack` above —
 * shares the same `id`, schemas, and deployments.
 */
export const balancerOracleModule: OracleModule<Params, WasmArgs, Secrets> =
	oracleModuleFromPack(balancer);
