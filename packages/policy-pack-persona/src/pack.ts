// Hand-written canonical export — survives `pnpm gen:bindings` regen.
// The generated `index.ts` re-exports `pack.ts` when present.
import type { PolicyPack } from "@newton-xyz/policy-pack-shared";
import { deployments } from "./deployments";
import { PACK_AUTHOR, PACK_DESCRIPTION, PACK_LINK, PACK_NAME, PACK_VERSION } from "./metadata";
import { type Params, ParamsSchema } from "./params";
import { prepareQuery } from "./prepare-query";
import { type Secrets, SecretsSchema } from "./secrets";
import { type WasmArgs, WasmArgsSchema } from "./wasm-args";

export { type PrepareQueryOptions, prepareQuery } from "./prepare-query";

/**
 * The Persona KYC `PolicyPack`.
 *
 * Pass to `createShield(...)` from `@newton-xyz/newton-shield-sdk`. Encoding
 * for the on-chain `policyParams` blob is handled by `encodePolicyParams` /
 * `decodePolicyParams` in `@newton-xyz/policy-pack-shared` (UTF-8 JSON,
 * sorted keys) — not per-pack. `allowed_countries` (ISO alpha-2 string
 * array) round-trips cleanly through the JSON encoder.
 *
 * `prepareQuery` reads `walletAddress` from the SDK's per-call options bag
 * (typically `IntentArgs.from`).
 */
export const persona: PolicyPack<Params, WasmArgs, Secrets> = {
	id: `${PACK_NAME}/kyc/v1`,
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
