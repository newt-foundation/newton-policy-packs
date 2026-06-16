import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { type Address, getAddress, type Hex } from "viem";
import { z } from "zod";
import { introspectComposite } from "./composite-introspect";
import { encodeCompositeParams, type MinimalCompositePack } from "./composite-manifest";
import type { Deployment, OracleModule } from "./index";

const SHIELD: Address = "0x9999999999999999999999999999999999999999";
const POLICY: Address = "0x8888888888888888888888888888888888888888";
const POLICY_ID: Hex = ("0x" + "ab".repeat(32)) as Hex;

const VAULTSFYI_DEPLOYMENT: Deployment = {
	policy: "0x9EE0B769E62aEEa3282396ee7a4D5B16119De14C",
	policyData: "0x4b1c450b1DA523EdB0C2aB0c905267281d36cb7c",
	wasmCid: "bafyvaultsfyidev",
	policyCodeHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	deployedAt: "2026-06-16",
};

const CHAINALYSIS_DEPLOYMENT: Deployment = {
	policy: "0x1111111111111111111111111111111111111111",
	policyData: "0x2222222222222222222222222222222222222222",
	wasmCid: "bafychainalysisdev",
	policyCodeHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
	deployedAt: "2026-06-16",
};

function makeModule(id: string, deployment: Deployment): OracleModule<unknown, unknown, unknown> {
	return {
		id,
		paramsSchema: z.object({}).passthrough() as z.ZodType<unknown>,
		wasmArgsSchema: z.object({}).passthrough() as z.ZodType<unknown>,
		secretsSchema: z.object({}).passthrough() as z.ZodType<unknown>,
		deployments: { "11155111": { stagef: deployment } },
	};
}

const VAULTSFYI = makeModule("vaultsfyi/risk-envelope/v1", VAULTSFYI_DEPLOYMENT);
const CHAINALYSIS = makeModule("chainalysis/screening/v1", CHAINALYSIS_DEPLOYMENT);

const PACK: MinimalCompositePack = {
	modules: [VAULTSFYI, CHAINALYSIS],
	chainId: "11155111",
	env: "stagef",
};

const PARAMS = {
	"vaultsfyi/risk-envelope/v1": { floor: 80 },
	"chainalysis/screening/v1": { deny_on_sanctioned: true },
};

const MANIFEST_BYTES = encodeCompositeParams(PACK, PARAMS);

const SEPOLIA_MULTICALL3: Address = "0xcA11bde05977b3631167028862bE2a173976CA11";

/**
 * Fake `PublicClient` for unit tests. Routes `readContract` and `multicall` to
 * a hand-rolled fixture map. Spec § "introspectComposite" requires both
 * branches to be exercised.
 */
function makeFakeClient(opts: {
	hasMulticall: boolean;
	policyConfigBytes: Hex;
	onChainPolicyData: ReadonlyArray<Address>;
	wasmCids: ReadonlyArray<string>;
}) {
	const recordedCalls: string[] = [];
	const sepoliaChain = {
		id: 11155111,
		contracts: opts.hasMulticall
			? { multicall3: { address: SEPOLIA_MULTICALL3, blockCreated: 0 } }
			: undefined,
	};

	return {
		recordedCalls,
		client: {
			chain: sepoliaChain,
			async readContract(args: {
				address: Address;
				functionName: string;
				args?: ReadonlyArray<unknown>;
			}) {
				recordedCalls.push(args.functionName);
				switch (args.functionName) {
					case "getPolicyAddress":
						return POLICY;
					case "getPolicyId":
						return POLICY_ID;
					case "getPolicyConfig":
						return {
							policyId: POLICY_ID,
							policyParams: opts.policyConfigBytes,
							expireAfter: 100,
							expireUnit: 0,
						};
					case "getPolicyData":
						return [...opts.onChainPolicyData];
					case "getWasmCid": {
						const idx = opts.onChainPolicyData.findIndex(
							(addr) => getAddress(addr) === getAddress(args.address),
						);
						return opts.wasmCids[idx] ?? "";
					}
					default:
						throw new Error(`unexpected readContract: ${args.functionName}`);
				}
			},
			async multicall(args: {
				contracts: ReadonlyArray<{
					address: Address;
					functionName: string;
				}>;
			}) {
				recordedCalls.push("multicall");
				return Promise.all(
					args.contracts.map(async (c) => {
						switch (c.functionName) {
							case "getPolicyData":
								return [...opts.onChainPolicyData];
							case "getWasmCid": {
								const idx = opts.onChainPolicyData.findIndex(
									(addr) => getAddress(addr) === getAddress(c.address),
								);
								return opts.wasmCids[idx] ?? "";
							}
							default:
								throw new Error(`unexpected multicall: ${c.functionName}`);
						}
					}),
				);
			},
		},
	};
}

describe("introspectComposite — happy path", () => {
	it("multicall branch: returns the manifest + on-chain match", async () => {
		const fake = makeFakeClient({
			hasMulticall: true,
			policyConfigBytes: MANIFEST_BYTES,
			onChainPolicyData: [VAULTSFYI_DEPLOYMENT.policyData, CHAINALYSIS_DEPLOYMENT.policyData],
			wasmCids: [VAULTSFYI_DEPLOYMENT.wasmCid, CHAINALYSIS_DEPLOYMENT.wasmCid],
		});

		const result = await introspectComposite({
			// biome-ignore lint/suspicious/noExplicitAny: fake client; the real type is PublicClient<...>
			publicClient: fake.client as any,
			shieldAddress: SHIELD,
		});

		assert.equal(result.policyAddress, getAddress(POLICY));
		assert.equal(result.policyId, POLICY_ID);
		assert.equal(result.manifest.modules.length, 2);
		assert.equal(result.verification.onChainPolicyDataMatches, true);
		assert.deepEqual(
			result.verification.wasmCidsMatch.map((m) => m.matches),
			[true, true],
		);

		// Multicall path: 1 multicall call, NOT sequential getWasmCid calls.
		assert.equal(fake.recordedCalls.includes("multicall"), true);
		const wasmCidCalls = fake.recordedCalls.filter((c) => c === "getWasmCid").length;
		assert.equal(wasmCidCalls, 0);
	});

	it("sequential-fallback branch: returns the manifest + on-chain match", async () => {
		const fake = makeFakeClient({
			hasMulticall: false,
			policyConfigBytes: MANIFEST_BYTES,
			onChainPolicyData: [VAULTSFYI_DEPLOYMENT.policyData, CHAINALYSIS_DEPLOYMENT.policyData],
			wasmCids: [VAULTSFYI_DEPLOYMENT.wasmCid, CHAINALYSIS_DEPLOYMENT.wasmCid],
		});

		const result = await introspectComposite({
			// biome-ignore lint/suspicious/noExplicitAny: fake client
			publicClient: fake.client as any,
			shieldAddress: SHIELD,
		});

		assert.equal(result.verification.onChainPolicyDataMatches, true);
		assert.deepEqual(
			result.verification.wasmCidsMatch.map((m) => m.matches),
			[true, true],
		);

		// Fallback path: NO multicall, sequential getWasmCid per module.
		assert.equal(fake.recordedCalls.includes("multicall"), false);
		const wasmCidCalls = fake.recordedCalls.filter((c) => c === "getWasmCid").length;
		assert.equal(wasmCidCalls, 2);
	});
});

describe("introspectComposite — verification mismatches", () => {
	it("flags wasmCid mismatch per-module", async () => {
		const fake = makeFakeClient({
			hasMulticall: true,
			policyConfigBytes: MANIFEST_BYTES,
			onChainPolicyData: [VAULTSFYI_DEPLOYMENT.policyData, CHAINALYSIS_DEPLOYMENT.policyData],
			wasmCids: [VAULTSFYI_DEPLOYMENT.wasmCid, "bafyDIFFERENT"],
		});

		const result = await introspectComposite({
			// biome-ignore lint/suspicious/noExplicitAny: fake client
			publicClient: fake.client as any,
			shieldAddress: SHIELD,
		});

		assert.deepEqual(
			result.verification.wasmCidsMatch.map((m) => m.matches),
			[true, false],
		);
		assert.match(result.verification.wasmCidsMatch[1]?.reason ?? "", /bafyDIFFERENT/);
		// Address-side still matches.
		assert.equal(result.verification.onChainPolicyDataMatches, true);
	});

	it("flags policyData ordering mismatch (positional, not set-equal)", async () => {
		// On-chain order: [chainalysis, vaultsfyi] but manifest order:
		// [vaultsfyi, chainalysis]. Set-wise equal but positionally NOT equal.
		const fake = makeFakeClient({
			hasMulticall: true,
			policyConfigBytes: MANIFEST_BYTES,
			onChainPolicyData: [CHAINALYSIS_DEPLOYMENT.policyData, VAULTSFYI_DEPLOYMENT.policyData],
			wasmCids: [CHAINALYSIS_DEPLOYMENT.wasmCid, VAULTSFYI_DEPLOYMENT.wasmCid],
		});

		const result = await introspectComposite({
			// biome-ignore lint/suspicious/noExplicitAny: fake client
			publicClient: fake.client as any,
			shieldAddress: SHIELD,
		});

		assert.equal(result.verification.onChainPolicyDataMatches, false);
	});

	it("flags policyData length mismatch (extra module on-chain)", async () => {
		const fake = makeFakeClient({
			hasMulticall: true,
			policyConfigBytes: MANIFEST_BYTES,
			onChainPolicyData: [
				VAULTSFYI_DEPLOYMENT.policyData,
				CHAINALYSIS_DEPLOYMENT.policyData,
				"0x3333333333333333333333333333333333333333",
			],
			wasmCids: [VAULTSFYI_DEPLOYMENT.wasmCid, CHAINALYSIS_DEPLOYMENT.wasmCid],
		});

		const result = await introspectComposite({
			// biome-ignore lint/suspicious/noExplicitAny: fake client
			publicClient: fake.client as any,
			shieldAddress: SHIELD,
		});

		assert.equal(result.verification.onChainPolicyDataMatches, false);
	});

	it("EIP-55 vs lowercase address normalization both validate as match", async () => {
		// Manifest emits EIP-55; on-chain may return lowercase (depends on the
		// ABI decoder). getAddress(...) normalization on both sides should make
		// them equal regardless.
		const fake = makeFakeClient({
			hasMulticall: true,
			policyConfigBytes: MANIFEST_BYTES,
			onChainPolicyData: [
				VAULTSFYI_DEPLOYMENT.policyData.toLowerCase() as Address,
				CHAINALYSIS_DEPLOYMENT.policyData.toLowerCase() as Address,
			],
			wasmCids: [VAULTSFYI_DEPLOYMENT.wasmCid, CHAINALYSIS_DEPLOYMENT.wasmCid],
		});

		const result = await introspectComposite({
			// biome-ignore lint/suspicious/noExplicitAny: fake client
			publicClient: fake.client as any,
			shieldAddress: SHIELD,
		});

		assert.equal(result.verification.onChainPolicyDataMatches, true);
	});
});
