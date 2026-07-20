// Hand-written canonical export — survives `pnpm gen:bindings` regen.
// The generated `index.ts` re-exports `pack.ts` when present.
import { defineOracle } from "@newton-xyz/policy-core";
import { deployments } from "./deployments";
import { PACK_AUTHOR, PACK_DESCRIPTION, PACK_LINK, PACK_NAME, PACK_VERSION } from "./metadata";
import { ParamsSchema } from "./params";
import { prepareQuery } from "./prepare-query";
import { SecretsSchema } from "./secrets";
import { WasmArgsSchema } from "./wasm-args";

export { type PrepareQueryOptions, prepareQuery } from "./prepare-query";

/**
 * The SumSub KYC `PolicyPack`.
 *
 * Pass to `createShield(...)` from `@newton-xyz/newton-shield-sdk`. Encoding
 * for the on-chain `policyParams` blob is handled by `encodePolicyParams` /
 * `decodePolicyParams` in `@newton-xyz/policy-core` (UTF-8 JSON,
 * sorted keys) — not per-pack. The `required_review_answer` enum
 * (`"GREEN"|"YELLOW"|"RED"`) round-trips as a plain JSON string.
 *
 * `prepareQuery` reads `walletAddress` from the SDK's per-call options bag
 * (typically `IntentArgs.from`).
 */
export const sumsub = defineOracle({
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
});
