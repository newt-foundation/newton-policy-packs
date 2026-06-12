// Hand-written canonical export — survives `pnpm gen:bindings` regen.
// The generated `index.ts` re-exports `pack.ts` when present.
import type { PolicyPack } from "@newton-xyz/policy-pack-shared";
import { z } from "zod";
import { deployments } from "./deployments";
import { PACK_AUTHOR, PACK_DESCRIPTION, PACK_LINK, PACK_NAME, PACK_VERSION } from "./metadata";
import { type Params, ParamsSchema } from "./params";
import { prepareQuery } from "./prepare-query";
import { type Secrets, SecretsSchema } from "./secrets";
import { type WasmArgs, WasmArgsSchema } from "./wasm-args";

const BASIS_POINTS = 10_000;

/**
 * Curator-side input refinement: reject sub-basis-point precision on the
 * fractional thresholds. A curator typing `tvl_drawdown_24h_max_pct: 0.00005`
 * almost certainly means 5bp (`0.0005`); the previous ABI encoder would have
 * silently rounded to `0n` and disabled the cap. Kept as defensive validation
 * even though the JSON encoder no longer rounds — the policy semantics are
 * still defined to basis-point granularity. `risk_score_floor` is excluded;
 * it's an integer 0-100 scale that matches the AVS-side `vault.scores.netScore`
 * field directly.
 */
const isAtBasisPointPrecision = (n: number) =>
	Math.abs(n * BASIS_POINTS - Math.round(n * BASIS_POINTS)) < Number.EPSILON;

export const RefinedParamsSchema = (ParamsSchema as unknown as z.ZodType<Params>).superRefine(
	(params, ctx) => {
		const numericFields: ReadonlyArray<keyof Params> = [
			"apy_z_max",
			"tvl_drawdown_24h_max_pct",
			"tvl_drawdown_7d_max_pct",
		];
		for (const field of numericFields) {
			const value = params[field] as number;
			if (!isAtBasisPointPrecision(value)) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: [field],
					message: `Sub-basis-point precision is not supported. \`${field}: ${value}\` would silently encode as ${
						Math.round(value * BASIS_POINTS) / BASIS_POINTS
					}. Round to 4 decimal places (1bp) before passing.`,
				});
			}
		}
	},
);

/**
 * The vaults.fyi risk-envelope `PolicyPack`.
 *
 * Pass to `createShield(...)` from `@newton-xyz/newton-shield-sdk`. The
 * on-chain `policyParams` byte format is handled by the canonical
 * `encodePolicyParams` / `decodePolicyParams` utilities in
 * `@newton-xyz/policy-pack-shared` (UTF-8 JSON, sorted keys) — not per-pack.
 *
 * ```ts
 * import { vaultsfyi } from "@newton-xyz/policy-pack-vaultsfyi";
 * import { encodePolicyParams } from "@newton-xyz/policy-pack-shared";
 *
 * const params = {
 *   apy_z_max: 3,
 *   tvl_drawdown_24h_max_pct: 0.05,
 *   tvl_drawdown_7d_max_pct: 0.20,
 *   risk_score_floor: 85, // 0-100 integer; matches AVS `vault.scores.netScore`
 *   deny_on_allocation_change: true,
 *   deny_on_critical_flag: true,
 *   deny_on_corrupted: true,
 * };
 * const policyParams = encodePolicyParams(vaultsfyi, params);
 * ```
 */
export const vaultsfyi: PolicyPack<Params, WasmArgs, Secrets> = {
	id: `${PACK_NAME}/risk-envelope/v1`,
	paramsSchema: RefinedParamsSchema,
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
