import type { PrepareQueryArgs, PrepareQueryResult } from "@newton-xyz/policy-pack-shared";
import type { WasmArgs } from "./wasm-args";

/**
 * Per-call inputs the SDK has to thread through. `rpcUrl` / `onchainOracle`
 * are curator-configured (the on-chain oracle the WASM compares the RedStone
 * feed against); `symbol` names the asset; `provider` is the optional
 * RedStone provider override. None of these can be derived from
 * `PrepareQueryArgs` alone.
 *
 * `prevSnapshot` is the previous evaluation's
 * `{ divergenceBp, timestampMs }` and drives sustained-divergence tracking.
 * Pass `undefined` (or omit) on the first call; pass the prior result on
 * subsequent calls. Mirrors the pattern VaultsFYI uses with
 * `previousAllocationHash` for freshness binding.
 */
export interface PrepareQueryOptions {
	readonly symbol: string;
	readonly rpcUrl: string;
	readonly onchainOracle: {
		readonly address: string;
		readonly selector: string;
		readonly decimals?: number;
	};
	readonly provider?: string;
	readonly prevSnapshot?: {
		readonly divergenceBp: number;
		readonly timestampMs: number;
	};
}

export async function prepareQuery(
	_args: PrepareQueryArgs,
	options?: PrepareQueryOptions,
): Promise<PrepareQueryResult<WasmArgs>> {
	if (!options?.symbol || !options?.rpcUrl || !options?.onchainOracle) {
		throw new Error(
			"policy-pack-redstone: prepareQuery requires `symbol`, `rpcUrl`, and `onchainOracle` in the options bag — none of these can be derived from publicClient + vault.",
		);
	}

	return {
		wasmArgs: {
			symbol: options.symbol,
			rpcUrl: options.rpcUrl,
			onchainOracle: options.onchainOracle,
			...(options.provider !== undefined ? { provider: options.provider } : {}),
			prevSnapshot: options.prevSnapshot ?? null,
		},
	};
}
