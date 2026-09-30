// Hand-written canonical export — survives `pnpm gen:bindings` regen.
// The generated `index.ts` re-exports `pack.ts` when present.
import { defineOracle } from "@newton-xyz/policy-core";
import { deployments } from "./deployments";
import { PACK_AUTHOR, PACK_DESCRIPTION, PACK_LINK, PACK_NAME, PACK_VERSION } from "./metadata";
import { ParamsSchema } from "./params";
import { SecretsSchema } from "./secrets";
import { WasmArgsSchema } from "./wasm-args";

/**
 * The Xerberus liquidity-exit `PolicyPack`.
 *
 * Calls Xerberus's `liquidity_exit_quote` MCP tool for a proposed token position
 * and gates on how many days it would take to unwind within a bounded market
 * impact, plus the freshness of the Xerberus data window.
 *
 * No `prepareQuery`: `wasmArgs` (`token`, `usd_notional`, optional `impact_pct`,
 * `chain`, `window`) is curator-supplied at intent-build time. Pass the same
 * `window` to every `xerberus_*` pack in a composite so all three results come
 * from one Xerberus snapshot.
 */
export const xerberus_liquidity_exit = defineOracle({
	id: `${PACK_NAME}/liquidity-exit/v1`,
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
