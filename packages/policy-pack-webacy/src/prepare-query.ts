import type { PrepareQueryArgs, PrepareQueryResult } from "@newton-xyz/policy-pack-shared";
import type { WasmArgs } from "./wasm-args";

/**
 * Webacy maps EVM chain id → its own chain identifier slug. Keep this aligned
 * with whatever the AVS-side `policy.js` posts to Webacy; if you extend it,
 * extend both sides together.
 */
const CHAIN_BY_ID: Readonly<Record<number, string>> = {
	1: "eth",
	8453: "base",
	42161: "arb",
	10: "opt",
	137: "polygon",
	56: "bsc",
};

/**
 * Per-call inputs for Webacy. The pegged-token contract `address` lives in
 * the SDK's intent context (typically `IntentArgs.to` or a curator-specified
 * token), not in `PrepareQueryArgs`, so it's required in the options bag.
 *
 * `chain` is optional — when omitted, derived from `publicClient.chain.id`
 * via `CHAIN_BY_ID`. Pass an explicit string to override (e.g. when the
 * Webacy slug doesn't match the chain the SDK is connected to).
 *
 * `lookback_days` is the depeg-events window (1-30); defaults to Webacy's
 * 7-day window when omitted.
 */
export interface PrepareQueryOptions {
	readonly address: string;
	readonly chain?: string;
	readonly lookback_days?: number;
}

export async function prepareQuery(
	{ publicClient }: PrepareQueryArgs,
	options?: PrepareQueryOptions,
): Promise<PrepareQueryResult<WasmArgs>> {
	if (!options?.address) {
		throw new Error(
			"policy-pack-webacy: prepareQuery requires `address` in the options bag — the pegged-token contract address to score.",
		);
	}

	let chain = options.chain;
	if (!chain) {
		const chainId = publicClient.chain?.id;
		if (chainId !== undefined) chain = CHAIN_BY_ID[chainId];
	}

	return {
		wasmArgs: {
			address: options.address,
			...(chain ? { chain } : {}),
			...(options.lookback_days !== undefined ? { lookback_days: options.lookback_days } : {}),
		},
	};
}
