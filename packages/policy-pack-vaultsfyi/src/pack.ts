// Hand-written canonical export — survives `pnpm gen:bindings` regen.
// The generated `index.ts` re-exports `pack.ts` when present.
import type { PolicyPack } from "@newton-xyz/policy-pack-shared";
import { decodeAbiParameters, encodeAbiParameters, type Hex } from "viem";
import { deployments } from "./deployments";
import { PACK_AUTHOR, PACK_DESCRIPTION, PACK_LINK, PACK_NAME, PACK_VERSION } from "./metadata";
import { type Params, ParamsSchema } from "./params";
import { prepareQuery } from "./prepare-query";
import { type Secrets, SecretsSchema } from "./secrets";
import { type WasmArgs, WasmArgsSchema } from "./wasm-args";

/**
 * On-chain layout of `policyParams` for the vaults.fyi risk-envelope policy.
 *
 * This is the ABI tuple that round-trips through `NewtonPolicyData.policyParams`.
 * Keys are sorted to match `ParamsSchema`'s key order so generated zod and
 * encoded bytes stay in sync. If the schema adds a field, add it here in the
 * same position and bump the policy contract.
 */
const POLICY_PARAMS_ABI = [
	{
		type: "tuple",
		components: [
			{ name: "apyZMax", type: "uint256" },
			{ name: "tvlDrawdown24hMaxPct", type: "uint256" },
			{ name: "tvlDrawdown7dMaxPct", type: "uint256" },
			{ name: "riskScoreFloor", type: "uint256" },
			{ name: "denyOnAllocationChange", type: "bool" },
			{ name: "denyOnCriticalFlag", type: "bool" },
			{ name: "denyOnCorrupted", type: "bool" },
		],
	},
] as const;

/**
 * The numeric thresholds in `ParamsSchema` are stored in basis points so the
 * on-chain bytes carry only `uint256`. `apy_z_max: 1.5` becomes `15000`
 * (1.5e4 bp); a `0.85` floor becomes `8500`. Round to integer at encode time.
 */
const BASIS_POINTS = 10_000;

function toBp(n: number): bigint {
	return BigInt(Math.round(n * BASIS_POINTS));
}

function fromBp(n: bigint): number {
	return Number(n) / BASIS_POINTS;
}

function encodeParams(params: Params): Hex {
	return encodeAbiParameters(POLICY_PARAMS_ABI, [
		{
			apyZMax: toBp(params.apy_z_max),
			tvlDrawdown24hMaxPct: toBp(params.tvl_drawdown_24h_max_pct),
			tvlDrawdown7dMaxPct: toBp(params.tvl_drawdown_7d_max_pct),
			riskScoreFloor: toBp(params.risk_score_floor),
			denyOnAllocationChange: params.deny_on_allocation_change,
			denyOnCriticalFlag: params.deny_on_critical_flag,
			denyOnCorrupted: params.deny_on_corrupted,
		},
	]);
}

function decodeParams(encoded: Hex): Params {
	const [decoded] = decodeAbiParameters(POLICY_PARAMS_ABI, encoded);
	return ParamsSchema.parse({
		apy_z_max: fromBp(decoded.apyZMax),
		tvl_drawdown_24h_max_pct: fromBp(decoded.tvlDrawdown24hMaxPct),
		tvl_drawdown_7d_max_pct: fromBp(decoded.tvlDrawdown7dMaxPct),
		risk_score_floor: fromBp(decoded.riskScoreFloor),
		deny_on_allocation_change: decoded.denyOnAllocationChange,
		deny_on_critical_flag: decoded.denyOnCriticalFlag,
		deny_on_corrupted: decoded.denyOnCorrupted,
	});
}

/**
 * The vaults.fyi risk-envelope `PolicyPack`.
 *
 * Pass to `createShield(...)` from `@newton-xyz/newton-shield-sdk`:
 *
 * ```ts
 * import { vaultsfyi } from "@newton-xyz/policy-pack-vaultsfyi";
 *
 * const shield = await createShield({
 *   walletClient,
 *   vault,
 *   pack: vaultsfyi,
 *   params: {
 *     apy_z_max: 3,
 *     tvl_drawdown_24h_max_pct: 0.05,
 *     tvl_drawdown_7d_max_pct: 0.20,
 *     risk_score_floor: 0.85,
 *     deny_on_allocation_change: true,
 *     deny_on_critical_flag: true,
 *     deny_on_corrupted: true,
 *   },
 * });
 * ```
 */
export const vaultsfyi: PolicyPack<Params, WasmArgs, Secrets> = {
	id: `${PACK_NAME}/risk-envelope/v1`,
	paramsSchema: ParamsSchema,
	wasmArgsSchema: WasmArgsSchema,
	secretsSchema: SecretsSchema,
	encodeParams,
	decodeParams,
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
