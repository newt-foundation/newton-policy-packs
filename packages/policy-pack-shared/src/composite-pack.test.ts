import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import type { Address } from "viem";
import { z } from "zod";
import { decodeManifest } from "./composite-manifest";
import {
	ChainMismatchError,
	CompositeBuilderError,
	CompositePrepareQueryError,
	defineComposite,
	encodeCompositePolicyPack,
	PinnedWasmCidMismatchError,
	PolicyDataLengthMismatchError,
	PolicyDataOrderingMismatchError,
	UnknownPackIdError,
} from "./composite-pack";
import type { Deployment, PolicyPack, PrepareQueryArgs, PrepareQueryResult } from "./index";
import { UnsupportedChainError, UnsupportedEnvError } from "./pack";

const SHIELD: Address = "0x9999999999999999999999999999999999999999";
const POLICY: Address = "0x8888888888888888888888888888888888888888";
const SEPOLIA_MULTICALL3: Address = "0xcA11bde05977b3631167028862bE2a173976CA11";

const VAULTSFYI_DEPLOYMENT: Deployment = {
	policy: "0xAaaa000000000000000000000000000000000001",
	policyData: "0x4b1c450b1DA523EdB0C2aB0c905267281d36cb7c",
	wasmCid: "bafyvaultsfyi",
	policyCodeHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	deployedAt: "2026-06-16",
};

const CHAINALYSIS_DEPLOYMENT: Deployment = {
	policy: "0xBbbb000000000000000000000000000000000001",
	policyData: "0x2222222222222222222222222222222222222222",
	wasmCid: "bafychainalysis",
	policyCodeHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
	deployedAt: "2026-06-16",
};

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

	it("throws PolicyDataOrderingMismatchError on positional mismatch", async () => {
		// On-chain order swapped vs the modules array.
		const fake = makeFakeClient({
			onChainPolicyData: [CHAINALYSIS_DEPLOYMENT.policyData, VAULTSFYI_DEPLOYMENT.policyData],
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
				err instanceof PolicyDataOrderingMismatchError && /historical/.test((err as Error).message), // recovery hint surfaced
		);
	});

	it("ordering hint is omitted in the historical-pin path", async () => {
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
				err instanceof PolicyDataOrderingMismatchError &&
				!/historical/.test((err as Error).message),
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
			{ publicClient: fake.client as any, vault: "0xVAULT" },
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
			{ publicClient: fake.client as any, vault: "0xVAULT" },
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
				{ publicClient: fake.client as any, vault: "0xVAULT" },
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
				{ publicClient: fake.client as any, vault: "0xVAULT" },
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
