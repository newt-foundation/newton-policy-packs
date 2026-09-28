// Hand-written canonical export — survives `pnpm gen:bindings` regen.
// The generated `index.ts` re-exports `pack.ts` when present.
import { defineOracle } from "@newton-xyz/policy-core";
import { deployments } from "./deployments";
import { PACK_AUTHOR, PACK_DESCRIPTION, PACK_LINK, PACK_NAME, PACK_VERSION } from "./metadata";
import { ParamsSchema } from "./params";
import { SecretsSchema } from "./secrets";
import { WasmArgsSchema } from "./wasm-args";

/**
 * The Xerberus portfolio what-if `PolicyPack`.
 *
 * Calls Xerberus's `what_if` MCP tool to simulate the managed portfolio before
 * and after a proposed change, and gates on the change in concentration, token
 * HHI, the share of the book exitable within 30 days, and the slowest exit.
 *
 * No `prepareQuery`: `wasmArgs` (`wallets`, `add`, `remove`, optional
 * `impact_pct`, `chain`, `window`) is curator-supplied at intent-build time.
 */
export const xerberus_what_if = defineOracle({
	id: `${PACK_NAME}/portfolio-what-if/v1`,
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
