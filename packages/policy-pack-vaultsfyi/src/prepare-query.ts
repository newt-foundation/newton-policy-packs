import type { PrepareQueryArgs, PrepareQueryResult } from "@newton-xyz/policy-pack-shared";
import { type Address, encodeAbiParameters, type Hex, keccak256 } from "viem";
import type { WasmArgs } from "./wasm-args";

/**
 * MetaMorpho's `supplyQueue` returns the ordered list of underlying market
 * IDs the vault is currently allocating into. We hash the encoded queue and
 * pass that hash as `lastKnownAllocationHash` so the AVS-side policy can
 * reject the attestation if the queue shifts between intent build and
 * on-chain submission.
 *
 * The ABI is intentionally inlined: this pack supports MetaMorpho today, and
 * any drift in the upstream Morpho ABI is a deliberate event that should
 * force a pack-side update — not something the SDK should follow silently.
 */
const METAMORPHO_SUPPLY_QUEUE_ABI = [
	{
		type: "function",
		name: "supplyQueue",
		stateMutability: "view",
		inputs: [{ name: "index", type: "uint256" }],
		outputs: [{ name: "", type: "bytes32" }],
	},
	{
		type: "function",
		name: "supplyQueueLength",
		stateMutability: "view",
		inputs: [],
		outputs: [{ name: "", type: "uint256" }],
	},
] as const;

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
 * Read the MetaMorpho supply queue from chain and produce the WASM args the
 * vaults.fyi policy expects.
 *
 * The freshness hash is also returned at the result-level so callers can
 * surface the snapshot in logs and dashboards.
 */
export async function prepareQuery({
	publicClient,
	vault,
}: PrepareQueryArgs): Promise<PrepareQueryResult<WasmArgs>> {
	const chainId = publicClient.chain?.id;
	if (chainId === undefined) {
		throw new Error(
			"policy-pack-vaultsfyi: publicClient.chain is undefined. Pass a chain to viem's createPublicClient.",
		);
	}

	const length = await publicClient.readContract({
		address: vault as Address,
		abi: METAMORPHO_SUPPLY_QUEUE_ABI,
		functionName: "supplyQueueLength",
	});

	const queue: Hex[] = [];
	for (let i = 0n; i < length; i++) {
		const marketId = await publicClient.readContract({
			address: vault as Address,
			abi: METAMORPHO_SUPPLY_QUEUE_ABI,
			functionName: "supplyQueue",
			args: [i],
		});
		queue.push(marketId);
	}

	const encoded = encodeAbiParameters([{ type: "bytes32[]" }], [queue]);
	const allocationHash = keccak256(encoded);

	return {
		wasmArgs: {
			network: networkForChain(chainId),
			vaultAddress: vault,
			lastKnownAllocationHash: allocationHash,
		},
		freshnessHash: allocationHash,
	};
}
