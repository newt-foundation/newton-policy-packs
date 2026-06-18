import type { PrepareQueryArgs, PrepareQueryResult } from "@newton-xyz/policy-pack-shared";
import type { WasmArgs } from "./wasm-args";

/**
 * Per-call inputs for Guardrail. The wasm args schema requires *at least one
 * of* `protocolId` or `vaultAddress`. `vaultAddress` is naturally available
 * from `PrepareQueryArgs.subject` (the vault the curator is acting on); a
 * curator that prefers Guardrail's protocol-level alerts can pass
 * `protocolId` via the options bag instead.
 *
 * Honors the `dataSourceChainId` / `dataSourceSubject` overrides (see
 * `PrepareQueryArgs`) so a testnet curator can resolve Guardrail's data
 * against a real mainnet vault — a testing affordance, not for production.
 */
export interface PrepareQueryOptions {
	readonly protocolId?: string;
}

export async function prepareQuery(
	{ publicClient, subject, dataSourceChainId, dataSourceSubject }: PrepareQueryArgs,
	options?: PrepareQueryOptions,
): Promise<PrepareQueryResult<WasmArgs>> {
	const chainId = dataSourceChainId ?? publicClient.chain?.id;
	return {
		wasmArgs: {
			vaultAddress: dataSourceSubject ?? subject,
			...(options?.protocolId ? { protocolId: options.protocolId } : {}),
			...(chainId !== undefined ? { chainId } : {}),
		},
	};
}
