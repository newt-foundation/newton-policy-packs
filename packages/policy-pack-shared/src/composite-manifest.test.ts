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
	generateCompositeParamsSchema,
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
	paramsJsonSchema: object,
): OracleModule<P, W, S> {
	return {
		id,
		paramsSchema,
		wasmArgsSchema,
		secretsSchema,
		paramsJsonSchema,
		deployments: { [SEPOLIA]: { stagef: deployment } },
	};
}

// Raw inner params JSON Schemas — regorus-clean (type/properties/required only).
// These mirror what `scripts/generate-bindings.ts` emits as `ParamsJsonSchema`
// from each pack's `params_schema.json`; the round-trip test below inlines them.
const VAULTSFYI_PARAMS_JSON_SCHEMA = {
	type: "object",
	properties: { floor: { type: "integer", minimum: 0, maximum: 100 } },
	required: ["floor"],
};

const CHAINALYSIS_PARAMS_JSON_SCHEMA = {
	type: "object",
	properties: { deny_on_sanctioned: { type: "boolean" } },
	required: ["deny_on_sanctioned"],
};

const VAULTSFYI = makeModule(
	"vaultsfyi/risk-envelope/v1",
	z.object({ floor: z.number().int().min(0).max(100) }),
	z.object({ vault: z.string() }),
	z.object({}),
	VAULTSFYI_DEPLOYMENT,
	VAULTSFYI_PARAMS_JSON_SCHEMA,
);

const CHAINALYSIS = makeModule(
	"chainalysis/screening/v1",
	z.object({ deny_on_sanctioned: z.boolean() }),
	z.object({ address: z.string() }),
	z.object({ CHAINALYSIS_KEY: z.string() }),
	CHAINALYSIS_DEPLOYMENT,
	CHAINALYSIS_PARAMS_JSON_SCHEMA,
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

describe("generateCompositeParamsSchema", () => {
	// The load-bearing invariant: the schema this generator emits must describe
	// the EXACT on-chain bytes `encodeCompositeParams` writes (the manifest
	// envelope), because the AVS validates the raw blob against the pinned
	// schema without unwrapping `_manifest`. We can't run regorus here, so we
	// parse the real encoded bytes and assert the schema's structure matches
	// the envelope key-for-key.

	it("envelope schema's required keys + properties match the encoded manifest", () => {
		const bytes = encodeCompositeParams(PACK, {
			vaultsfyi: { floor: 80 },
			chainalysis: { deny_on_sanctioned: true },
		});
		const manifest = JSON.parse(new TextDecoder().decode(hexToBytes(bytes))) as Record<
			string,
			unknown
		>;
		const schema = generateCompositeParamsSchema(PACK) as {
			type: string;
			additionalProperties: boolean;
			required: string[];
			properties: Record<string, Record<string, unknown>>;
		};

		assert.equal(schema.type, "object");
		assert.equal(schema.additionalProperties, false);
		// Root required keys exactly match the manifest's top-level keys.
		assert.deepEqual([...schema.required].sort(), ["_manifest", "modules", "params"]);
		assert.deepEqual(Object.keys(manifest).sort(), ["_manifest", "modules", "params"]);

		// _manifest.magic is pinned via const to NPM1 — matches the on-chain value.
		const manifestSchema = schema.properties._manifest as {
			required: string[];
			properties: { magic: { const: string }; version: Record<string, unknown> };
		};
		assert.deepEqual([...manifestSchema.required].sort(), ["magic", "version"]);
		assert.equal(manifestSchema.properties.magic.const, MANIFEST_MAGIC);
		assert.equal((manifest._manifest as { magic: string }).magic, MANIFEST_MAGIC);
	});

	it("params.required + params.properties match the short ids, inlining each inner schema", () => {
		const bytes = encodeCompositeParams(PACK, {
			vaultsfyi: { floor: 80 },
			chainalysis: { deny_on_sanctioned: true },
		});
		const manifest = JSON.parse(new TextDecoder().decode(hexToBytes(bytes))) as {
			params: Record<string, unknown>;
		};
		const schema = generateCompositeParamsSchema(PACK) as {
			properties: {
				params: {
					additionalProperties: boolean;
					required: string[];
					properties: Record<string, object>;
				};
			};
		};
		const paramsSchema = schema.properties.params;

		// params.required is exactly the short ids the encoder keyed params by.
		const shortIds = ["chainalysis", "vaultsfyi"];
		assert.deepEqual([...paramsSchema.required].sort(), shortIds);
		assert.deepEqual(Object.keys(manifest.params).sort(), shortIds);
		assert.equal(paramsSchema.additionalProperties, false);

		// Each params.properties.<shortId> deep-equals the module's inner schema
		// CLOSED — `generateCompositeParamsSchema` adds `additionalProperties:
		// false` to every object node so the on-chain schema rejects unknown keys
		// exactly like the SDK's `.strict()` zod (regorus fail-opens otherwise).
		assert.deepEqual(paramsSchema.properties.vaultsfyi, {
			...VAULTSFYI_PARAMS_JSON_SCHEMA,
			additionalProperties: false,
		});
		assert.deepEqual(paramsSchema.properties.chainalysis, {
			...CHAINALYSIS_PARAMS_JSON_SCHEMA,
			additionalProperties: false,
		});
	});

	it("closes every inlined object node with additionalProperties:false (regorus fail-open guard)", () => {
		// A nested-object inner schema: regorus would accept unknown keys at BOTH
		// the outer and the inner object if `additionalProperties` were absent.
		const nestedModule = makeModule(
			"nested/params/v1",
			z.object({ limits: z.object({ max: z.number() }) }),
			z.object({ x: z.string() }),
			z.object({}),
			VAULTSFYI_DEPLOYMENT,
			{
				type: "object",
				properties: {
					limits: {
						type: "object",
						properties: { max: { type: "number" } },
						required: ["max"],
					},
				},
				required: ["limits"],
			},
		);
		const schema = generateCompositeParamsSchema({ modules: [nestedModule] }) as {
			properties: { params: { properties: Record<string, Record<string, unknown>> } };
		};
		const inner = schema.properties.params.properties.nested as {
			additionalProperties: boolean;
			properties: { limits: { additionalProperties: boolean } };
		};
		// Both the outer object and the nested `limits` object are closed.
		assert.equal(inner.additionalProperties, false);
		assert.equal(inner.properties.limits.additionalProperties, false);
	});

	it("does not clobber an explicit additionalProperties on a source schema", () => {
		// An author who deliberately set `additionalProperties: true` (open object)
		// keeps it — the generator only FILLS an absent value, never overrides.
		const openModule = makeModule(
			"open/params/v1",
			z.object({}).passthrough(),
			z.object({ x: z.string() }),
			z.object({}),
			VAULTSFYI_DEPLOYMENT,
			{ type: "object", additionalProperties: true, properties: {} },
		);
		const schema = generateCompositeParamsSchema({ modules: [openModule] }) as {
			properties: { params: { properties: { open: Record<string, unknown> } } };
		};
		assert.equal(schema.properties.params.properties.open.additionalProperties, true);
	});

	it("throws MalformedManifestError on a module without paramsJsonSchema", () => {
		// paramsJsonSchema is optional on the public interfaces (Finding E). A
		// module that omits it can't be composited — the generator must say so
		// loudly, not emit a half-formed schema.
		const noSchemaModule = {
			id: "noschema/params/v1",
			paramsSchema: z.object({}),
			wasmArgsSchema: z.object({}),
			secretsSchema: z.object({}),
			deployments: { [SEPOLIA]: { stagef: VAULTSFYI_DEPLOYMENT } },
		} as OracleModule<unknown, unknown, unknown>;
		assert.throws(
			() => generateCompositeParamsSchema({ modules: [noSchemaModule] }),
			(err: unknown) =>
				err instanceof MalformedManifestError && /noschema\/params\/v1/.test(err.message),
		);
	});

	it("inlined inner schema is a clone, not an alias of the source constant", () => {
		const schema = generateCompositeParamsSchema(PACK) as {
			properties: { params: { properties: Record<string, object> } };
		};
		// Deep-equal (modulo the added `additionalProperties: false`) but not
		// reference-equal — mutating the result can't corrupt a pack's exported
		// `ParamsJsonSchema` constant.
		assert.deepEqual(schema.properties.params.properties.vaultsfyi, {
			...VAULTSFYI_PARAMS_JSON_SCHEMA,
			additionalProperties: false,
		});
		assert.notStrictEqual(
			schema.properties.params.properties.vaultsfyi,
			VAULTSFYI_PARAMS_JSON_SCHEMA,
		);
		// The source constant itself is untouched — no `additionalProperties` leaked
		// back onto it (proves we close the CLONE, not the original).
		assert.equal(
			(VAULTSFYI_PARAMS_JSON_SCHEMA as Record<string, unknown>).additionalProperties,
			undefined,
		);
	});

	it("works for a single-module composite", () => {
		const singlePack: MinimalCompositePack = {
			modules: [VAULTSFYI],
			chainId: SEPOLIA,
			env: STAGEF,
		};
		const bytes = encodeCompositeParams(singlePack, { vaultsfyi: { floor: 80 } });
		const manifest = JSON.parse(new TextDecoder().decode(hexToBytes(bytes))) as {
			params: Record<string, unknown>;
		};
		const schema = generateCompositeParamsSchema(singlePack) as {
			properties: { params: { required: string[]; properties: Record<string, object> } };
		};
		assert.deepEqual(schema.properties.params.required, ["vaultsfyi"]);
		assert.deepEqual(Object.keys(manifest.params), ["vaultsfyi"]);
		assert.deepEqual(schema.properties.params.properties.vaultsfyi, {
			...VAULTSFYI_PARAMS_JSON_SCHEMA,
			additionalProperties: false,
		});
	});

	it("emits no $ref and no $schema anywhere (regorus has neither)", () => {
		const serialized = JSON.stringify(generateCompositeParamsSchema(PACK));
		assert.equal(serialized.includes("$ref"), false);
		assert.equal(serialized.includes("$schema"), false);
	});

	it("throws on an empty modules list", () => {
		const emptyPack = { modules: [] as ReadonlyArray<OracleModule<unknown, unknown, unknown>> };
		assert.throws(
			() => generateCompositeParamsSchema(emptyPack),
			(err: unknown) => err instanceof MalformedManifestError,
		);
	});

	// --- regorus keyword guard (Finding F) ---
	// newton-rego's Schema deserializer uses `deny_unknown_fields`, so a JSON
	// Schema keyword it doesn't model makes the WHOLE composite schema fail to
	// parse at attestation time — a fail-closed prod outage that `opa test` and
	// the SDK's zod both wave through. The generator must reject such a keyword
	// at generation, naming the offending path.

	it("rejects a module schema using $ref (regorus has no $ref)", () => {
		const refModule = makeModule(
			"badref/params/v1",
			z.object({}),
			z.object({ x: z.string() }),
			z.object({}),
			VAULTSFYI_DEPLOYMENT,
			{ type: "object", properties: { floor: { $ref: "#/definitions/Floor" } } },
		);
		assert.throws(
			() => generateCompositeParamsSchema({ modules: [refModule] }),
			(err: unknown) =>
				err instanceof MalformedManifestError &&
				err.message.includes("$ref") &&
				err.message.includes("badref"),
		);
	});

	it("rejects a module schema using `format` (regorus does not model it)", () => {
		const fmtModule = makeModule(
			"badfmt/params/v1",
			z.object({}),
			z.object({ x: z.string() }),
			z.object({}),
			VAULTSFYI_DEPLOYMENT,
			{ type: "object", properties: { when: { type: "string", format: "date-time" } } },
		);
		assert.throws(
			() => generateCompositeParamsSchema({ modules: [fmtModule] }),
			(err: unknown) => err instanceof MalformedManifestError && err.message.includes("format"),
		);
	});

	it("rejects `oneOf` / `patternProperties` (regorus models neither)", () => {
		for (const badKeyword of [
			{ oneOf: [{ type: "string" }, { type: "number" }] },
			{ patternProperties: { "^x": { type: "string" } } },
		]) {
			const mod = makeModule(
				"badkw/params/v1",
				z.object({}),
				z.object({ x: z.string() }),
				z.object({}),
				VAULTSFYI_DEPLOYMENT,
				{ type: "object", properties: {}, ...badKeyword },
			);
			assert.throws(
				() => generateCompositeParamsSchema({ modules: [mod] }),
				(err: unknown) => err instanceof MalformedManifestError,
			);
		}
	});

	it("accepts the real shipped pack keywords (description/items/min/max/enum)", () => {
		// Exercises every keyword the 9 shipped source schemas actually use, plus
		// enum, so the guard can't false-reject a valid composite.
		const richModule = makeModule(
			"rich/params/v1",
			z.object({}),
			z.object({ x: z.string() }),
			z.object({}),
			VAULTSFYI_DEPLOYMENT,
			{
				type: "object",
				description: "rich",
				properties: {
					floor: { type: "integer", minimum: 0, maximum: 100, description: "a bound" },
					tags: { type: "array", items: { type: "string" } },
					mode: { type: "string", enum: ["a", "b"] },
				},
				required: ["floor"],
			},
		);
		// Does not throw.
		const schema = generateCompositeParamsSchema({ modules: [richModule] });
		assert.ok(schema);
	});
});
