import type { PrepareQueryArgs, PrepareQueryResult } from "@newton-xyz/policy-core";
import type { WasmArgs } from "./wasm-args";

/**
 * Per-call inputs for Persona: the `walletAddress` to look up is the
 * depositor's wallet, which lives in the SDK's intent context
 * (`IntentArgs.from`) — not in `PrepareQueryArgs`. Forwarded via
 * `prepareQuery`'s second `options` arg (introduced in NEWT-1499).
 */
export interface PrepareQueryOptions {
	readonly walletAddress: string;
}

export async function prepareQuery(
	_args: PrepareQueryArgs,
	options?: PrepareQueryOptions,
): Promise<PrepareQueryResult<WasmArgs>> {
	if (!options?.walletAddress) {
		throw new Error(
			"policy-pack-persona: prepareQuery requires `walletAddress` in the options bag — the depositor wallet to look up in Persona.",
		);
	}
	return { wasmArgs: { walletAddress: options.walletAddress } };
}
