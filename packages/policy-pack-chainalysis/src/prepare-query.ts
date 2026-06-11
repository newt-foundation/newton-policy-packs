import type { PrepareQueryArgs, PrepareQueryResult } from "@newton-xyz/policy-pack-shared";
import type { WasmArgs } from "./wasm-args";

/**
 * Per-call inputs for Chainalysis: the screened `address` is the depositor's
 * wallet, which lives in the SDK's intent context (`IntentArgs.from`) — not
 * in `PrepareQueryArgs`. The SDK forwards it via `prepareQuery`'s second
 * `options` arg (introduced in NEWT-1499).
 */
export interface PrepareQueryOptions {
	readonly address: string;
}

export async function prepareQuery(
	_args: PrepareQueryArgs,
	options?: PrepareQueryOptions,
): Promise<PrepareQueryResult<WasmArgs>> {
	if (!options?.address) {
		throw new Error(
			"policy-pack-chainalysis: prepareQuery requires `address` in the options bag — the depositor wallet to screen.",
		);
	}
	return { wasmArgs: { address: options.address } };
}
