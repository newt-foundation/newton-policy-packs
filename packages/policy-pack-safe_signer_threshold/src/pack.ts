// Hand-written canonical export — survives `pnpm gen:bindings` regen.
// The generated `index.ts` re-exports `pack.ts` when present.
import { defineOracle } from "@newton-xyz/policy-core";
import { deployments } from "./deployments";
import { PACK_AUTHOR, PACK_DESCRIPTION, PACK_LINK, PACK_NAME, PACK_VERSION } from "./metadata";
import { ParamsSchema } from "./params";
import { SecretsSchema } from "./secrets";
import { WasmArgsSchema } from "./wasm-args";

/**
 * The Safe (formerly Gnosis Safe) owner/threshold configuration-gate `PolicyPack`.
 *
 * Reads `getThreshold()` and `getOwners()` directly off the Safe over JSON-RPC and
 * gates on the Safe's identity plus an M-of-N envelope. Catches the threshold
 * downgrade — a 3-of-5 Safe that owners have since reconfigured to 1-of-1 — before
 * the downgraded Safe gets used.
 *
 * Pass to `createShield(...)` from `@newton-xyz/newton-shield-sdk`. Encoding for the
 * on-chain `policyParams` blob is handled by `encodePolicyParams` /
 * `decodePolicyParams` in `@newton-xyz/policy-core` (UTF-8 JSON, sorted keys) — not
 * per-pack.
 *
 * No `prepareQuery`: `wasmArgs` (`safeAddress`, `chainId`) is curator-supplied at
 * intent-build time — the same shape as `@newton-xyz/policy-pack-balancer`. The RPC
 * endpoints are policy secrets rather than `wasmArgs` so the endpoint (and any API
 * key in its path) never lands in the AVS-visible task payload.
 */
export const safe_signer_threshold = defineOracle({
	id: `${PACK_NAME}/owner-threshold/v1`,
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
