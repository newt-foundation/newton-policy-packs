import { type Address, getAddress, type Hex, type PublicClient } from "viem";
import {
	encodeCompositeParams,
	type HistoricalBinding,
	shortPackIdFromModuleId,
} from "./composite-manifest";
import type { ChainId, GatewayEnv } from "./deployment";
import { isKnownPackId, type KnownPackId } from "./known-pack-ids";
import {
	getDeployment,
	type PolicyPack,
	type PrepareQueryArgs,
	type PrepareQueryResult,
	UnsupportedChainError,
	UnsupportedEnvError,
} from "./pack";

/**
 * Composite-policy builder + runtime layer. Phase 2 of the composite-policy
 * rollout (NEWT-1542). Full design spec: `docs/define-composite-spec.md`.
 *
 * Pulls together Phase 0 (`wrapOutput`), Phase 1 (`OracleModule` exports),
 * and Phase 1.5 (`encodeCompositeParams`/`decodeManifest`/`introspectComposite`)
 * into one curator-facing API.
 *
 * Curator workflow:
 *
 *   const composite = await defineComposite({
 *     modules: [vaultsfyi, chainalysis, redstone],
 *     chainId: "11155111",
 *     env: "stagef",
 *     publicClient,
 *     policyAddress: "0xACME...",
 *   });
 *   const policyParamsBytes = encodeCompositePolicyPack(composite, {
 *     vaultsfyi: { risk_score_floor: 80, ... },
 *     chainalysis: { deny_on_sanctioned: true },
 *     redstone: { ... },
 *   });
 *   await shield.setPolicy(policyParamsBytes, expireAfter);
 *
 *   // Per-call: composite's aggregated prepareQuery
 *   const { wasmArgs } = await composite.prepareQuery!(
 *     { publicClient, vault },
 *     {
 *       chainalysis: { address: depositorAddress },
 *       redstone: { symbol: "ETH", rpcUrl, onchainOracle },
 *     },
 *   );
 */

const POLICY_ABI = [
	{
		type: "function",
		name: "getPolicyData",
		inputs: [],
		outputs: [{ name: "", type: "address[]" }],
		stateMutability: "view",
	},
] as const;

const POLICY_DATA_ABI = [
	{
		type: "function",
		name: "getWasmCid",
		inputs: [],
		outputs: [{ name: "", type: "string" }],
		stateMutability: "view",
	},
] as const;

const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";

export interface DefineCompositeArgs {
	readonly modules: ReadonlyArray<PolicyPack<unknown, unknown, unknown>>;
	readonly chainId: ChainId;
	readonly env: GatewayEnv;
	readonly publicClient: PublicClient;
	readonly policyAddress: Address;
	readonly expectedPolicyDataAddresses?: ReadonlyArray<Address>;
	readonly expectedWasmCids?: ReadonlyArray<string>;
}

export interface CompositePolicyPack {
	readonly kind: "composite";
	readonly modules: ReadonlyArray<PolicyPack<unknown, unknown, unknown>>;
	readonly chainId: ChainId;
	readonly env: GatewayEnv;
	readonly policyAddress: Address;
	readonly onChainPolicyData: ReadonlyArray<Address>;
	/**
	 * The historical bindings used to construct the composite, if the curator
	 * passed `expectedPolicyDataAddresses` + `expectedWasmCids` to bind to a
	 * pre-redeploy snapshot. `undefined` for fresh composites built against
	 * current `module.deployments`. Consumed by `encodeCompositePolicyPack`.
	 */
	readonly historicalBindings?: ReadonlyArray<HistoricalBinding>;
	prepareQuery(
		args: PrepareQueryArgs,
		options?: Record<string, unknown>,
	): Promise<PrepareQueryResult<Record<string, unknown>>>;
}

/**
 * Async builder for a composite policy. Reads on-chain state to enforce the
 * positional-ordering invariant from the spec: `modules[i].deployments[chainId][env].policyData`
 * must equal `INewtonPolicy(policyAddress).getPolicyData()[i]`.
 *
 * For fresh composites: pass only `{ modules, chainId, env, publicClient, policyAddress }`.
 * For historical composites (deployed before a pack redeploy): also pass
 * `expectedPolicyDataAddresses` + `expectedWasmCids` to pin to the
 * on-chain snapshot.
 *
 * Throws typed errors at construction time — see `docs/define-composite-spec.md`
 * § "Invariant checks at construction time".
 */
export async function defineComposite(args: DefineCompositeArgs): Promise<CompositePolicyPack> {
	if (args.modules.length === 0) {
		throw new CompositeBuilderError("modules must be non-empty");
	}
	if (getAddress(args.policyAddress) === ZERO_ADDRESS) {
		throw new CompositeBuilderError("policyAddress is the zero address");
	}
	const onChainChainId = args.publicClient.chain?.id;
	if (onChainChainId !== undefined && String(onChainChainId) !== args.chainId) {
		throw new ChainMismatchError(args.chainId, String(onChainChainId));
	}

	// Short-id collision + KNOWN_PACK_IDS membership.
	const shortIds: string[] = [];
	for (const module of args.modules) {
		const shortId = shortPackIdFromModuleId(module.id);
		if (shortIds.includes(shortId)) {
			throw new CompositeBuilderError(
				`duplicate short pack id \`${shortId}\` derived from module id \`${module.id}\``,
			);
		}
		if (!isKnownPackId(shortId)) {
			throw new UnknownPackIdError(shortId, module.id);
		}
		shortIds.push(shortId);
	}

	// Historical-pin shape validation.
	if ((args.expectedPolicyDataAddresses === undefined) !== (args.expectedWasmCids === undefined)) {
		throw new CompositeBuilderError(
			"expectedPolicyDataAddresses and expectedWasmCids must be provided together — pinning one without the other defeats the wasmCid identity check",
		);
	}
	if (args.expectedPolicyDataAddresses && args.expectedWasmCids) {
		if (args.expectedPolicyDataAddresses.length !== args.modules.length) {
			throw new CompositeBuilderError(
				`expectedPolicyDataAddresses.length (${args.expectedPolicyDataAddresses.length}) must equal modules.length (${args.modules.length})`,
			);
		}
		if (args.expectedWasmCids.length !== args.modules.length) {
			throw new CompositeBuilderError(
				`expectedWasmCids.length (${args.expectedWasmCids.length}) must equal modules.length (${args.modules.length})`,
			);
		}
	}

	// Resolve expected addresses (historical pin OR module.deployments lookup).
	const usingHistoricalPin = !!args.expectedPolicyDataAddresses;
	const expectedAddrs: Address[] = [];
	for (let i = 0; i < args.modules.length; i++) {
		// biome-ignore lint/style/noNonNullAssertion: bounds checked
		const module = args.modules[i]!;
		if (usingHistoricalPin) {
			// biome-ignore lint/style/noNonNullAssertion: length verified above
			expectedAddrs.push(getAddress(args.expectedPolicyDataAddresses![i]!));
			continue;
		}
		// Spec § "Invariant checks at construction time" #8: re-throw the
		// existing UnsupportedChainError / UnsupportedEnvError from getDeployment
		// so consumers can catch the canonical error classes (the same ones
		// curator-side single-pack flows already handle via getDeployment).
		// Wrap the module shape that getDeployment expects (it needs `id` +
		// `deployments` per the structural type at pack.ts:106).
		const deployment = getDeployment(
			{ id: module.id, deployments: module.deployments },
			args.chainId,
			args.env,
		);
		expectedAddrs.push(getAddress(deployment.policyData));
	}

	// On-chain getPolicyData() — required to verify ordering against expectedAddrs.
	const onChainPolicyDataRaw = (await args.publicClient.readContract({
		address: args.policyAddress,
		abi: POLICY_ABI,
		functionName: "getPolicyData",
	})) as Address[];
	const onChainPolicyData = onChainPolicyDataRaw.map((a) => getAddress(a));

	if (onChainPolicyData.length !== args.modules.length) {
		throw new PolicyDataLengthMismatchError(onChainPolicyData.length, args.modules.length);
	}

	for (let i = 0; i < onChainPolicyData.length; i++) {
		// biome-ignore lint/style/noNonNullAssertion: length checked
		if (onChainPolicyData[i]! !== expectedAddrs[i]!) {
			const recoveryHint = usingHistoricalPin
				? ""
				: " (if this composite was deployed before a recent pack redeploy, pass `expectedPolicyDataAddresses` + `expectedWasmCids` with the historical addresses to pin to the on-chain composite)";
			throw new PolicyDataOrderingMismatchError(
				i,
				expectedAddrs[i]!,
				onChainPolicyData[i]!,
				recoveryHint,
			);
		}
	}

	// Historical-pin path: verify each pinned PolicyData's on-chain getWasmCid()
	// against expectedWasmCids[i]. Binds each pinned address to a module
	// identity — without this, a curator could pair module A's id+schemas with
	// module B's PolicyData by passing B's address in A's slot.
	if (usingHistoricalPin) {
		// biome-ignore lint/style/noNonNullAssertion: usingHistoricalPin guards
		const expectedCids = args.expectedWasmCids!;
		const useMulticall = !!args.publicClient.chain?.contracts?.multicall3?.address;
		let actualCids: string[];
		if (useMulticall) {
			actualCids = (await args.publicClient.multicall({
				contracts: expectedAddrs.map((addr) => ({
					address: addr,
					abi: POLICY_DATA_ABI,
					functionName: "getWasmCid" as const,
				})),
				allowFailure: false,
			})) as string[];
		} else {
			actualCids = await Promise.all(
				expectedAddrs.map(
					(addr) =>
						args.publicClient.readContract({
							address: addr,
							abi: POLICY_DATA_ABI,
							functionName: "getWasmCid",
						}) as Promise<string>,
				),
			);
		}
		for (let i = 0; i < expectedCids.length; i++) {
			// biome-ignore lint/style/noNonNullAssertion: length checked
			if (actualCids[i]! !== expectedCids[i]!) {
				throw new PinnedWasmCidMismatchError(
					i,
					args.modules[i]!.id,
					expectedCids[i]!,
					actualCids[i]!,
				);
			}
		}
	}

	// All invariants verified — build the runtime CompositePolicyPack.
	const historicalBindings = usingHistoricalPin
		? args.expectedPolicyDataAddresses!.map((addr, i) => ({
				policyDataAddress: getAddress(addr),
				// biome-ignore lint/style/noNonNullAssertion: usingHistoricalPin guards
				wasmCid: args.expectedWasmCids![i]!,
			}))
		: undefined;

	return {
		kind: "composite",
		modules: args.modules,
		chainId: args.chainId,
		env: args.env,
		policyAddress: getAddress(args.policyAddress),
		onChainPolicyData,
		historicalBindings,
		prepareQuery: makeAggregatedPrepareQuery(args.modules),
	};
}

/**
 * Build the aggregated `prepareQuery` for a composite. Calls every module's
 * `prepareQuery` in parallel; merges results keyed by short pack id.
 *
 * Per-module options keyed by short pack id pass through to each module's
 * `prepareQuery(args, options[shortId])`. Modules without a per-call options
 * shape ignore the second arg.
 *
 * Fail-fast: if any module's `prepareQuery` rejects, the aggregated promise
 * rejects with `CompositePrepareQueryError` wrapping the failing module's
 * error. Other modules' results are discarded (Promise.all semantics).
 */
function makeAggregatedPrepareQuery(
	modules: ReadonlyArray<PolicyPack<unknown, unknown, unknown>>,
): (
	args: PrepareQueryArgs,
	options?: Record<string, unknown>,
) => Promise<PrepareQueryResult<Record<string, unknown>>> {
	return async (args, options = {}) => {
		const results = await Promise.all(
			modules.map(async (module) => {
				const shortId = shortPackIdFromModuleId(module.id);
				if (!module.prepareQuery) {
					return [shortId, {}] as const;
				}
				try {
					const result = await module.prepareQuery(args, options[shortId]);
					return [shortId, result.wasmArgs] as const;
				} catch (cause) {
					throw new CompositePrepareQueryError(module.id, shortId, cause);
				}
			}),
		);
		return { wasmArgs: Object.fromEntries(results) };
	};
}

/**
 * Encode the composite manifest bytes for `Shield.setPolicy(...)`. Wraps
 * `encodeCompositeParams` with the historical bindings carried on the
 * `CompositePolicyPack` (when present). Curators using a fresh composite
 * can call `encodeCompositeParams(pack, params)` directly; this convenience
 * exists because historical composites need the bindings threaded through
 * and forgetting them silently emits the wrong addresses.
 */
export function encodeCompositePolicyPack(
	pack: CompositePolicyPack,
	params: Record<string, unknown>,
): Hex {
	return encodeCompositeParams(
		{ modules: pack.modules, chainId: pack.chainId, env: pack.env },
		params,
		pack.historicalBindings,
	);
}

/**
 * Generic builder error — shape-of-args problems caught before any RPC. See
 * the spec's "Invariant checks at construction time" for the full list.
 */
export class CompositeBuilderError extends Error {
	override readonly name = "CompositeBuilderError";
	constructor(message: string) {
		super(message);
	}
}

/**
 * `args.publicClient.chain.id` is set and disagrees with `args.chainId`.
 * Skipped when `chain` is undefined (curator owns RPC chain context).
 */
export class ChainMismatchError extends Error {
	override readonly name = "ChainMismatchError";
	constructor(
		readonly expectedChainId: ChainId,
		readonly actualChainId: ChainId,
	) {
		super(
			`args.chainId="${expectedChainId}" but publicClient.chain.id="${actualChainId}" — composite would read on-chain state from a different chain than its modules' deployments live on`,
		);
	}
}

/**
 * Module's short pack id (derived via `shortPackIdFromModuleId`) is not in
 * `KNOWN_PACK_IDS`. Catches typos and packs that haven't been published.
 */
export class UnknownPackIdError extends Error {
	override readonly name = "UnknownPackIdError";
	constructor(
		readonly shortId: string,
		readonly moduleId: string,
	) {
		super(
			`module \`${moduleId}\` derives short pack id \`${shortId}\` which is not in KNOWN_PACK_IDS — typo or unpublished pack?`,
		);
	}

	get knownPackId(): KnownPackId | undefined {
		return isKnownPackId(this.shortId) ? this.shortId : undefined;
	}
}

/**
 * `INewtonPolicy(policyAddress).getPolicyData()` returned an array whose
 * length doesn't match `args.modules.length`. The deployed composite
 * declared a different number of modules than the curator passed in.
 */
export class PolicyDataLengthMismatchError extends Error {
	override readonly name = "PolicyDataLengthMismatchError";
	constructor(
		readonly onChainLength: number,
		readonly providedLength: number,
	) {
		super(
			`on-chain getPolicyData() length=${onChainLength} but args.modules.length=${providedLength}`,
		);
	}
}

/**
 * Positional mismatch between the expected policy-data address (from
 * `module.deployments` OR `expectedPolicyDataAddresses`) and the on-chain
 * `getPolicyData()[i]` value. The recovery hint suggests the historical-pin
 * escape when the default lookup is in use.
 */
export class PolicyDataOrderingMismatchError extends Error {
	override readonly name = "PolicyDataOrderingMismatchError";
	constructor(
		readonly moduleIndex: number,
		readonly expected: Address,
		readonly actual: Address,
		recoveryHint: string,
	) {
		super(
			`policyData[${moduleIndex}]: expected ${expected} but on-chain returned ${actual}${recoveryHint}`,
		);
	}
}

/**
 * Pinned PolicyData's on-chain `getWasmCid()` doesn't match the curator's
 * `expectedWasmCids[i]`. Binds each pinned address to a module identity —
 * without this check, a curator could pair module A's id+schemas with
 * module B's PolicyData by passing B's address in A's slot.
 */
export class PinnedWasmCidMismatchError extends Error {
	override readonly name = "PinnedWasmCidMismatchError";
	constructor(
		readonly moduleIndex: number,
		readonly moduleId: string,
		readonly expectedWasmCid: string,
		readonly actualWasmCid: string,
	) {
		super(
			`pinned policyData for module \`${moduleId}\` (index ${moduleIndex}): expected wasmCid="${expectedWasmCid}" but on-chain getWasmCid()="${actualWasmCid}" — the pinned address belongs to a different module`,
		);
	}
}

/**
 * One module's `prepareQuery` rejected during composite aggregation.
 * `cause` carries the original error from `module.prepareQuery`. When
 * `cause` is an `Error`, the message is `<shortPackId>: <cause.message>`;
 * for non-`Error` throws, the message uses `String(cause)` but `.cause`
 * preserves the original shape regardless.
 */
export class CompositePrepareQueryError extends Error {
	override readonly name = "CompositePrepareQueryError";
	constructor(
		readonly moduleId: string,
		readonly shortPackId: string,
		override readonly cause: unknown,
	) {
		const causeMessage = cause instanceof Error ? cause.message : String(cause);
		super(`${shortPackId}: ${causeMessage}`, { cause });
	}
}
