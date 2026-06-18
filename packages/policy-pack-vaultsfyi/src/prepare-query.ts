import type { PrepareQueryArgs, PrepareQueryResult } from "@newton-xyz/policy-pack-shared";
import type { WasmArgs } from "./wasm-args";

/**
 * vaults.fyi network slugs. Keyed by viem chain id. The AVS-side `policy.js`
 * fetches `https://api.vaults.fyi/v2/historical/<network>/<vaultAddress>`
 * with this slug, so the SDK has to use the same map.
 */
const NETWORK_BY_CHAIN_ID: Readonly<Record<number, string>> = {
	1: "mainnet",
	8453: "base",
	42161: "arbitrum",
	10: "optimism",
	11155111: "sepolia",
	84532: "base-sepolia",
};

function networkForChain(chainId: number): string {
	const name = NETWORK_BY_CHAIN_ID[chainId];
	if (!name) {
		throw new Error(
			`policy-pack-vaultsfyi: chain id ${chainId} is not in the vaults.fyi network map. Add it to NETWORK_BY_CHAIN_ID before using this pack on this chain.`,
		);
	}
	return name;
}

/**
 * Build the WASM args the vaults.fyi policy expects.
 *
 * The AVS-side `policy.js` computes the canonical allocation hash itself
 * (FNV-1a over `JSON.stringify({ protocol?.name, tags, fees, childrenVaults })`
 * fetched from the vaults.fyi API). The SDK has nothing to add — the AVS is
 * the source of truth for both the data and the hash. The SDK's only job is
 * to thread the *previous* hash through so the AVS can compare:
 *
 *   - First call: pass `previousAllocationHash: undefined` (defaults to
 *     `null` in wasmArgs). The AVS-side `allocation_changed_since_last`
 *     branch returns `false`, so `deny_on_allocation_change` doesn't fire
 *     on a clean first observation.
 *   - Subsequent calls: pass the hash the AVS returned on the prior call
 *     (typically read from `policyData` storage or a curator-side cache).
 *     The AVS compares against its freshly-computed hash and flips
 *     `allocation_changed_since_last` if they diverge.
 *
 * Earlier revisions of this function read MetaMorpho's `supplyQueue` and
 * computed `keccak256(abi.encode(bytes32[]))` — that hash never matched the
 * AVS's FNV-1a-over-API-metadata, so `deny_on_allocation_change: true` was
 * effectively a coin flip. Removed.
 */
export async function prepareQuery(
	{ publicClient, subject, dataSourceChainId, dataSourceSubject }: PrepareQueryArgs,
	options: { previousAllocationHash?: string } = {},
): Promise<PrepareQueryResult<WasmArgs>> {
	// vaults.fyi indexes production networks only, so a curator testing on a
	// testnet has no data and the policy fails closed. `dataSourceChainId` /
	// `dataSourceSubject` let them point the lookup at a real mainnet vault
	// while the Shield executes on the testnet — a testing/demo affordance
	// (see PrepareQueryArgs). In production, leave both unset so the oracle
	// describes the same vault the Shield gates.
	const lookupChainId = dataSourceChainId ?? publicClient.chain?.id;
	if (lookupChainId === undefined) {
		throw new Error(
			"policy-pack-vaultsfyi: no chain to resolve a vaults.fyi network from. Pass a chain to viem's createPublicClient, or set dataSourceChainId.",
		);
	}

	return {
		wasmArgs: {
			network: networkForChain(lookupChainId),
			vaultAddress: dataSourceSubject ?? subject,
			lastKnownAllocationHash: options.previousAllocationHash ?? null,
		},
	};
}
