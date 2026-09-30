// Hand-written canonical export — survives `pnpm gen:bindings` regen.
// The generated `index.ts` re-exports `pack.ts` when present.
import { defineOracle } from "@newton-xyz/policy-core";
import { deployments } from "./deployments";
import { PACK_AUTHOR, PACK_DESCRIPTION, PACK_LINK, PACK_NAME, PACK_VERSION } from "./metadata";
import { ParamsSchema } from "./params";
import { SecretsSchema } from "./secrets";
import { WasmArgsSchema } from "./wasm-args";

/**
 * The Xerberus common-cause `PolicyPack`.
 *
 * Calls Xerberus's `common_cause` MCP tool over the venues a portfolio holds and
 * gates on failure mechanisms they share: missing safeguards carrying too much
 * combined exposure, forbidden shared dependencies, and outsized shared
 * collateral.
 *
 * No `prepareQuery`: `wasmArgs` (`wallets`, optional `chain`, `window`) is
 * curator-supplied at intent-build time.
 */
export const xerberus_common_cause = defineOracle({
	id: `${PACK_NAME}/common-cause/v1`,
	paramsSchema: ParamsSchema,
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
});
