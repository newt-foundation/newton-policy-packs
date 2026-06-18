import type { PrepareQueryArgs, PrepareQueryResult } from "@newton-xyz/policy-pack-shared";
import type { WasmArgs } from "./wasm-args";

/**
 * Blockaid maps EVM chain id → its own chain identifier slug. Keep this
 * aligned with whatever the AVS-side `policy.js` posts to Blockaid; if you
 * extend it, extend both sides together.
 */
const CHAIN_BY_ID: Readonly<Record<number, string>> = {
	1: "ethereum",
	8453: "base",
	42161: "arbitrum",
	10: "optimism",
	137: "polygon",
	56: "bsc",
	11155111: "sepolia",
	84532: "base-sepolia",
};

/**
 * Per-call inputs for Blockaid: every wasmArg (`from`, `to`, `value`, `data`)
 * mirrors the on-chain transaction the depositor is about to submit, so it
 * has to come from the SDK's intent context — `PrepareQueryArgs` (which only
 * carries `publicClient` + `target`) doesn't have any of it. The SDK forwards
 * these via `prepareQuery`'s second `options` arg (introduced in NEWT-1499).
 *
 * `chain` is derived from `publicClient.chain.id` so curators don't have to
 * keep the Blockaid slug list in sync separately.
 */
export interface PrepareQueryOptions {
	readonly from: string;
	readonly to: string;
	readonly value?: string;
	readonly data?: string;
}

export async function prepareQuery(
	{ publicClient }: PrepareQueryArgs,
	options?: PrepareQueryOptions,
): Promise<PrepareQueryResult<WasmArgs>> {
	const chainId = publicClient.chain?.id;
	if (chainId === undefined) {
		throw new Error(
			"policy-pack-blockaid: publicClient.chain is undefined. Pass a chain to viem's createPublicClient.",
		);
	}
	const chain = CHAIN_BY_ID[chainId];
	if (!chain) {
		throw new Error(
			`policy-pack-blockaid: chain id ${chainId} is not in the Blockaid chain map. Add it to CHAIN_BY_ID before using this pack on this chain.`,
		);
	}
	if (!options?.from || !options?.to) {
		throw new Error(
			"policy-pack-blockaid: prepareQuery requires `from` and `to` in the options bag — these mirror the on-chain transaction the depositor is about to submit.",
		);
	}

	return {
		wasmArgs: {
			chain,
			from: options.from,
			to: options.to,
			value: options.value,
			data: options.data,
		},
	};
}
