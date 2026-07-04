import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { z } from "zod";
import type { Deployment, PolicyPack } from "./index";
import {
	CustomModuleError,
	type DefineCustomModuleArgs,
	decodeManifest,
	defineCustomModule,
	encodeCompositeParams,
	generateCompositeParamsSchema,
	getDeployment,
	MalformedManifestError,
} from "./index";

const CUSTOM_DEPLOYMENT: Deployment = {
	policyData: "0x4b1c450b1DA523EdB0C2aB0c905267281d36cb7c",
	wasmCid: "bafybeibb4rxzaqaolsqmc7kymnr34a3vj6bo6xfom5cggr4ouyqahlspvu",
	policyCodeHash: "0x5ec04403a9345b012b891ce29b0c291736ef98d1f50901739b563246af05ed29",
	deployedAt: "2026-07-03",
};

const PARAMS_SCHEMA = z.object({ max_ltv_bps: z.number() });
const WASM_ARGS_SCHEMA = z.object({ position: z.string() });
const SECRETS_SCHEMA = z.object({ API_KEY: z.string() });
const PARAMS_JSON_SCHEMA = {
	type: "object",
	properties: { max_ltv_bps: { type: "integer", minimum: 0, maximum: 10000 } },
	required: ["max_ltv_bps"],
};

type Args = DefineCustomModuleArgs<
	z.infer<typeof PARAMS_SCHEMA>,
	z.infer<typeof WASM_ARGS_SCHEMA>,
	z.infer<typeof SECRETS_SCHEMA>
>;

// A realistic bespoke module id (short id `bizantine_ltv` is deliberately NOT
// in KNOWN_PACK_IDS - the whole point of a custom module).
function validArgs(): Args {
	return {
		id: "bizantine_ltv/max-ltv/v1",
		paramsSchema: PARAMS_SCHEMA,
		wasmArgsSchema: WASM_ARGS_SCHEMA,
		secretsSchema: SECRETS_SCHEMA,
		paramsJsonSchema: PARAMS_JSON_SCHEMA,
		deployments: { "8453": { prod: CUSTOM_DEPLOYMENT } },
		metadata: { name: "bizantine_ltv", version: "1.0.0", description: "custom LTV gate" },
	};
}

describe("defineCustomModule", () => {
	it("returns a PolicyPack carrying every field verbatim", () => {
		const pack = defineCustomModule(validArgs());

		assert.equal(pack.id, "bizantine_ltv/max-ltv/v1");
		// Schema + deployments references pass through unchanged (same guarantee
		// oracleModuleFromPack gives): params validated through the module must
		// validate identically to the source schema.
		assert.strictEqual(pack.paramsSchema, PARAMS_SCHEMA);
		assert.strictEqual(pack.wasmArgsSchema, WASM_ARGS_SCHEMA);
		assert.strictEqual(pack.secretsSchema, SECRETS_SCHEMA);
		assert.strictEqual(pack.paramsJsonSchema, PARAMS_JSON_SCHEMA);
		assert.equal(pack.metadata.name, "bizantine_ltv");
	});

	it("output satisfies getDeployment", () => {
		const pack = defineCustomModule(validArgs());
		const dep = getDeployment(pack, "8453", "prod");
		assert.equal(dep.policyData, CUSTOM_DEPLOYMENT.policyData);
	});

	it("output composes: generateCompositeParamsSchema accepts it", () => {
		// The load-bearing composability proof - the module must survive the exact
		// gate defineComposite runs. `params.<shortId>` present + required.
		const pack = defineCustomModule(validArgs());
		const schema = generateCompositeParamsSchema({ modules: [pack] }) as {
			properties: { params: { properties: Record<string, unknown>; required: string[] } };
		};
		assert.ok(schema.properties.params.properties["bizantine_ltv"]);
		assert.deepEqual(schema.properties.params.required, ["bizantine_ltv"]);
	});

	it("output composes: encodeCompositeParams round-trips through decodeManifest", () => {
		const pack = defineCustomModule(validArgs());
		const bytes = encodeCompositeParams(
			{ modules: [pack], chainId: "8453", env: "prod" },
			{ bizantine_ltv: { max_ltv_bps: 5000 } },
		);
		const manifest = decodeManifest(bytes);
		assert.equal(manifest.modules.length, 1);
		assert.equal(manifest.modules[0]?.id, "bizantine_ltv/max-ltv/v1");
		assert.equal(manifest.modules[0]?.policyDataAddress, CUSTOM_DEPLOYMENT.policyData);
		assert.deepEqual(manifest.params["bizantine_ltv"], { max_ltv_bps: 5000 });
	});

	it("rejects a regorus-hostile paramsJsonSchema at construction (fail early)", () => {
		// `format` is not in REGORUS_SCHEMA_KEYWORDS: it passes opa test and zod but
		// fails-closed at the AVS. The helper surfaces the SAME MalformedManifestError
		// the composite path would throw - now, not deep in defineComposite.
		const args = {
			...validArgs(),
			paramsJsonSchema: {
				type: "object",
				properties: { owner: { type: "string", format: "address" } },
				required: ["owner"],
			},
		};
		assert.throws(
			() => defineCustomModule(args),
			(err: unknown) => {
				assert.ok(err instanceof MalformedManifestError);
				assert.match(err.message, /format/);
				return true;
			},
		);
	});

	it("rejects a missing paramsJsonSchema with CustomModuleError", () => {
		const args = { ...validArgs(), paramsJsonSchema: undefined } as unknown as Args;
		assert.throws(
			() => defineCustomModule(args),
			(err: unknown) => {
				assert.ok(err instanceof CustomModuleError);
				assert.match(err.message, /paramsJsonSchema/);
				return true;
			},
		);
	});

	it("rejects an id whose short form collides with a published pack", () => {
		// `vaultsfyi/custom/v1` derives short id `vaultsfyi`, a KNOWN_PACK_ID. A
		// custom module claiming it would silently hijack the published pack's
		// data.params.vaultsfyi / data.wasm.vaultsfyi namespace.
		const args = { ...validArgs(), id: "vaultsfyi/custom/v1" };
		assert.throws(
			() => defineCustomModule(args),
			(err: unknown) => {
				assert.ok(err instanceof CustomModuleError);
				assert.match(err.message, /vaultsfyi/);
				return true;
			},
		);
	});

	it("rejects an empty id with CustomModuleError", () => {
		const args = { ...validArgs(), id: "" };
		assert.throws(
			() => defineCustomModule(args),
			(err: unknown) => {
				assert.ok(err instanceof CustomModuleError);
				return true;
			},
		);
	});

	it("rejects an id with a leading slash with CustomModuleError", () => {
		const args = { ...validArgs(), id: "/max-ltv/v1" };
		assert.throws(
			() => defineCustomModule(args),
			(err: unknown) => {
				assert.ok(err instanceof CustomModuleError);
				return true;
			},
		);
	});

	it("rejects a missing zod schema with CustomModuleError", () => {
		const args = { ...validArgs(), paramsSchema: undefined } as unknown as Args;
		assert.throws(
			() => defineCustomModule(args),
			(err: unknown) => {
				assert.ok(err instanceof CustomModuleError);
				assert.match(err.message, /paramsSchema/);
				return true;
			},
		);
	});

	it("rejects an array paramsJsonSchema with CustomModuleError", () => {
		// `typeof [] === "object"`, so a bare object check lets an array through.
		// generateCompositeParamsSchema then inlines it as the module's inner
		// schema and an empty array trips no keyword, so the malformed envelope
		// would only fail downstream at attestation time - the exact fail-late the
		// helper exists to prevent.
		const args = { ...validArgs(), paramsJsonSchema: [] } as unknown as Args;
		assert.throws(
			() => defineCustomModule(args),
			(err: unknown) => {
				assert.ok(err instanceof CustomModuleError);
				assert.match(err.message, /paramsJsonSchema/);
				return true;
			},
		);
	});

	it("rejects a missing deployments map with CustomModuleError", () => {
		const args = { ...validArgs(), deployments: undefined } as unknown as Args;
		assert.throws(
			() => defineCustomModule(args),
			(err: unknown) => {
				assert.ok(err instanceof CustomModuleError);
				assert.match(err.message, /deployments/);
				return true;
			},
		);
	});

	it("rejects an array deployments with CustomModuleError", () => {
		const args = { ...validArgs(), deployments: [] } as unknown as Args;
		assert.throws(
			() => defineCustomModule(args),
			(err: unknown) => {
				assert.ok(err instanceof CustomModuleError);
				assert.match(err.message, /deployments/);
				return true;
			},
		);
	});

	it("accepts an empty deployments map (defined before deployed)", () => {
		// A module may be constructed before any (chainId, env) cell is deployed;
		// getDeployment / encodeCompositeParams already throw clearly at use time,
		// so an empty map is valid at construction - don't over-tighten.
		const pack = defineCustomModule({ ...validArgs(), deployments: {} });
		assert.deepEqual(pack.deployments, {});
	});

	it("rejects a missing metadata with CustomModuleError", () => {
		const args = { ...validArgs(), metadata: undefined } as unknown as Args;
		assert.throws(
			() => defineCustomModule(args),
			(err: unknown) => {
				assert.ok(err instanceof CustomModuleError);
				assert.match(err.message, /metadata/);
				return true;
			},
		);
	});

	it("passes prepareQuery through when provided", () => {
		const prepareQuery = async () => ({ wasmArgs: { position: "0xPOS" } });
		const pack = defineCustomModule({ ...validArgs(), prepareQuery });
		assert.strictEqual(pack.prepareQuery, prepareQuery);
	});

	it("omits prepareQuery entirely when not provided", () => {
		const pack = defineCustomModule(validArgs());
		assert.equal("prepareQuery" in pack, false);
	});

	it("preserves type parameters end-to-end", () => {
		const pack: PolicyPack<
			z.infer<typeof PARAMS_SCHEMA>,
			z.infer<typeof WASM_ARGS_SCHEMA>,
			z.infer<typeof SECRETS_SCHEMA>
		> = defineCustomModule(validArgs());
		const parsed = pack.paramsSchema.parse({ max_ltv_bps: 5000 });
		assert.equal(parsed.max_ltv_bps, 5000);
		assert.throws(() => pack.paramsSchema.parse({ max_ltv_bps: "wrong" }));
	});

	// --- Short-id grammar (blocker 1): the short id is used as a Rego dot-path
	// segment (data.params.<shortId>) and a manifest key. It MUST match
	// ^[a-z][a-z0-9_]*$ - hyphens, dots, spaces, uppercase, leading digits, and
	// prototype keys all break Rego dot-notation or corrupt the envelope.
	it("rejects a hyphenated short id (breaks Rego dot notation)", () => {
		// `data.params.bizantine-ltv` parses in Rego as subtraction, not key access.
		const args = { ...validArgs(), id: "bizantine-ltv/max-ltv/v1" };
		assert.throws(
			() => defineCustomModule(args),
			(err: unknown) => {
				assert.ok(err instanceof CustomModuleError);
				assert.match(err.message, /short pack id|bizantine-ltv/);
				return true;
			},
		);
	});

	it("rejects a `__proto__` short id (corrupts the composite envelope)", () => {
		// `paramsProperties["__proto__"] = schema` sets the prototype, not an own
		// key, so the envelope requires a property it never defines -> fail-closed.
		const args = { ...validArgs(), id: "__proto__/x/v1" };
		assert.throws(
			() => defineCustomModule(args),
			(err: unknown) => {
				assert.ok(err instanceof CustomModuleError);
				return true;
			},
		);
	});

	it("rejects an uppercase / space / leading-digit short id", () => {
		for (const id of ["MyOracle/x/v1", "my oracle/x/v1", "1oracle/x/v1", "a.b/x/v1"]) {
			assert.throws(
				() => defineCustomModule({ ...validArgs(), id }),
				(err: unknown) => {
					assert.ok(err instanceof CustomModuleError, `expected throw for id "${id}"`);
					return true;
				},
			);
		}
	});

	it("accepts a snake_case / lowercase-alnum short id", () => {
		for (const id of ["bizantine_ltv/x/v1", "myoracle/x/v1", "oracle2/x/v1"]) {
			const pack = defineCustomModule({ ...validArgs(), id });
			assert.equal(pack.id, id);
		}
	});

	// --- Schema reconciliation (blocker 2): paramsSchema (zod, SDK enforcement)
	// and paramsJsonSchema (inlined into the on-chain pinned envelope) are two
	// independent inputs. A custom author hand-writes both; if their field sets
	// disagree, SDK-valid params can be denied fail-closed at the AVS, or the
	// on-chain schema misrepresents what is enforced. The helper reconciles the
	// property key sets when paramsSchema is a ZodObject.
	it("rejects a paramsSchema / paramsJsonSchema field-set mismatch", () => {
		// zod knows { max_ltv_bps }; jsonSchema pins a different field.
		const args = {
			...validArgs(),
			paramsJsonSchema: {
				type: "object",
				properties: { min_health_factor: { type: "integer" } },
				required: ["min_health_factor"],
			},
		};
		assert.throws(
			() => defineCustomModule(args),
			(err: unknown) => {
				assert.ok(err instanceof CustomModuleError);
				assert.match(err.message, /paramsSchema|paramsJsonSchema|min_health_factor|max_ltv_bps/);
				return true;
			},
		);
	});

	it("accepts an optional zod field absent from jsonSchema required (not a mismatch)", () => {
		// An optional zod field is in .shape but need not be in jsonSchema.required.
		// Parity is on the PROPERTY set, not the required set - don't over-reject.
		const paramsSchema = z.object({ max_ltv_bps: z.number(), note: z.string().optional() });
		const paramsJsonSchema = {
			type: "object",
			properties: { max_ltv_bps: { type: "integer" }, note: { type: "string" } },
			required: ["max_ltv_bps"],
		};
		const pack = defineCustomModule({
			...validArgs(),
			paramsSchema,
			paramsJsonSchema,
		} as unknown as Args);
		assert.ok(pack);
	});

	it("skips the parity check for a non-object zod paramsSchema (opaque)", () => {
		// A z.record / z.union has no .shape to compare; the check is best-effort
		// and must not throw just because it can't introspect the schema.
		const paramsSchema = z.record(z.number());
		const paramsJsonSchema = { type: "object", properties: { anyKey: { type: "integer" } } };
		const pack = defineCustomModule({
			...validArgs(),
			paramsSchema,
			paramsJsonSchema,
		} as unknown as Args);
		assert.ok(pack);
	});

	// --- Metadata content (minor): the message promises { name, version,
	// description }; enforce it rather than only checking typeof === object.
	it("rejects metadata missing name/version/description", () => {
		const args = { ...validArgs(), metadata: {} } as unknown as Args;
		assert.throws(
			() => defineCustomModule(args),
			(err: unknown) => {
				assert.ok(err instanceof CustomModuleError);
				assert.match(err.message, /metadata|name|version|description/);
				return true;
			},
		);
	});
});
