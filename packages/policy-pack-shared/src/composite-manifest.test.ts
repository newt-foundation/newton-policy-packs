import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { type Hex, hexToBytes, toHex } from "viem";
import { z } from "zod";
import {
	BadManifestMagicError,
	type CompositeManifest,
	CompositeParamsValidationError,
	decodeManifest,
	encodeCompositeParams,
	isCompositeManifest,
	MANIFEST_MAGIC,
	MalformedManifestError,
	ManifestDeploymentMissingError,
	type MinimalCompositePack,
	NotAManifestError,
	NotJsonError,
	UnsupportedManifestVersionError,
} from "./composite-manifest";
import type { Deployment, OracleModule } from "./index";

function jsonHex(value: unknown): Hex {
	return toHex(JSON.stringify(value));
}

const SEPOLIA = "11155111";
const STAGEF: "stagef" = "stagef";

const VAULTSFYI_DEPLOYMENT: Deployment = {
	policyData: "0x4b1c450b1DA523EdB0C2aB0c905267281d36cb7c",
	wasmCid: "bafyvaultsfyidev",
	policyCodeHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	deployedAt: "2026-06-16",
};

const CHAINALYSIS_DEPLOYMENT: Deployment = {
	policyData: "0x2222222222222222222222222222222222222222",
	wasmCid: "bafychainalysisdev",
	policyCodeHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
	deployedAt: "2026-06-16",
};

function makeModule<P, W, S>(
	id: string,
	paramsSchema: z.ZodType<P>,
	wasmArgsSchema: z.ZodType<W>,
	secretsSchema: z.ZodType<S>,
	deployment: Deployment,
): OracleModule<P, W, S> {
	return {
		id,
		paramsSchema,
		wasmArgsSchema,
		secretsSchema,
		deployments: { [SEPOLIA]: { stagef: deployment } },
	};
}

const VAULTSFYI = makeModule(
	"vaultsfyi/risk-envelope/v1",
	z.object({ floor: z.number().int().min(0).max(100) }),
	z.object({ vault: z.string() }),
	z.object({}),
	VAULTSFYI_DEPLOYMENT,
);

const CHAINALYSIS = makeModule(
	"chainalysis/screening/v1",
	z.object({ deny_on_sanctioned: z.boolean() }),
	z.object({ address: z.string() }),
	z.object({ CHAINALYSIS_KEY: z.string() }),
	CHAINALYSIS_DEPLOYMENT,
);

const PACK: MinimalCompositePack = {
	modules: [VAULTSFYI, CHAINALYSIS],
	chainId: SEPOLIA,
	env: STAGEF,
};

describe("isCompositeManifest", () => {
	it("returns true for a valid composite manifest blob", () => {
		const bytes = encodeCompositeParams(PACK, {
			vaultsfyi: { floor: 80 },
			chainalysis: { deny_on_sanctioned: true },
		});
		assert.equal(isCompositeManifest(bytes), true);
	});

	it("returns false for flat single-pack params", () => {
		assert.equal(isCompositeManifest(jsonHex({ floor: 80, deny_on_X: true })), false);
	});

	it("returns false for non-JSON bytes", () => {
		// `0x01020304` decodes as the bytes [0x01, 0x02, 0x03, 0x04] — not valid
		// UTF-8 JSON. isCompositeManifest must NOT throw, just return false.
		assert.equal(isCompositeManifest("0x01020304"), false);
	});

	it("returns false for JSON with wrong magic", () => {
		const blob = jsonHex({ _manifest: { magic: "WRONG", version: 1 }, modules: [], params: {} });
		assert.equal(isCompositeManifest(blob), false);
	});

	it("returns false for JSON with no _manifest key", () => {
		const blob = jsonHex({ modules: [], params: {} });
		assert.equal(isCompositeManifest(blob), false);
	});
});

describe("encodeCompositeParams + decodeManifest round-trip", () => {
	it("round-trips byte-identical for deeply-equal inputs", () => {
		const params1 = {
			vaultsfyi: { floor: 80 },
			chainalysis: { deny_on_sanctioned: true },
		};
		const params2 = {
			// Different insertion order — sorted-key canonicalization should
			// produce byte-identical output.
			chainalysis: { deny_on_sanctioned: true },
			vaultsfyi: { floor: 80 },
		};
		assert.equal(encodeCompositeParams(PACK, params1), encodeCompositeParams(PACK, params2));
	});

	it("decodes encoded bytes back to the typed manifest", () => {
		const bytes = encodeCompositeParams(PACK, {
			vaultsfyi: { floor: 80 },
			chainalysis: { deny_on_sanctioned: true },
		});
		const manifest = decodeManifest(bytes);
		assert.equal(manifest.magic, MANIFEST_MAGIC);
		assert.equal(manifest.version, 1);
		assert.equal(manifest.modules.length, 2);
		assert.equal(manifest.modules[0]?.id, "vaultsfyi/risk-envelope/v1");
		assert.equal(manifest.modules[1]?.id, "chainalysis/screening/v1");
		// EIP-55 normalized via getAddress(...)
		assert.equal(manifest.modules[0]?.policyDataAddress, VAULTSFYI_DEPLOYMENT.policyData);
		// `params` keyed by SHORT pack id (matches data.wasm.<short-id> Phase 0
		// namespacing). modules[].id stays full for traceability.
		assert.deepEqual(manifest.params.vaultsfyi, { floor: 80 });
	});

	it("module ordering matches pack.modules ordering (position-significant)", () => {
		// Reverse the modules order in the pack — manifest emits in pack order.
		const reversedPack: MinimalCompositePack = {
			modules: [CHAINALYSIS, VAULTSFYI],
			chainId: SEPOLIA,
			env: STAGEF,
		};
		const bytes = encodeCompositeParams(reversedPack, {
			chainalysis: { deny_on_sanctioned: true },
			vaultsfyi: { floor: 80 },
		});
		const manifest = decodeManifest(bytes);
		assert.equal(manifest.modules[0]?.id, "chainalysis/screening/v1");
		assert.equal(manifest.modules[1]?.id, "vaultsfyi/risk-envelope/v1");
	});
});

describe("decodeManifest error semantics", () => {
	it("throws NotJsonError on non-UTF-8 bytes", () => {
		// 0xff 0xff is not valid UTF-8.
		assert.throws(
			() => decodeManifest("0xffff"),
			(err: unknown) => err instanceof NotJsonError,
		);
	});

	it("throws NotJsonError on bytes that are valid UTF-8 but not JSON", () => {
		const bytes = toHex(new TextEncoder().encode("not json {{{"));
		assert.throws(
			() => decodeManifest(bytes),
			(err: unknown) => err instanceof NotJsonError,
		);
	});

	it("throws NotAManifestError on flat single-pack params (no _manifest key)", () => {
		const flatParams = { floor: 80, deny_on_X: true };
		const bytes = jsonHex(flatParams);
		assert.throws(
			() => decodeManifest(bytes),
			(err: unknown) => {
				assert.ok(err instanceof NotAManifestError);
				// Recovery hint surface: parsedJson exposes the value so the caller
				// doesn't re-parse.
				assert.deepEqual(err.parsedJson, flatParams);
				return true;
			},
		);
	});

	it("throws NotAManifestError on top-level array", () => {
		const bytes = jsonHex([1, 2, 3]);
		assert.throws(
			() => decodeManifest(bytes),
			(err: unknown) => err instanceof NotAManifestError,
		);
	});

	it("throws BadManifestMagicError on wrong magic value", () => {
		const blob = { _manifest: { magic: "WRONG", version: 1 }, modules: [], params: {} };
		assert.throws(
			() => decodeManifest(jsonHex(blob)),
			(err: unknown) => {
				assert.ok(err instanceof BadManifestMagicError);
				assert.equal(err.actualMagic, "WRONG");
				return true;
			},
		);
	});

	it("throws UnsupportedManifestVersionError on too-new version", () => {
		const blob = {
			_manifest: { magic: MANIFEST_MAGIC, version: 999 },
			modules: [],
			params: {},
		};
		assert.throws(
			() => decodeManifest(jsonHex(blob)),
			(err: unknown) => {
				assert.ok(err instanceof UnsupportedManifestVersionError);
				assert.equal(err.version, 999);
				assert.equal(err.maxSupported, 1);
				return true;
			},
		);
	});

	it("throws MalformedManifestError on negative or non-integer version", () => {
		const blob1 = { _manifest: { magic: MANIFEST_MAGIC, version: 0 }, modules: [], params: {} };
		const blob2 = { _manifest: { magic: MANIFEST_MAGIC, version: 1.5 }, modules: [], params: {} };
		assert.throws(
			() => decodeManifest(jsonHex(blob1)),
			(err: unknown) => err instanceof MalformedManifestError,
		);
		assert.throws(
			() => decodeManifest(jsonHex(blob2)),
			(err: unknown) => err instanceof MalformedManifestError,
		);
	});

	it("throws MalformedManifestError on empty modules array", () => {
		const blob = { _manifest: { magic: MANIFEST_MAGIC, version: 1 }, modules: [], params: {} };
		assert.throws(
			() => decodeManifest(jsonHex(blob)),
			(err: unknown) => err instanceof MalformedManifestError,
		);
	});

	it("throws MalformedManifestError on missing params[id] for a declared module", () => {
		// Strict policy per spec: every module in modules[] MUST have a params entry.
		const blob = {
			_manifest: { magic: MANIFEST_MAGIC, version: 1 },
			modules: [
				{
					id: "vaultsfyi/risk-envelope/v1",
					policyDataAddress: VAULTSFYI_DEPLOYMENT.policyData,
					wasmCid: "bafytest",
				},
			],
			params: {}, // missing "vaultsfyi" (short pack id)
		};
		assert.throws(
			() => decodeManifest(jsonHex(blob)),
			(err: unknown) => err instanceof MalformedManifestError,
		);
	});

	it("throws MalformedManifestError on extra params[id] not declared in modules[]", () => {
		const blob = {
			_manifest: { magic: MANIFEST_MAGIC, version: 1 },
			modules: [
				{
					id: "vaultsfyi/risk-envelope/v1",
					policyDataAddress: VAULTSFYI_DEPLOYMENT.policyData,
					wasmCid: "bafytest",
				},
			],
			params: {
				vaultsfyi: { floor: 80 },
				orphan: { unused: true },
			},
		};
		assert.throws(
			() => decodeManifest(jsonHex(blob)),
			(err: unknown) => err instanceof MalformedManifestError,
		);
	});

	it("throws MalformedManifestError on invalid policyDataAddress", () => {
		const blob = {
			_manifest: { magic: MANIFEST_MAGIC, version: 1 },
			modules: [{ id: "x/y/v1", policyDataAddress: "not-an-address", wasmCid: "bafytest" }],
			params: { x: {} },
		};
		assert.throws(
			() => decodeManifest(jsonHex(blob)),
			(err: unknown) => err instanceof MalformedManifestError,
		);
	});
});

describe("encodeCompositeParams error semantics", () => {
	it("throws CompositeParamsValidationError when params[id] fails schema", () => {
		assert.throws(
			() =>
				encodeCompositeParams(PACK, {
					vaultsfyi: { floor: 999 }, // exceeds max(100)
					chainalysis: { deny_on_sanctioned: true },
				}),
			(err: unknown) => {
				assert.ok(err instanceof CompositeParamsValidationError);
				assert.equal(err.moduleId, "vaultsfyi/risk-envelope/v1");
				assert.ok(err.zodIssues.length > 0);
				return true;
			},
		);
	});

	it("throws CompositeParamsValidationError when params[id] missing for a declared module", () => {
		assert.throws(
			() =>
				encodeCompositeParams(PACK, {
					vaultsfyi: { floor: 80 },
					// "chainalysis" missing
				}),
			(err: unknown) => {
				assert.ok(err instanceof CompositeParamsValidationError);
				assert.equal(err.moduleId, "chainalysis/screening/v1");
				return true;
			},
		);
	});

	it("throws CompositeParamsValidationError on extra params for an undeclared module", () => {
		assert.throws(
			() =>
				encodeCompositeParams(PACK, {
					vaultsfyi: { floor: 80 },
					chainalysis: { deny_on_sanctioned: true },
					orphan: { unused: true },
				}),
			(err: unknown) => err instanceof CompositeParamsValidationError,
		);
	});

	it("throws ManifestDeploymentMissingError on unsupported chain", () => {
		const packOnUnsupportedChain: MinimalCompositePack = {
			modules: [VAULTSFYI],
			chainId: "1", // mainnet — VAULTSFYI only deployed on Sepolia in the fixture
			env: STAGEF,
		};
		assert.throws(
			() =>
				encodeCompositeParams(packOnUnsupportedChain, {
					vaultsfyi: { floor: 80 },
				}),
			(err: unknown) => {
				assert.ok(err instanceof ManifestDeploymentMissingError);
				assert.equal(err.moduleId, "vaultsfyi/risk-envelope/v1");
				assert.equal(err.chainId, "1");
				return true;
			},
		);
	});

	it("throws ManifestDeploymentMissingError on unsupported env", () => {
		const packOnUnsupportedEnv: MinimalCompositePack = {
			modules: [VAULTSFYI],
			chainId: SEPOLIA,
			env: "prod" as const, // VAULTSFYI fixture only has stagef
		};
		assert.throws(
			() =>
				encodeCompositeParams(packOnUnsupportedEnv, {
					vaultsfyi: { floor: 80 },
				}),
			(err: unknown) => err instanceof ManifestDeploymentMissingError,
		);
	});

	it("emits magic = NPM1 and version = 1", () => {
		const bytes = encodeCompositeParams(PACK, {
			vaultsfyi: { floor: 80 },
			chainalysis: { deny_on_sanctioned: true },
		});
		const json = JSON.parse(new TextDecoder().decode(hexToBytes(bytes)));
		assert.equal(json._manifest.magic, "NPM1");
		assert.equal(json._manifest.version, 1);
	});
});

describe("canonical-form encoding", () => {
	it("sorted keys at every level (recursive)", () => {
		const bytes = encodeCompositeParams(PACK, {
			vaultsfyi: { floor: 80 },
			chainalysis: { deny_on_sanctioned: true },
		});
		const json = new TextDecoder().decode(hexToBytes(bytes));
		// Top-level keys must be in alphabetical order: _manifest, modules, params.
		// (Underscore U+005F sorts before lowercase letters.)
		const topLevelKeys = Object.keys(JSON.parse(json));
		assert.deepEqual(topLevelKeys, ["_manifest", "modules", "params"]);
		// Inside modules[*], keys: id, policyDataAddress, wasmCid (alphabetical).
		const m = JSON.parse(json) as { modules: Array<Record<string, unknown>> };
		for (const mod of m.modules) {
			assert.deepEqual(Object.keys(mod), ["id", "policyDataAddress", "wasmCid"]);
		}
	});
});

describe("shortPackIdFromModuleId validation", () => {
	it("derives short id from full module id", async () => {
		const { shortPackIdFromModuleId } = await import("./composite-manifest");
		assert.equal(shortPackIdFromModuleId("vaultsfyi/risk-envelope/v1"), "vaultsfyi");
		assert.equal(shortPackIdFromModuleId("chainalysis/screening/v1"), "chainalysis");
	});

	it("accepts module id without slash (returns it as-is)", async () => {
		const { shortPackIdFromModuleId } = await import("./composite-manifest");
		assert.equal(shortPackIdFromModuleId("balancer"), "balancer");
	});

	it("throws on empty module id", async () => {
		const { shortPackIdFromModuleId } = await import("./composite-manifest");
		assert.throws(
			() => shortPackIdFromModuleId(""),
			(err: unknown) => err instanceof MalformedManifestError,
		);
	});

	it("throws on module id starting with slash (would derive empty short id)", async () => {
		const { shortPackIdFromModuleId } = await import("./composite-manifest");
		assert.throws(
			() => shortPackIdFromModuleId("/foo/bar"),
			(err: unknown) => err instanceof MalformedManifestError,
		);
	});
});

describe("CompositeManifest type assertion", () => {
	it("decoded manifest is structurally a CompositeManifest", () => {
		const bytes = encodeCompositeParams(PACK, {
			vaultsfyi: { floor: 80 },
			chainalysis: { deny_on_sanctioned: true },
		});
		const manifest: CompositeManifest = decodeManifest(bytes);
		// Compile-time check that manifest.modules is iterable + the entries are typed
		const ids = manifest.modules.map((m) => m.id);
		assert.equal(ids.length, 2);
	});
});
