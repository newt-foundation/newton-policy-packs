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
 * Reads the venues a portfolio holds from Xerberus's `get_positions`, runs
 * `shared_dependencies_nodes` over them, and gates on upstream nodes they
 * share: too much of the book behind one node (in USD or as a share), a high
 * expected loss share, or a forbidden node id.
 *
 * No `prepareQuery`: `wasmArgs` (`wallets`, optional `chain`, `relations`,
 * `window`) is
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
