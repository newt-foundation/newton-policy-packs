// Hand-written canonical export — survives `pnpm gen:bindings` regen.
// The generated `index.ts` re-exports `pack.ts` when present.
import { defineOracle } from "@newton-xyz/policy-core";
import { deployments } from "./deployments";
import { PACK_AUTHOR, PACK_DESCRIPTION, PACK_LINK, PACK_NAME, PACK_VERSION } from "./metadata";
import { ParamsSchema } from "./params";
import { SecretsSchema } from "./secrets";
import { WasmArgsSchema } from "./wasm-args";

/**
 * The Arkham adaptive-counterparty `PolicyPack`.
 *
 * Measures the proposed payment against the sender's own history: whether the recipient
 * is an established counterparty, whether the amount matches prior transactions, and
 * whether total outflow is still within the wallet's normal range.
 *
 * Pass to `createShield(...)` from `@newton-xyz/newton-shield-sdk`. Encoding for the
 * on-chain `policyParams` blob is handled by `encodePolicyParams` / `decodePolicyParams`
 * in `@newton-xyz/policy-core` (UTF-8 JSON, sorted keys) — not per-pack.
 *
 * No `prepareQuery`: this pack's `wasmArgs` name an entity the SDK cannot infer from
 * on-chain state, so the curator supplies them directly at intent-build time — the same
 * shape as `@newton-xyz/policy-pack-balancer`.
 */
export const arkham_counterparty = defineOracle({
	id: `${PACK_NAME}/counterparty-activity/v1`,
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
