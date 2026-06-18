import { type Address, getAddress, type Hex, type PublicClient } from "viem";
import { type CompositeManifest, decodeManifest } from "./composite-manifest";

/**
 * Helper for depositors to verify a composite policy on-chain. Walks the
 * full read path:
 *
 *   1. policyAddress = INewtonPolicyClient(shield).getPolicyAddress()
 *   2. policyId      = INewtonPolicy(policyAddress).getPolicyId(shield)
 *   3. policyParams  = INewtonPolicy(policyAddress).getPolicyConfig(policyId).policyParams
 *   4. decodeManifest(policyParams)
 *   5. INewtonPolicy(policyAddress).getPolicyData()
 *   6. INewtonPolicyData(policyDataAddress).getWasmCid() per module
 *
 * Then validates positional equality of `modules[*].policyDataAddress` against
 * step 5, and byte-equality of `wasmCid` against step 6 per module. Returns
 * the full report; does NOT throw on mismatch — depositor UIs decide how to
 * surface failures.
 *
 * RPC batching: when `client.chain.contracts.multicall3` is configured, steps
 * 5 and 6 run in a single multicall. When absent, the helper falls back to
 * N+1 sequential `readContract` calls (1 for `getPolicyData()`, N for each
 * `getWasmCid()`). Both supported testnets (Sepolia chain 11155111, Base
 * Sepolia chain 84532) have multicall3 deployed.
 *
 * Per `docs/composite-manifest-spec.md` § "introspectComposite".
 */

const POLICY_CLIENT_ABI = [
	{
		type: "function",
		name: "getPolicyAddress",
		inputs: [],
		outputs: [{ name: "", type: "address" }],
		stateMutability: "view",
	},
] as const;

const NEWTON_POLICY_ABI = [
	{
		type: "function",
		name: "getPolicyId",
		inputs: [{ name: "client", type: "address" }],
		outputs: [{ name: "", type: "bytes32" }],
		stateMutability: "view",
	},
	{
		type: "function",
		name: "getPolicyConfig",
		inputs: [{ name: "policyId", type: "bytes32" }],
		outputs: [
			{
				type: "tuple",
				components: [
					{ name: "policyParams", type: "bytes" },
					{ name: "expireAfter", type: "uint32" },
				],
			},
		],
		stateMutability: "view",
	},
	{
		type: "function",
		name: "getPolicyData",
		inputs: [],
		outputs: [{ name: "", type: "address[]" }],
		stateMutability: "view",
	},
] as const;

const NEWTON_POLICY_DATA_ABI = [
	{
		type: "function",
		name: "getWasmCid",
		inputs: [],
		outputs: [{ name: "", type: "string" }],
		stateMutability: "view",
	},
] as const;

export interface IntrospectCompositeArgs {
	readonly publicClient: PublicClient;
	readonly shieldAddress: Address;
}

export interface IntrospectedComposite {
	readonly policyAddress: Address;
	readonly policyId: Hex;
	readonly manifest: CompositeManifest;
	readonly verification: {
		readonly onChainPolicyDataMatches: boolean;
		readonly wasmCidsMatch: ReadonlyArray<{
			readonly moduleIndex: number;
			readonly matches: boolean;
			readonly reason?: string;
		}>;
	};
}

export async function introspectComposite({
	publicClient,
	shieldAddress,
}: IntrospectCompositeArgs): Promise<IntrospectedComposite> {
	// Step 1: resolve the bound policy contract.
	const policyAddress = (await publicClient.readContract({
		address: shieldAddress,
		abi: POLICY_CLIENT_ABI,
		functionName: "getPolicyAddress",
	})) as Address;

	// Step 2 + 3: get policyId, then getPolicyConfig — sequential because step 3
	// needs step 2's output.
	const policyId = (await publicClient.readContract({
		address: policyAddress,
		abi: NEWTON_POLICY_ABI,
		functionName: "getPolicyId",
		args: [shieldAddress],
	})) as Hex;
	const policyConfig = (await publicClient.readContract({
		address: policyAddress,
		abi: NEWTON_POLICY_ABI,
		functionName: "getPolicyConfig",
		args: [policyId],
	})) as { policyParams: Hex; expireAfter: number };

	// Step 4: decode the manifest. Throws on malformed input — depositor UIs
	// surface this as "this Shield isn't a composite (probably single-pack)".
	const manifest = decodeManifest(policyConfig.policyParams);

	// Steps 5 + 6: read on-chain getPolicyData() + per-module getWasmCid().
	// Use multicall when available; fall back to N+1 sequential calls.
	const moduleAddresses = manifest.modules.map((m) => m.policyDataAddress);
	const useMulticall = !!publicClient.chain?.contracts?.multicall3?.address;

	let onChainPolicyData: ReadonlyArray<Address>;
	let wasmCids: ReadonlyArray<string>;
	if (useMulticall) {
		const calls = [
			{
				address: policyAddress,
				abi: NEWTON_POLICY_ABI,
				functionName: "getPolicyData" as const,
			},
			...moduleAddresses.map((addr) => ({
				address: addr,
				abi: NEWTON_POLICY_DATA_ABI,
				functionName: "getWasmCid" as const,
			})),
		];
		const results = await publicClient.multicall({
			contracts: calls,
			allowFailure: false,
		});
		onChainPolicyData = (results[0] as Address[]).map((a) => getAddress(a));
		wasmCids = results.slice(1) as string[];
	} else {
		const policyData = (await publicClient.readContract({
			address: policyAddress,
			abi: NEWTON_POLICY_ABI,
			functionName: "getPolicyData",
		})) as Address[];
		onChainPolicyData = policyData.map((a) => getAddress(a));
		wasmCids = await Promise.all(
			moduleAddresses.map(
				(addr) =>
					publicClient.readContract({
						address: addr,
						abi: NEWTON_POLICY_DATA_ABI,
						functionName: "getWasmCid",
					}) as Promise<string>,
			),
		);
	}

	// Verification: positional equality on policy-data addresses + byte equality
	// on wasm CIDs. getAddress(...) normalizes both sides so EIP-55 vs lowercase
	// doesn't cause false negatives.
	const expectedAddresses = manifest.modules.map((m) => getAddress(m.policyDataAddress));
	const onChainPolicyDataMatches =
		onChainPolicyData.length === expectedAddresses.length &&
		onChainPolicyData.every((addr, i) => addr === expectedAddresses[i]);

	const wasmCidsMatch = manifest.modules.map((m, i) => {
		const onChainCid = wasmCids[i];
		if (onChainCid === undefined) {
			return { moduleIndex: i, matches: false, reason: "no on-chain CID returned" };
		}
		if (onChainCid !== m.wasmCid) {
			return {
				moduleIndex: i,
				matches: false,
				reason: `manifest wasmCid="${m.wasmCid}" but on-chain="${onChainCid}"`,
			};
		}
		return { moduleIndex: i, matches: true };
	});

	return {
		policyAddress: getAddress(policyAddress),
		policyId,
		manifest,
		verification: { onChainPolicyDataMatches, wasmCidsMatch },
	};
}
