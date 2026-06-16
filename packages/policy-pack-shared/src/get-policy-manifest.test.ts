import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { type Address, type Hex, toHex } from "viem";
import { z } from "zod";
import {
	BadManifestMagicError,
	encodeCompositeParams,
	MANIFEST_MAGIC,
	type MinimalCompositePack,
	NotJsonError,
} from "./composite-manifest";
import { getPolicyManifest, SinglePackParamsValidationError } from "./get-policy-manifest";
import type { Deployment, OracleModule } from "./index";

const SHIELD: Address = "0x9999999999999999999999999999999999999999";
const POLICY: Address = "0x8888888888888888888888888888888888888888";
const POLICY_ID: Hex = ("0x" + "ab".repeat(32)) as Hex;

const DEPLOYMENT: Deployment = {
	policyData: "0x4b1c450b1DA523EdB0C2aB0c905267281d36cb7c",
	wasmCid: "bafytest",
	policyCodeHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	deployedAt: "2026-06-16",
};

const VAULTSFYI_MODULE: OracleModule<unknown, unknown, unknown> = {
	id: "vaultsfyi/risk-envelope/v1",
	paramsSchema: z.object({}).passthrough() as z.ZodType<unknown>,
	wasmArgsSchema: z.object({}).passthrough() as z.ZodType<unknown>,
	secretsSchema: z.object({}).passthrough() as z.ZodType<unknown>,
	deployments: { "11155111": { stagef: DEPLOYMENT } },
};

const PACK: MinimalCompositePack = {
	modules: [VAULTSFYI_MODULE],
	chainId: "11155111",
	env: "stagef",
};

const COMPOSITE_BYTES = encodeCompositeParams(PACK, { vaultsfyi: { floor: 80 } });
const SINGLE_PACK_BYTES = toHex(JSON.stringify({ floor: 80, deny_on_X: true }));
const NON_JSON_BYTES: Hex = "0xffff"; // invalid UTF-8

function makeFakeClient(policyParams: Hex) {
	return {
		async readContract(args: { functionName: string }) {
			switch (args.functionName) {
				case "getPolicyAddress":
					return POLICY;
				case "getPolicyId":
					return POLICY_ID;
				case "getPolicyConfig":
					return {
						policyId: POLICY_ID,
						policyParams,
						expireAfter: 100,
						expireUnit: 0,
					};
				default:
					throw new Error(`unexpected: ${args.functionName}`);
			}
		},
	};
}

describe("getPolicyManifest", () => {
	it("dispatches composite bytes to the composite branch", async () => {
		const client = makeFakeClient(COMPOSITE_BYTES);
		const result = await getPolicyManifest({
			// biome-ignore lint/suspicious/noExplicitAny: fake client
			publicClient: client as any,
			shieldAddress: SHIELD,
		});
		assert.equal(result.kind, "composite");
		if (result.kind === "composite") {
			assert.equal(result.manifest.magic, MANIFEST_MAGIC);
			assert.equal(result.manifest.modules.length, 1);
		}
	});

	it("dispatches single-pack bytes (no manifest) to the single-pack branch", async () => {
		const client = makeFakeClient(SINGLE_PACK_BYTES);
		const result = await getPolicyManifest({
			// biome-ignore lint/suspicious/noExplicitAny: fake client
			publicClient: client as any,
			shieldAddress: SHIELD,
		});
		assert.equal(result.kind, "single-pack");
		if (result.kind === "single-pack") {
			assert.deepEqual(result.params, { floor: 80, deny_on_X: true });
		}
	});

	it("validates single-pack params against the optional paramsSchema", async () => {
		const client = makeFakeClient(SINGLE_PACK_BYTES);
		const schema = z.object({ floor: z.number(), deny_on_X: z.boolean() });
		const result = await getPolicyManifest({
			// biome-ignore lint/suspicious/noExplicitAny: fake client
			publicClient: client as any,
			shieldAddress: SHIELD,
			singlePackPack: { paramsSchema: schema as z.ZodType<unknown> },
		});
		assert.equal(result.kind, "single-pack");
	});

	it("throws SinglePackParamsValidationError when single-pack params fail the schema", async () => {
		const client = makeFakeClient(SINGLE_PACK_BYTES);
		const tooStrictSchema = z.object({ entirely_different_field: z.string() });
		await assert.rejects(
			getPolicyManifest({
				// biome-ignore lint/suspicious/noExplicitAny: fake client
				publicClient: client as any,
				shieldAddress: SHIELD,
				singlePackPack: { paramsSchema: tooStrictSchema as z.ZodType<unknown> },
			}),
			(err: unknown) => {
				if (!(err instanceof SinglePackParamsValidationError)) return false;
				assert.deepEqual(err.parsedJson, { floor: 80, deny_on_X: true });
				assert.ok(err.zodIssues.length > 0);
				return true;
			},
		);
	});

	it("throws NotJsonError on non-UTF-8 / non-JSON bytes", async () => {
		const client = makeFakeClient(NON_JSON_BYTES);
		await assert.rejects(
			getPolicyManifest({
				// biome-ignore lint/suspicious/noExplicitAny: fake client
				publicClient: client as any,
				shieldAddress: SHIELD,
			}),
			(err: unknown) => err instanceof NotJsonError,
		);
	});

	it("throws BadManifestMagicError on bytes that look composite-shaped but use the wrong magic", async () => {
		const wrongMagic = toHex(
			JSON.stringify({
				_manifest: { magic: "WRONG", version: 1 },
				modules: [
					{ id: "vaultsfyi/v1", policyDataAddress: DEPLOYMENT.policyData, wasmCid: "bafy" },
				],
				params: { vaultsfyi: {} },
			}),
		);
		const client = makeFakeClient(wrongMagic);
		await assert.rejects(
			getPolicyManifest({
				// biome-ignore lint/suspicious/noExplicitAny: fake client
				publicClient: client as any,
				shieldAddress: SHIELD,
			}),
			(err: unknown) => err instanceof BadManifestMagicError,
		);
	});

	it("propagates Phase 1.5 typed errors for malformed-but-composite-shaped bytes", async () => {
		// _manifest.magic is correct but modules is empty — composite-shaped
		// but malformed. decodeManifest throws MalformedManifestError; we
		// want that to propagate, NOT silently fall through to single-pack.
		const malformedComposite = toHex(
			JSON.stringify({
				_manifest: { magic: MANIFEST_MAGIC, version: 1 },
				modules: [], // empty — malformed
				params: {},
			}),
		);
		const client = makeFakeClient(malformedComposite);
		await assert.rejects(
			getPolicyManifest({
				// biome-ignore lint/suspicious/noExplicitAny: fake client
				publicClient: client as any,
				shieldAddress: SHIELD,
			}),
			(err: unknown) => err instanceof Error && err.name === "MalformedManifestError",
		);
	});
});
