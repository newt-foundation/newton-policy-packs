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
 * The Guardrail protocol-alerts `PolicyPack`.
 *
 * Pass to `createShield(...)` from `@newton-xyz/newton-shield-sdk`. Encoding
 * for the on-chain `policyParams` blob is handled by `encodePolicyParams` /
 * `decodePolicyParams` in `@newton-xyz/policy-core` (UTF-8 JSON,
 * sorted keys) — not per-pack.
 *
 * `prepareQuery` populates `vaultAddress` from `PrepareQueryArgs.target` and
 * `chainId` from `publicClient.chain.id` (both overridable for testing via the
 * pack's own `vaultAddress` / `chainId` options). A curator that prefers
 * protocol-level alerts can pass `protocolId` via the options bag.
 */
export const guardrail = defineOracle({
	id: `${PACK_NAME}/protocol-alerts/v1`,
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
