import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import type { Address } from "viem";
import { z } from "zod";
import { decodeManifest } from "./composite-manifest";
import {
	ChainMismatchError,
	CompositeBuilderError,
	CompositeModuleSetMismatchError,
	CompositePrepareQueryError,
	defineComposite,
	encodeCompositePolicyPack,
	PinnedWasmCidMismatchError,
	PinnedWasmCidNotInModuleHistoryError,
	PolicyDataLengthMismatchError,
	UnknownPackIdError,
} from "./composite-pack";
import type { Deployment, PolicyPack, PrepareQueryArgs, PrepareQueryResult } from "./index";
import { UnsupportedChainError, UnsupportedEnvError } from "./pack";

const SHIELD: Address = "0x9999999999999999999999999999999999999999";
const POLICY: Address = "0x8888888888888888888888888888888888888888";
const SEPOLIA_MULTICALL3: Address = "0xcA11bde05977b3631167028862bE2a173976CA11";

const VAULTSFYI_DEPLOYMENT: Deployment = {
	policyData: "0x4b1c450b1DA523EdB0C2aB0c905267281d36cb7c",
	wasmCid: "bafyvaultsfyi",
	policyCodeHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	deployedAt: "2026-06-16",
};

const CHAINALYSIS_DEPLOYMENT: Deployment = {
	policyData: "0x2222222222222222222222222222222222222222",
	wasmCid: "bafychainalysis",
	policyCodeHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
	deployedAt: "2026-06-16",
};

// A cid vaultsfyi served before a (hypothetical) redeploy — used by the
// historical-pin module↔cid binding tests.
const OLD_VAULTSFYI_CID = "bafyvaultsfyiOLD";

function makePack(
	id: string,
	deployment: Deployment,
	prepareQuery?: (
		args: PrepareQueryArgs,
		options?: unknown,
	) => Promise<PrepareQueryResult<unknown>>,
): PolicyPack<unknown, unknown, unknown> {
	return {
		id,
		paramsSchema: z.object({}).passthrough() as z.ZodType<unknown>,
		wasmArgsSchema: z.object({}).passthrough() as z.ZodType<unknown>,
		secretsSchema: z.object({}).passthrough() as z.ZodType<unknown>,
		deployments: { "11155111": { stagef: deployment } },
		metadata: { name: id.split("/")[0] ?? id, version: "1.0.0", description: "test" },
		...(prepareQuery ? { prepareQuery } : {}),
	};
}

const VAULTSFYI = makePack("vaultsfyi/risk-envelope/v1", VAULTSFYI_DEPLOYMENT);
const CHAINALYSIS = makePack("chainalysis/screening/v1", CHAINALYSIS_DEPLOYMENT);

interface FakeClientOpts {
	hasMulticall?: boolean;
	chainId?: number;
	onChainPolicyData?: ReadonlyArray<Address>;
	wasmCidsByPolicyData?: Record<string, string>;
}

function makeFakeClient(opts: FakeClientOpts = {}) {
	const chain = opts.chainId
		? {
				id: opts.chainId,
				contracts: opts.hasMulticall
					? { multicall3: { address: SEPOLIA_MULTICALL3, blockCreated: 0 } }
					: undefined,
			}
		: undefined;
	const calls: string[] = [];
	return {
		calls,
		client: {
			chain,
			async readContract(args: { functionName: string; address: Address }) {
				calls.push(args.functionName);
				if (args.functionName === "getPolicyData") {
					return [...(opts.onChainPolicyData ?? [])];
				}
				if (args.functionName === "getWasmCid") {
					return opts.wasmCidsByPolicyData?.[args.address.toLowerCase()] ?? "";
				}
				throw new Error(`unexpected readContract: ${args.functionName}`);
			},
			async multicall(args: {
				contracts: ReadonlyArray<{ functionName: string; address: Address }>;
			}) {
				calls.push("multicall");
				return Promise.all(
					args.contracts.map(async (c) => {
						if (c.functionName === "getPolicyData") return [...(opts.onChainPolicyData ?? [])];
						if (c.functionName === "getWasmCid") {
							return opts.wasmCidsByPolicyData?.[c.address.toLowerCase()] ?? "";
						}
						throw new Error(`unexpected multicall: ${c.functionName}`);
					}),
				);
			},
		},
	};
}

describe("defineComposite — invariant checks (cheap, no RPC)", () => {
	it("throws CompositeBuilderError on empty modules", async () => {
		const fake = makeFakeClient();
		await assert.rejects(
			defineComposite({
				modules: [],
				chainId: "11155111",
				env: "stagef",
				// biome-ignore lint/suspicious/noExplicitAny: fake client
				publicClient: fake.client as any,
				policyAddress: POLICY,
			}),
			(err: unknown) =>
				err instanceof CompositeBuilderError && /non-empty/.test((err as Error).message),
		);
	});

	it("throws CompositeBuilderError on zero policyAddress", async () => {
		const fake = makeFakeClient();
		await assert.rejects(
			defineComposite({
				modules: [VAULTSFYI],
				chainId: "11155111",
				env: "stagef",
				// biome-ignore lint/suspicious/noExplicitAny: fake client
				publicClient: fake.client as any,
				policyAddress: "0x0000000000000000000000000000000000000000",
			}),
			(err: unknown) =>
				err instanceof CompositeBuilderError && /zero address/.test((err as Error).message),
		);
	});

	it("throws ChainMismatchError when publicClient.chain.id disagrees with args.chainId", async () => {
		const fake = makeFakeClient({ chainId: 84532 }); // Base Sepolia, not Sepolia
		await assert.rejects(
			defineComposite({
				modules: [VAULTSFYI],
				chainId: "11155111",
				env: "stagef",
				// biome-ignore lint/suspicious/noExplicitAny: fake client
				publicClient: fake.client as any,
				policyAddress: POLICY,
			}),
			(err: unknown) => err instanceof ChainMismatchError,
		);
	});

	it("skips ChainMismatchError check when publicClient.chain is undefined", async () => {
		const fake = makeFakeClient({
			onChainPolicyData: [VAULTSFYI_DEPLOYMENT.policyData],
		});
		const result = await defineComposite({
			modules: [VAULTSFYI],
			chainId: "11155111",
			env: "stagef",
			// biome-ignore lint/suspicious/noExplicitAny: fake client
			publicClient: fake.client as any,
			policyAddress: POLICY,
		});
		assert.equal(result.kind, "composite");
	});

	it("throws UnknownPackIdError on a module with an unregistered short id", async () => {
		const ROGUE = makePack("rogue/v1", {
			...VAULTSFYI_DEPLOYMENT,
			policyData: "0xCcCC000000000000000000000000000000000000",
		});
		const fake = makeFakeClient();
		await assert.rejects(
			defineComposite({
				modules: [ROGUE],
				chainId: "11155111",
				env: "stagef",
				// biome-ignore lint/suspicious/noExplicitAny: fake client
				publicClient: fake.client as any,
				policyAddress: POLICY,
			}),
			(err: unknown) =>
				err instanceof UnknownPackIdError && (err as UnknownPackIdError).shortId === "rogue",
		);
	});

	it("allows an unregistered short id when allowUnknownPackIds is true", async () => {
		const ROGUE_PD: Address = "0xCcCc000000000000000000000000000000000000";
		const ROGUE = makePack("rogue/v1", { ...VAULTSFYI_DEPLOYMENT, policyData: ROGUE_PD });
		const fake = makeFakeClient({ onChainPolicyData: [ROGUE_PD] });
		const result = await defineComposite({
			modules: [ROGUE],
			chainId: "11155111",
			env: "stagef",
			// biome-ignore lint/suspicious/noExplicitAny: fake client
			publicClient: fake.client as any,
			policyAddress: POLICY,
			allowUnknownPackIds: true,
		});
		assert.equal(result.kind, "composite");
		assert.equal(result.modules.length, 1);
	});

	it("still throws CompositeBuilderError on duplicate short ids even with allowUnknownPackIds", async () => {
		// Both derive shortId="rogue" — the duplicate guard is independent of the
		// registry gate, so relaxing membership must not relax uniqueness.
		const ROGUE_V1 = makePack("rogue/v1", {
			...VAULTSFYI_DEPLOYMENT,
			policyData: "0xCcCc000000000000000000000000000000000000",
		});
		const ROGUE_V2 = makePack("rogue/v2", {
			...CHAINALYSIS_DEPLOYMENT,
			policyData: "0xDdDd000000000000000000000000000000000000",
		});
		const fake = makeFakeClient();
		await assert.rejects(
			defineComposite({
				modules: [ROGUE_V1, ROGUE_V2],
				chainId: "11155111",
				env: "stagef",
				// biome-ignore lint/suspicious/noExplicitAny: fake client
				publicClient: fake.client as any,
				policyAddress: POLICY,
				allowUnknownPackIds: true,
			}),
			(err: unknown) =>
				err instanceof CompositeBuilderError &&
				/duplicate short pack id/.test((err as Error).message),
		);
	});

	it("still enforces the on-chain set-match with allowUnknownPackIds (flag relaxes only the registry gate)", async () => {
		const ROGUE_PD: Address = "0xCcCc000000000000000000000000000000000000";
		const ROGUE = makePack("rogue/v1", { ...VAULTSFYI_DEPLOYMENT, policyData: ROGUE_PD });
		// on-chain getPolicyData() returns a DIFFERENT address → the set-match
		// must still fire even though the registry gate is relaxed.
		const fake = makeFakeClient({
			onChainPolicyData: ["0xEeEe000000000000000000000000000000000000"],
		});
		await assert.rejects(
			defineComposite({
				modules: [ROGUE],
				chainId: "11155111",
				env: "stagef",
				// biome-ignore lint/suspicious/noExplicitAny: fake client
				publicClient: fake.client as any,
				policyAddress: POLICY,
				allowUnknownPackIds: true,
			}),
			(err: unknown) => err instanceof CompositeModuleSetMismatchError,
		);
	});

	it("throws CompositeBuilderError on duplicate short pack ids", async () => {
		// Two vaultsfyi modules — both derive shortId="vaultsfyi"
		const VAULTSFYI_V2 = makePack("vaultsfyi/risk-envelope/v2", VAULTSFYI_DEPLOYMENT);
		const fake = makeFakeClient();
		await assert.rejects(
			defineComposite({
				modules: [VAULTSFYI, VAULTSFYI_V2],
				chainId: "11155111",
				env: "stagef",
				// biome-ignore lint/suspicious/noExplicitAny: fake client
				publicClient: fake.client as any,
				policyAddress: POLICY,
			}),
			(err: unknown) =>
				err instanceof CompositeBuilderError &&
				/duplicate short pack id/.test((err as Error).message),
		);
	});

	it("throws CompositeBuilderError when expectedPolicyDataAddresses provided without expectedWasmCids", async () => {
		const fake = makeFakeClient();
		await assert.rejects(
			defineComposite({
				modules: [VAULTSFYI],
				chainId: "11155111",
				env: "stagef",
				// biome-ignore lint/suspicious/noExplicitAny: fake client
				publicClient: fake.client as any,
				policyAddress: POLICY,
				expectedPolicyDataAddresses: [VAULTSFYI_DEPLOYMENT.policyData],
				// expectedWasmCids missing
			}),
			(err: unknown) =>
				err instanceof CompositeBuilderError &&
				/must be provided together/.test((err as Error).message),
		);
	});
});

describe("defineComposite — missing-deployment surfaces canonical errors", () => {
	it("throws UnsupportedChainError when module has no deployment on the requested chain (fresh path)", async () => {
		const fake = makeFakeClient();
		await assert.rejects(
			defineComposite({
				modules: [VAULTSFYI],
				chainId: "1", // mainnet — VAULTSFYI fixture only has Sepolia
				env: "stagef",
				// biome-ignore lint/suspicious/noExplicitAny: fake client
				publicClient: fake.client as any,
				policyAddress: POLICY,
			}),
			(err: unknown) => err instanceof UnsupportedChainError,
		);
	});

	it("throws UnsupportedEnvError when module is on the chain but missing the env (fresh path)", async () => {
		const fake = makeFakeClient();
		await assert.rejects(
			defineComposite({
				modules: [VAULTSFYI],
				chainId: "11155111",
				env: "prod", // VAULTSFYI fixture only has stagef
				// biome-ignore lint/suspicious/noExplicitAny: fake client
				publicClient: fake.client as any,
				policyAddress: POLICY,
			}),
			(err: unknown) => err instanceof UnsupportedEnvError,
		);
	});
});

describe("defineComposite — on-chain ordering checks", () => {
	it("throws PolicyDataLengthMismatchError when getPolicyData length differs from modules.length", async () => {
		const fake = makeFakeClient({
			onChainPolicyData: [VAULTSFYI_DEPLOYMENT.policyData], // 1 entry
		});
		await assert.rejects(
			defineComposite({
				modules: [VAULTSFYI, CHAINALYSIS], // 2 modules
				chainId: "11155111",
				env: "stagef",
				// biome-ignore lint/suspicious/noExplicitAny: fake client
				publicClient: fake.client as any,
				policyAddress: POLICY,
			}),
			(err: unknown) =>
				err instanceof PolicyDataLengthMismatchError &&
				(err as PolicyDataLengthMismatchError).onChainLength === 1 &&
				(err as PolicyDataLengthMismatchError).providedLength === 2,
		);
	});

	it("reorders modules to match on-chain order — input order need not match", async () => {
		// On-chain order is swapped vs the modules array the curator passed.
		// Pre-auto-reorder this threw PolicyDataOrderingMismatchError; now it
		// succeeds and the returned modules + manifest are aligned to on-chain order.
		const fake = makeFakeClient({
			onChainPolicyData: [CHAINALYSIS_DEPLOYMENT.policyData, VAULTSFYI_DEPLOYMENT.policyData],
		});
		const result = await defineComposite({
			modules: [VAULTSFYI, CHAINALYSIS], // opposite of on-chain order
			chainId: "11155111",
			env: "stagef",
			// biome-ignore lint/suspicious/noExplicitAny: fake client
			publicClient: fake.client as any,
			policyAddress: POLICY,
		});
		assert.deepEqual(
			result.modules.map((m) => m.id),
			[CHAINALYSIS.id, VAULTSFYI.id],
		);
		const manifest = decodeManifest(
			encodeCompositePolicyPack(result, { vaultsfyi: {}, chainalysis: {} }),
		);
		assert.equal(
			manifest.modules[0]?.policyDataAddress.toLowerCase(),
			CHAINALYSIS_DEPLOYMENT.policyData.toLowerCase(),
		);
		assert.equal(
			manifest.modules[1]?.policyDataAddress.toLowerCase(),
			VAULTSFYI_DEPLOYMENT.policyData.toLowerCase(),
		);
	});

	it("throws CompositeModuleSetMismatchError when an on-chain oracle has no matching module", async () => {
		// Length matches, but the on-chain composite references an address no
		// provided module resolves to — a genuine set mismatch, not a permutation.
		const STRANGER: Address = "0x3333333333333333333333333333333333333333";
		const fake = makeFakeClient({
			onChainPolicyData: [VAULTSFYI_DEPLOYMENT.policyData, STRANGER],
		});
		await assert.rejects(
			defineComposite({
				modules: [VAULTSFYI, CHAINALYSIS], // chainalysis (0x2222) isn't on-chain
				chainId: "11155111",
				env: "stagef",
				// biome-ignore lint/suspicious/noExplicitAny: fake client
				publicClient: fake.client as any,
				policyAddress: POLICY,
			}),
			(err: unknown) =>
				err instanceof CompositeModuleSetMismatchError &&
				(err as CompositeModuleSetMismatchError).onChainAddress.toLowerCase() ===
					STRANGER.toLowerCase() &&
				/check policyAddress/.test((err as Error).message),
		);
	});

	it("throws CompositeModuleSetMismatchError when a historical pin doesn't match on-chain", async () => {
		const fake = makeFakeClient({
			onChainPolicyData: [VAULTSFYI_DEPLOYMENT.policyData],
		});
		await assert.rejects(
			defineComposite({
				modules: [VAULTSFYI],
				chainId: "11155111",
				env: "stagef",
				// biome-ignore lint/suspicious/noExplicitAny: fake client
				publicClient: fake.client as any,
				policyAddress: POLICY,
				expectedPolicyDataAddresses: [CHAINALYSIS_DEPLOYMENT.policyData], // wrong pin
				expectedWasmCids: [CHAINALYSIS_DEPLOYMENT.wasmCid],
			}),
			(err: unknown) =>
				err instanceof CompositeModuleSetMismatchError &&
				/expectedPolicyDataAddresses/.test((err as Error).message),
		);
	});

	it("throws CompositeBuilderError when the on-chain array lists the same policyData twice", async () => {
		const fake = makeFakeClient({
			onChainPolicyData: [VAULTSFYI_DEPLOYMENT.policyData, VAULTSFYI_DEPLOYMENT.policyData],
		});
		await assert.rejects(
			defineComposite({
				modules: [VAULTSFYI, CHAINALYSIS],
				chainId: "11155111",
				env: "stagef",
				// biome-ignore lint/suspicious/noExplicitAny: fake client
				publicClient: fake.client as any,
				policyAddress: POLICY,
			}),
			(err: unknown) =>
				err instanceof CompositeBuilderError && /more than once/.test((err as Error).message),
		);
	});

	it("throws CompositeBuilderError when two modules resolve to the same policyData address", async () => {
		// Two distinct packs pointed at the same oracle address — ambiguous which
		// on-chain slot each owns. Caught before any RPC.
		const TWIN = makePack("chainalysis/screening/v1", VAULTSFYI_DEPLOYMENT);
		const fake = makeFakeClient();
		await assert.rejects(
			defineComposite({
				modules: [VAULTSFYI, TWIN],
				chainId: "11155111",
				env: "stagef",
				// biome-ignore lint/suspicious/noExplicitAny: fake client
				publicClient: fake.client as any,
				policyAddress: POLICY,
			}),
			(err: unknown) =>
				err instanceof CompositeBuilderError &&
				/two modules resolve to the same policyData/.test((err as Error).message),
		);
	});
});

describe("defineComposite — historical-pin path with wasmCid identity check", () => {
	it("succeeds when expected pins match on-chain getWasmCid", async () => {
		const fake = makeFakeClient({
			onChainPolicyData: [VAULTSFYI_DEPLOYMENT.policyData, CHAINALYSIS_DEPLOYMENT.policyData],
			wasmCidsByPolicyData: {
				[VAULTSFYI_DEPLOYMENT.policyData.toLowerCase()]: VAULTSFYI_DEPLOYMENT.wasmCid,
				[CHAINALYSIS_DEPLOYMENT.policyData.toLowerCase()]: CHAINALYSIS_DEPLOYMENT.wasmCid,
			},
		});
		const result = await defineComposite({
			modules: [VAULTSFYI, CHAINALYSIS],
			chainId: "11155111",
			env: "stagef",
			// biome-ignore lint/suspicious/noExplicitAny: fake client
			publicClient: fake.client as any,
			policyAddress: POLICY,
			expectedPolicyDataAddresses: [
				VAULTSFYI_DEPLOYMENT.policyData,
				CHAINALYSIS_DEPLOYMENT.policyData,
			],
			expectedWasmCids: [VAULTSFYI_DEPLOYMENT.wasmCid, CHAINALYSIS_DEPLOYMENT.wasmCid],
		});
		assert.equal(result.kind, "composite");
		assert.deepEqual(result.historicalBindings?.length, 2);
	});

	it("throws PinnedWasmCidMismatchError when a pinned address points at a different module's WASM", async () => {
		// Curator passes module A (vaultsfyi) but pins to module B's address —
		// the on-chain getWasmCid() returns module B's CID, which doesn't match
		// the expectedWasmCid the curator declared.
		const fake = makeFakeClient({
			onChainPolicyData: [CHAINALYSIS_DEPLOYMENT.policyData],
			wasmCidsByPolicyData: {
				[CHAINALYSIS_DEPLOYMENT.policyData.toLowerCase()]: CHAINALYSIS_DEPLOYMENT.wasmCid,
			},
		});
		await assert.rejects(
			defineComposite({
				modules: [VAULTSFYI], // claims this is vaultsfyi
				chainId: "11155111",
				env: "stagef",
				// biome-ignore lint/suspicious/noExplicitAny: fake client
				publicClient: fake.client as any,
				policyAddress: POLICY,
				expectedPolicyDataAddresses: [CHAINALYSIS_DEPLOYMENT.policyData], // but pins to chainalysis's PolicyData
				expectedWasmCids: [VAULTSFYI_DEPLOYMENT.wasmCid], // and lies that it's vaultsfyi's CID
			}),
			(err: unknown) =>
				err instanceof PinnedWasmCidMismatchError &&
				(err as PinnedWasmCidMismatchError).expectedWasmCid === VAULTSFYI_DEPLOYMENT.wasmCid &&
				(err as PinnedWasmCidMismatchError).actualWasmCid === CHAINALYSIS_DEPLOYMENT.wasmCid,
		);
	});

	it("uses multicall when configured", async () => {
		const fake = makeFakeClient({
			hasMulticall: true,
			chainId: 11155111,
			onChainPolicyData: [VAULTSFYI_DEPLOYMENT.policyData],
			wasmCidsByPolicyData: {
				[VAULTSFYI_DEPLOYMENT.policyData.toLowerCase()]: VAULTSFYI_DEPLOYMENT.wasmCid,
			},
		});
		await defineComposite({
			modules: [VAULTSFYI],
			chainId: "11155111",
			env: "stagef",
			// biome-ignore lint/suspicious/noExplicitAny: fake client
			publicClient: fake.client as any,
			policyAddress: POLICY,
			expectedPolicyDataAddresses: [VAULTSFYI_DEPLOYMENT.policyData],
			expectedWasmCids: [VAULTSFYI_DEPLOYMENT.wasmCid],
		});
		assert.ok(fake.calls.includes("multicall"));
	});

	it("reorders the historical-pin triples to match on-chain order", async () => {
		// Curator passes modules + pins in [vaultsfyi, chainalysis] order, but the
		// on-chain composite is [chainalysis, vaultsfyi]. The (module, pinnedAddr,
		// pinnedCid) triples are realigned together; the wasmCid identity check
		// still binds each address to its module, and the bindings come back in
		// on-chain order.
		const fake = makeFakeClient({
			onChainPolicyData: [CHAINALYSIS_DEPLOYMENT.policyData, VAULTSFYI_DEPLOYMENT.policyData],
			wasmCidsByPolicyData: {
				[VAULTSFYI_DEPLOYMENT.policyData.toLowerCase()]: VAULTSFYI_DEPLOYMENT.wasmCid,
				[CHAINALYSIS_DEPLOYMENT.policyData.toLowerCase()]: CHAINALYSIS_DEPLOYMENT.wasmCid,
			},
		});
		const result = await defineComposite({
			modules: [VAULTSFYI, CHAINALYSIS],
			chainId: "11155111",
			env: "stagef",
			// biome-ignore lint/suspicious/noExplicitAny: fake client
			publicClient: fake.client as any,
			policyAddress: POLICY,
			expectedPolicyDataAddresses: [
				VAULTSFYI_DEPLOYMENT.policyData,
				CHAINALYSIS_DEPLOYMENT.policyData,
			],
			expectedWasmCids: [VAULTSFYI_DEPLOYMENT.wasmCid, CHAINALYSIS_DEPLOYMENT.wasmCid],
		});
		assert.deepEqual(
			result.modules.map((m) => m.id),
			[CHAINALYSIS.id, VAULTSFYI.id],
		);
		assert.equal(
			result.historicalBindings?.[0]?.policyDataAddress.toLowerCase(),
			CHAINALYSIS_DEPLOYMENT.policyData.toLowerCase(),
		);
		assert.equal(result.historicalBindings?.[0]?.wasmCid, CHAINALYSIS_DEPLOYMENT.wasmCid);
	});

	it("historical pin to a recorded prior wasmCid succeeds (module↔cid bound)", async () => {
		// vaultsfyi redeployed: the current cell records the superseded cid in
		// priorWasmCids. A composite pinned to the OLD address+cid validates — the
		// pinned cid is in the module's attested {current} ∪ priorWasmCids set.
		const OLD_ADDR: Address = "0x5555555555555555555555555555555555555555";
		const moduleRedeployed = makePack("vaultsfyi/risk-envelope/v1", {
			...VAULTSFYI_DEPLOYMENT,
			priorWasmCids: [OLD_VAULTSFYI_CID],
		});
		const fake = makeFakeClient({
			onChainPolicyData: [OLD_ADDR],
			wasmCidsByPolicyData: { [OLD_ADDR.toLowerCase()]: OLD_VAULTSFYI_CID },
		});
		const result = await defineComposite({
			modules: [moduleRedeployed],
			chainId: "11155111",
			env: "stagef",
			// biome-ignore lint/suspicious/noExplicitAny: fake client
			publicClient: fake.client as any,
			policyAddress: POLICY,
			expectedPolicyDataAddresses: [OLD_ADDR],
			expectedWasmCids: [OLD_VAULTSFYI_CID],
		});
		assert.equal(result.kind, "composite");
		assert.equal(result.historicalBindings?.[0]?.wasmCid, OLD_VAULTSFYI_CID);
	});

	it("throws PinnedWasmCidNotInModuleHistoryError when a pinned cid is not in the module's attested history", async () => {
		// The codex scenario: pin module `vaultsfyi` to a FOREIGN oracle whose
		// address self-consistently serves its own cid (so check (a) passes). With
		// a recorded cid history, check (b) catches that the cid was never
		// vaultsfyi's — the pin pairs vaultsfyi's id with a foreign oracle.
		const FOREIGN_ADDR: Address = "0x6666666666666666666666666666666666666666";
		const FOREIGN_CID = "bafyforeignoracle";
		const moduleRedeployed = makePack("vaultsfyi/risk-envelope/v1", {
			...VAULTSFYI_DEPLOYMENT,
			priorWasmCids: [OLD_VAULTSFYI_CID],
		});
		const fake = makeFakeClient({
			onChainPolicyData: [FOREIGN_ADDR],
			wasmCidsByPolicyData: { [FOREIGN_ADDR.toLowerCase()]: FOREIGN_CID },
		});
		await assert.rejects(
			defineComposite({
				modules: [moduleRedeployed],
				chainId: "11155111",
				env: "stagef",
				// biome-ignore lint/suspicious/noExplicitAny: fake client
				publicClient: fake.client as any,
				policyAddress: POLICY,
				expectedPolicyDataAddresses: [FOREIGN_ADDR],
				expectedWasmCids: [FOREIGN_CID],
			}),
			(err: unknown) =>
				err instanceof PinnedWasmCidNotInModuleHistoryError &&
				(err as PinnedWasmCidNotInModuleHistoryError).pinnedWasmCid === FOREIGN_CID &&
				(err as PinnedWasmCidNotInModuleHistoryError).moduleId === "vaultsfyi/risk-envelope/v1" &&
				(err as PinnedWasmCidNotInModuleHistoryError).knownWasmCids.includes(OLD_VAULTSFYI_CID) &&
				!(err as PinnedWasmCidNotInModuleHistoryError).knownWasmCids.includes(FOREIGN_CID),
		);
	});

	it("historical pin without a recorded cid history falls back to curator trust", async () => {
		// VAULTSFYI fixture records no priorWasmCids → check (b) is skipped, and the
		// pin to a foreign-but-self-consistent oracle (chainalysis's address+cid
		// stands in as the foreign oracle here) succeeds. Documents the residual
		// trust boundary for modules a pack has not recorded history for.
		const fake = makeFakeClient({
			onChainPolicyData: [CHAINALYSIS_DEPLOYMENT.policyData],
			wasmCidsByPolicyData: {
				[CHAINALYSIS_DEPLOYMENT.policyData.toLowerCase()]: CHAINALYSIS_DEPLOYMENT.wasmCid,
			},
		});
		const result = await defineComposite({
			modules: [VAULTSFYI],
			chainId: "11155111",
			env: "stagef",
			// biome-ignore lint/suspicious/noExplicitAny: fake client
			publicClient: fake.client as any,
			policyAddress: POLICY,
			expectedPolicyDataAddresses: [CHAINALYSIS_DEPLOYMENT.policyData],
			expectedWasmCids: [CHAINALYSIS_DEPLOYMENT.wasmCid],
		});
		assert.equal(result.kind, "composite");
	});

	it("allowUnknownPackIds relaxes only the registry gate — historical-pin wasmCid check still fires", async () => {
		// A bespoke pack (short id not in KNOWN_PACK_IDS) on the historical-pin
		// path. allowUnknownPackIds lets it past the membership gate, but the
		// pinned-address getWasmCid() identity check (a) must STILL fire: here the
		// pinned address serves a different cid than the curator declared, so it
		// throws PinnedWasmCidMismatchError despite the relaxed gate.
		const BESPOKE_ADDR: Address = "0x7777777777777777777777777777777777777777";
		const bespoke = makePack("bespoke/v1", { ...VAULTSFYI_DEPLOYMENT, policyData: BESPOKE_ADDR });
		const fake = makeFakeClient({
			onChainPolicyData: [BESPOKE_ADDR],
			wasmCidsByPolicyData: { [BESPOKE_ADDR.toLowerCase()]: "bafyactualbespoke" },
		});
		await assert.rejects(
			defineComposite({
				modules: [bespoke],
				chainId: "11155111",
				env: "stagef",
				// biome-ignore lint/suspicious/noExplicitAny: fake client
				publicClient: fake.client as any,
				policyAddress: POLICY,
				allowUnknownPackIds: true,
				expectedPolicyDataAddresses: [BESPOKE_ADDR],
				expectedWasmCids: ["bafydeclaredbutwrong"],
			}),
			(err: unknown) =>
				err instanceof PinnedWasmCidMismatchError &&
				(err as PinnedWasmCidMismatchError).actualWasmCid === "bafyactualbespoke",
		);
	});
});

describe("defineComposite — happy path (fresh composite, no historical pin)", () => {
	it("returns a CompositePolicyPack with correct fields", async () => {
		const fake = makeFakeClient({
			onChainPolicyData: [VAULTSFYI_DEPLOYMENT.policyData, CHAINALYSIS_DEPLOYMENT.policyData],
		});
		const result = await defineComposite({
			modules: [VAULTSFYI, CHAINALYSIS],
			chainId: "11155111",
			env: "stagef",
			// biome-ignore lint/suspicious/noExplicitAny: fake client
			publicClient: fake.client as any,
			policyAddress: POLICY,
		});
		assert.equal(result.kind, "composite");
		assert.equal(result.modules.length, 2);
		assert.equal(result.chainId, "11155111");
		assert.equal(result.env, "stagef");
		assert.equal(result.onChainPolicyData.length, 2);
		assert.equal(result.historicalBindings, undefined); // fresh, no pin
		assert.ok(typeof result.prepareQuery === "function");
	});
});

describe("composite prepareQuery aggregation", () => {
	it("merges per-module wasmArgs keyed by short pack id", async () => {
		const VAULTSFYI_PQ = makePack(
			"vaultsfyi/risk-envelope/v1",
			VAULTSFYI_DEPLOYMENT,
			async (_args, _options) => ({ wasmArgs: { vault: "0xVAULT", marker: "vaultsfyi" } }),
		);
		const CHAINALYSIS_PQ = makePack(
			"chainalysis/screening/v1",
			CHAINALYSIS_DEPLOYMENT,
			async (_args, options) => ({
				wasmArgs: { address: (options as { address?: string }).address ?? "default" },
			}),
		);
		const fake = makeFakeClient({
			onChainPolicyData: [VAULTSFYI_DEPLOYMENT.policyData, CHAINALYSIS_DEPLOYMENT.policyData],
		});
		const composite = await defineComposite({
			modules: [VAULTSFYI_PQ, CHAINALYSIS_PQ],
			chainId: "11155111",
			env: "stagef",
			// biome-ignore lint/suspicious/noExplicitAny: fake client
			publicClient: fake.client as any,
			policyAddress: POLICY,
		});

		const result = await composite.prepareQuery(
			// biome-ignore lint/suspicious/noExplicitAny: fake client args
			{ publicClient: fake.client as any, subject: "0xVAULT" },
			{ chainalysis: { address: "0xDEPOSITOR" } },
		);
		assert.deepEqual(result.wasmArgs, {
			vaultsfyi: { vault: "0xVAULT", marker: "vaultsfyi" },
			chainalysis: { address: "0xDEPOSITOR" },
		});
	});

	it("modules without prepareQuery get {} under their short id", async () => {
		// VAULTSFYI is defined without prepareQuery
		const fake = makeFakeClient({
			onChainPolicyData: [VAULTSFYI_DEPLOYMENT.policyData],
		});
		const composite = await defineComposite({
			modules: [VAULTSFYI],
			chainId: "11155111",
			env: "stagef",
			// biome-ignore lint/suspicious/noExplicitAny: fake client
			publicClient: fake.client as any,
			policyAddress: POLICY,
		});
		const result = await composite.prepareQuery(
			// biome-ignore lint/suspicious/noExplicitAny: fake client
			{ publicClient: fake.client as any, subject: "0xVAULT" },
		);
		assert.deepEqual(result.wasmArgs, { vaultsfyi: {} });
	});

	it("fail-fast: wraps the failing module's error in CompositePrepareQueryError", async () => {
		const VAULTSFYI_THROWS = makePack(
			"vaultsfyi/risk-envelope/v1",
			VAULTSFYI_DEPLOYMENT,
			async () => {
				throw new Error("api unreachable");
			},
		);
		const fake = makeFakeClient({
			onChainPolicyData: [VAULTSFYI_DEPLOYMENT.policyData],
		});
		const composite = await defineComposite({
			modules: [VAULTSFYI_THROWS],
			chainId: "11155111",
			env: "stagef",
			// biome-ignore lint/suspicious/noExplicitAny: fake client
			publicClient: fake.client as any,
			policyAddress: POLICY,
		});
		await assert.rejects(
			composite.prepareQuery(
				// biome-ignore lint/suspicious/noExplicitAny: fake client
				{ publicClient: fake.client as any, subject: "0xVAULT" },
			),
			(err: unknown) => {
				if (!(err instanceof CompositePrepareQueryError)) return false;
				assert.equal(err.shortPackId, "vaultsfyi");
				assert.equal(err.moduleId, "vaultsfyi/risk-envelope/v1");
				assert.match(err.message, /vaultsfyi: api unreachable/);
				return true;
			},
		);
	});

	it("non-Error throws are normalized via String(cause)", async () => {
		const VAULTSFYI_STRING_THROW = makePack(
			"vaultsfyi/risk-envelope/v1",
			VAULTSFYI_DEPLOYMENT,
			async () => {
				// biome-ignore lint/suspicious/noExplicitAny: testing non-Error throw
				throw "plain string thrown" as any;
			},
		);
		const fake = makeFakeClient({
			onChainPolicyData: [VAULTSFYI_DEPLOYMENT.policyData],
		});
		const composite = await defineComposite({
			modules: [VAULTSFYI_STRING_THROW],
			chainId: "11155111",
			env: "stagef",
			// biome-ignore lint/suspicious/noExplicitAny: fake client
			publicClient: fake.client as any,
			policyAddress: POLICY,
		});
		await assert.rejects(
			composite.prepareQuery(
				// biome-ignore lint/suspicious/noExplicitAny: fake client
				{ publicClient: fake.client as any, subject: "0xVAULT" },
			),
			(err: unknown) => {
				if (!(err instanceof CompositePrepareQueryError)) return false;
				assert.equal(err.cause, "plain string thrown");
				assert.match(err.message, /plain string thrown/);
				return true;
			},
		);
	});
});

describe("encodeCompositePolicyPack", () => {
	it("emits manifest using the historical bindings (pinned addresses) when present", async () => {
		// Curator pinned to chainalysis's PolicyData and CID — manifest should
		// emit the pin, not the values from module.deployments.
		const PINNED_ADDR: Address = "0xCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCc";
		const PINNED_CID = "bafyhistoricalpinned";
		const fake = makeFakeClient({
			onChainPolicyData: [PINNED_ADDR],
			wasmCidsByPolicyData: { [PINNED_ADDR.toLowerCase()]: PINNED_CID },
		});
		const composite = await defineComposite({
			modules: [VAULTSFYI],
			chainId: "11155111",
			env: "stagef",
			// biome-ignore lint/suspicious/noExplicitAny: fake client
			publicClient: fake.client as any,
			policyAddress: POLICY,
			expectedPolicyDataAddresses: [PINNED_ADDR],
			expectedWasmCids: [PINNED_CID],
		});

		const bytes = encodeCompositePolicyPack(composite, { vaultsfyi: {} });
		const manifest = decodeManifest(bytes);
		assert.equal(manifest.modules[0]?.policyDataAddress.toLowerCase(), PINNED_ADDR.toLowerCase());
		assert.equal(manifest.modules[0]?.wasmCid, PINNED_CID);
	});

	it("emits manifest from module.deployments for fresh composites (no pin)", async () => {
		const fake = makeFakeClient({
			onChainPolicyData: [VAULTSFYI_DEPLOYMENT.policyData],
		});
		const composite = await defineComposite({
			modules: [VAULTSFYI],
			chainId: "11155111",
			env: "stagef",
			// biome-ignore lint/suspicious/noExplicitAny: fake client
			publicClient: fake.client as any,
			policyAddress: POLICY,
		});
		const bytes = encodeCompositePolicyPack(composite, { vaultsfyi: {} });
		const manifest = decodeManifest(bytes);
		assert.equal(
			manifest.modules[0]?.policyDataAddress.toLowerCase(),
			VAULTSFYI_DEPLOYMENT.policyData.toLowerCase(),
		);
		assert.equal(manifest.modules[0]?.wasmCid, VAULTSFYI_DEPLOYMENT.wasmCid);
	});
});
