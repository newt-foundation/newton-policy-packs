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
 * Async builder for a composite policy. Reads the deployed
 * `INewtonPolicy(policyAddress).getPolicyData()` array and aligns the curator's
 * `modules` to it: each on-chain policyData address is matched to the module
 * that resolves to it, by membership — NOT by input position. The returned
 * `modules`, `onChainPolicyData`, and `historicalBindings` are all in on-chain
 * order, so the emitted manifest matches the deployed array positionally
 * (`PolicyValidationLib.sol` enforces that on-chain). The curator therefore does
 * not have to pass `modules` in the same order as the `--policy-data-address`
 * deploy flags — a correct composite never fails just because its TypeScript
 * module list is ordered differently. A module SET that doesn't match the
 * deployed oracle set still fails (`CompositeModuleSetMismatchError`).
 *
 * For fresh composites: pass only `{ modules, chainId, env, publicClient, policyAddress }`.
 * For historical composites (deployed before a pack redeploy): also pass
 * `expectedPolicyDataAddresses` + `expectedWasmCids` to pin to the on-chain
 * snapshot (still matched to on-chain order by membership, not position).
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

	// Resolve each module's expected policyData address. Fresh path: from
	// `module.deployments[chainId][env]`. Historical-pin path: from the
	// curator-supplied `expectedPolicyDataAddresses` (paired positionally with
	// `modules` and `expectedWasmCids`).
	const usingHistoricalPin = !!args.expectedPolicyDataAddresses;
	type ModuleEntry = {
		readonly module: PolicyPack<unknown, unknown, unknown>;
		readonly expectedAddr: Address;
		readonly expectedCid?: string;
	};
	const entries: ModuleEntry[] = [];
	for (let i = 0; i < args.modules.length; i++) {
		// biome-ignore lint/style/noNonNullAssertion: bounds checked
		const module = args.modules[i]!;
		let expectedAddr: Address;
		if (usingHistoricalPin) {
			// biome-ignore lint/style/noNonNullAssertion: length verified above
			expectedAddr = getAddress(args.expectedPolicyDataAddresses![i]!);
		} else {
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
			expectedAddr = getAddress(deployment.policyData);
		}
		entries.push({
			module,
			expectedAddr,
			// biome-ignore lint/style/noNonNullAssertion: pin shape verified above
			expectedCid: usingHistoricalPin ? args.expectedWasmCids![i]! : undefined,
		});
	}

	// Index entries by expected policyData address. Distinct packs publish
	// distinct oracles, so two modules resolving to the same policyData is a
	// configuration error — the on-chain slot would be ambiguous to reorder to.
	const entryByAddr = new Map<Address, ModuleEntry>();
	for (const entry of entries) {
		if (entryByAddr.has(entry.expectedAddr)) {
			throw new CompositeBuilderError(
				`two modules resolve to the same policyData address ${entry.expectedAddr} — a composite must reference distinct oracles`,
			);
		}
		entryByAddr.set(entry.expectedAddr, entry);
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

	// Align modules to the on-chain order. Match each on-chain policyData
	// address to the module that resolves to it, by membership — so the curator
	// may pass `modules` in ANY order. A correct composite never fails merely
	// because its TypeScript list is ordered differently than the deployed
	// `--policy-data-address` flags. A genuine mismatch (an on-chain oracle no
	// provided module covers) still fails, as a set error not an ordering error.
	const reordered: ModuleEntry[] = [];
	const used = new Set<ModuleEntry>();
	for (let i = 0; i < onChainPolicyData.length; i++) {
		// biome-ignore lint/style/noNonNullAssertion: length checked
		const addr = onChainPolicyData[i]!;
		const entry = entryByAddr.get(addr);
		if (entry === undefined) {
			throw new CompositeModuleSetMismatchError(
				i,
				addr,
				entries.map((e) => e.expectedAddr),
				usingHistoricalPin,
			);
		}
		if (used.has(entry)) {
			throw new CompositeBuilderError(
				`on-chain getPolicyData() lists ${addr} more than once — a composite must reference distinct oracles`,
			);
		}
		used.add(entry);
		reordered.push(entry);
	}
	// length-equal + every on-chain address matched a distinct entry ⇒ every
	// entry is used exactly once (pigeonhole); no unused-module case remains.
	const orderedModules = reordered.map((e) => e.module);

	// Historical-pin path: two checks per module. (a) the pinned address really
	// serves the claimed cid (on-chain getWasmCid() === expectedWasmCids[i]); and
	// (b) the claimed cid belongs to the module — when the pack records a
	// `priorWasmCids` history for the cell, the cid must be one the module
	// actually produced. Together these bind the pinned (address, cid) to the
	// module's identity. A cell with no recorded history falls back to
	// curator-asserted trust for (b) (nothing to attest against).
	if (usingHistoricalPin) {
		const orderedAddrs = reordered.map((e) => e.expectedAddr);
		const useMulticall = !!args.publicClient.chain?.contracts?.multicall3?.address;
		let actualCids: string[];
		if (useMulticall) {
			actualCids = (await args.publicClient.multicall({
				contracts: orderedAddrs.map((addr) => ({
					address: addr,
					abi: POLICY_DATA_ABI,
					functionName: "getWasmCid" as const,
				})),
				allowFailure: false,
			})) as string[];
		} else {
			actualCids = await Promise.all(
				orderedAddrs.map(
					(addr) =>
						args.publicClient.readContract({
							address: addr,
							abi: POLICY_DATA_ABI,
							functionName: "getWasmCid",
						}) as Promise<string>,
				),
			);
		}
		for (let i = 0; i < reordered.length; i++) {
			// biome-ignore lint/style/noNonNullAssertion: length checked
			const entry = reordered[i]!;
			// biome-ignore lint/style/noNonNullAssertion: pin path guarantees a cid
			const pinnedCid = entry.expectedCid!;
			// (a) the pinned address actually serves the claimed cid.
			// biome-ignore lint/style/noNonNullAssertion: length checked
			if (actualCids[i]! !== pinnedCid) {
				throw new PinnedWasmCidMismatchError(
					i,
					entry.module.id,
					pinnedCid,
					// biome-ignore lint/style/noNonNullAssertion: length checked
					actualCids[i]!,
				);
			}
			// (b) the claimed cid belongs to THIS module. When the pack records a
			// `priorWasmCids` history, `{wasmCid} ∪ priorWasmCids` is the set of
			// cids the module has legitimately produced; a pin claiming any other
			// cid pairs this module's id/schemas with a foreign oracle. Opt-in: a
			// cell with no recorded history falls back to curator-asserted trust.
			const cell = entry.module.deployments?.[args.chainId]?.[args.env];
			if (cell?.priorWasmCids !== undefined) {
				const knownCids = [cell.wasmCid, ...cell.priorWasmCids];
				if (!knownCids.includes(pinnedCid)) {
					throw new PinnedWasmCidNotInModuleHistoryError(i, entry.module.id, pinnedCid, knownCids);
				}
			}
		}
	}

	// All invariants verified — build the runtime CompositePolicyPack. modules,
	// onChainPolicyData, and historicalBindings are all in on-chain order so the
	// emitted manifest matches the deployed getPolicyData() positionally.
	const historicalBindings = usingHistoricalPin
		? reordered.map((e) => ({
				policyDataAddress: e.expectedAddr,
				// biome-ignore lint/style/noNonNullAssertion: pin path guarantees a cid
				wasmCid: e.expectedCid!,
			}))
		: undefined;

	return {
		kind: "composite",
		modules: orderedModules,
		chainId: args.chainId,
		env: args.env,
		policyAddress: getAddress(args.policyAddress),
		onChainPolicyData,
		historicalBindings,
		prepareQuery: makeAggregatedPrepareQuery(orderedModules),
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
 * @deprecated Superseded by auto-reordering in `defineComposite`, which now
 * aligns the curator's `modules` to the on-chain `getPolicyData()` order
 * automatically — a pure ordering difference is no longer an error. Retained as
 * an exported symbol for API stability; `defineComposite` no longer throws it. A
 * genuine module-set mismatch throws {@link CompositeModuleSetMismatchError}
 * instead. Slated for removal in the next major.
 *
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
 * On-chain `getPolicyData()` returned a policyData address that none of the
 * provided modules resolves to. The curator's module SET doesn't match the
 * deployed composite's oracle set: a wrong `policyAddress`, a wrong
 * `(chainId, env)`, a missing module, or — on the historical-pin path — a wrong
 * `expectedPolicyDataAddresses` entry. Order-independent: `defineComposite`
 * reorders modules to the on-chain order, so only a genuine set mismatch (not a
 * permutation) reaches this error.
 */
export class CompositeModuleSetMismatchError extends Error {
	override readonly name = "CompositeModuleSetMismatchError";
	constructor(
		readonly onChainIndex: number,
		readonly onChainAddress: Address,
		readonly providedAddresses: ReadonlyArray<Address>,
		usingHistoricalPin: boolean,
	) {
		const hint = usingHistoricalPin
			? " — check that expectedPolicyDataAddresses match the on-chain getPolicyData()"
			: " — check policyAddress, chainId/env, and that every on-chain oracle has a corresponding module";
		super(
			`on-chain getPolicyData()[${onChainIndex}] = ${onChainAddress} matches none of the provided modules (which resolve to ${providedAddresses.join(", ")})${hint}`,
		);
	}
}

/**
 * Pinned PolicyData's on-chain `getWasmCid()` doesn't match the curator's
 * `expectedWasmCids[i]` — the pinned address doesn't serve the WASM the curator
 * claimed for it (check (a) of the historical-pin path). The companion
 * {@link PinnedWasmCidNotInModuleHistoryError} enforces check (b): that the
 * claimed cid also belongs to the named module.
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
 * Historical-pin only: the curator's `expectedWasmCids[i]` is not in module
 * `i`'s attested cid set (`{wasmCid} ∪ priorWasmCids` from the pack's deployment
 * record). The pinned address may serve that WASM, but the WASM was never
 * produced by the module the curator named — i.e. the pin pairs this module's
 * id/schemas with a foreign oracle. Only enforced for cells that record a
 * `priorWasmCids` history; modules without one fall back to curator-asserted
 * trust.
 */
export class PinnedWasmCidNotInModuleHistoryError extends Error {
	override readonly name = "PinnedWasmCidNotInModuleHistoryError";
	constructor(
		readonly moduleIndex: number,
		readonly moduleId: string,
		readonly pinnedWasmCid: string,
		readonly knownWasmCids: ReadonlyArray<string>,
	) {
		super(
			`pinned wasmCid "${pinnedWasmCid}" for module \`${moduleId}\` (index ${moduleIndex}) is not in the module's attested cid set [${knownWasmCids.join(", ")}] — the pin claims a WASM this module never produced`,
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
