import type { PrepareQueryArgs, PrepareQueryResult } from "@newton-xyz/policy-pack-shared";
import type { WasmArgs } from "./wasm-args";

/**
 * Per-call inputs for Guardrail. The wasm args schema requires *at least one
 * of* `protocolId` or `vaultAddress`. `vaultAddress` is naturally available
 * from `PrepareQueryArgs.vault` (the vault the curator is acting on); a
 * curator that prefers Guardrail's protocol-level alerts can pass
 * `protocolId` via the options bag instead.
 */
export interface PrepareQueryOptions {
	readonly protocolId?: string;
}

export async function prepareQuery(
	{ publicClient, vault }: PrepareQueryArgs,
	options?: PrepareQueryOptions,
): Promise<PrepareQueryResult<WasmArgs>> {
	const chainId = publicClient.chain?.id;
	return {
		wasmArgs: {
			vaultAddress: vault,
			...(options?.protocolId ? { protocolId: options.protocolId } : {}),
			...(chainId !== undefined ? { chainId } : {}),
		},
	};
}
