import type { PrepareQueryArgs, PrepareQueryResult } from "@newton-xyz/policy-pack-shared";
import type { WasmArgs } from "./wasm-args";

/**
 * Per-call inputs for Guardrail. The wasm args schema requires *at least one
 * of* `protocolId` or `vaultAddress`. `vaultAddress` is naturally available
 * from `PrepareQueryArgs.subject` (the vault the curator is acting on); a
 * curator that prefers Guardrail's protocol-level alerts can pass
 * `protocolId` via the options bag instead.
 *
 * `chainId` / `vaultAddress` are **data-source overrides (testing only).**
 * Guardrail's alert/health source indexes production protocols and vaults, so a
 * curator testing on a network it doesn't cover gets no data and the policy
 * fails closed. Set these to resolve Guardrail's lookup against a real
 * production target (`chainId` is the numeric chain id, `vaultAddress` the
 * indexed vault) while the Shield executes on a testnet. This decouples the
 * data from the vault the Shield gates, so it is a testing/demo affordance —
 * leave both unset in production.
 */
export interface PrepareQueryOptions {
	readonly protocolId?: string;
	readonly chainId?: number;
	readonly vaultAddress?: string;
}

export async function prepareQuery(
	{ publicClient, subject }: PrepareQueryArgs,
	options?: PrepareQueryOptions,
): Promise<PrepareQueryResult<WasmArgs>> {
	const chainId = options?.chainId ?? publicClient.chain?.id;
	return {
		wasmArgs: {
			vaultAddress: options?.vaultAddress ?? subject,
			...(options?.protocolId ? { protocolId: options.protocolId } : {}),
			...(chainId !== undefined ? { chainId } : {}),
		},
	};
}
