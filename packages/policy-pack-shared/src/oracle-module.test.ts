import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { z } from "zod";
import type { Deployment, GatewayEnv, PolicyPack } from "./index";
import { oracleModuleFromPack } from "./index";

const STAGEF_DEPLOYMENT: Deployment = {
	policy: "0x9EE0B769E62aEEa3282396ee7a4D5B16119De14C",
	policyData: "0x4b1c450b1DA523EdB0C2aB0c905267281d36cb7c",
	wasmCid: "bafybeibb4rxzaqaolsqmc7kymnr34a3vj6bo6xfom5cggr4ouyqahlspvu",
	policyCodeHash: "0x5ec04403a9345b012b891ce29b0c291736ef98d1f50901739b563246af05ed29",
	deployedAt: "2026-06-16",
};

const PARAMS_SCHEMA = z.object({ floor: z.number() });
const WASM_ARGS_SCHEMA = z.object({ vault: z.string() });
const SECRETS_SCHEMA = z.object({ API_KEY: z.string() });

function makePack(): PolicyPack<
	z.infer<typeof PARAMS_SCHEMA>,
	z.infer<typeof WASM_ARGS_SCHEMA>,
	z.infer<typeof SECRETS_SCHEMA>
> {
	const deployments: Readonly<
		Partial<Record<string, Readonly<Partial<Record<GatewayEnv, Deployment>>>>>
	> = {
		"11155111": { stagef: STAGEF_DEPLOYMENT },
	};
	return {
		id: "balancer/risk-envelope/v1",
		paramsSchema: PARAMS_SCHEMA,
		wasmArgsSchema: WASM_ARGS_SCHEMA,
		secretsSchema: SECRETS_SCHEMA,
		deployments,
		metadata: {
			name: "balancer",
			version: "0.0.0",
			description: "test fixture",
			author: "Test",
			link: "https://example.com",
		},
		async prepareQuery() {
			return { wasmArgs: { vault: "0xVAULT" } };
		},
	};
}

describe("oracleModuleFromPack", () => {
	it("projects the five composite-relevant fields verbatim", () => {
		const pack = makePack();
		const module = oracleModuleFromPack(pack);

		assert.equal(module.id, pack.id);
		assert.equal(module.paramsSchema, pack.paramsSchema);
		assert.equal(module.wasmArgsSchema, pack.wasmArgsSchema);
		assert.equal(module.secretsSchema, pack.secretsSchema);
		assert.equal(module.deployments, pack.deployments);
	});

	it("does not carry prepareQuery or metadata", () => {
		const pack = makePack();
		const module = oracleModuleFromPack(pack);

		// Composite manifests don't need either; OracleModule is the strict
		// subset of PolicyPack that defineComposite consumes.
		assert.equal("prepareQuery" in module, false);
		assert.equal("metadata" in module, false);
	});

	it("schema references are byte-identical (same z.ZodType instance)", () => {
		// Load-bearing for the composite story — params validated through the
		// OracleModule MUST validate the same way as through the underlying
		// PolicyPack. A field-by-field projection that copied the schema would
		// pass the structural test above but break this identity check.
		const pack = makePack();
		const module = oracleModuleFromPack(pack);
		assert.strictEqual(module.paramsSchema, pack.paramsSchema);
		assert.strictEqual(module.wasmArgsSchema, pack.wasmArgsSchema);
		assert.strictEqual(module.secretsSchema, pack.secretsSchema);
	});

	it("deployments reference is the same object (no clone)", () => {
		// `defineComposite` reads each module's deployments to populate the
		// on-chain manifest — depositors verify the manifest's wasmCid against
		// the on-chain INewtonPolicyData.getWasmCid() value. A cloned
		// deployments map could drift if the underlying pack's deployments
		// were mutated; a reference can't.
		const pack = makePack();
		const module = oracleModuleFromPack(pack);
		assert.strictEqual(module.deployments, pack.deployments);
	});

	it("preserves type parameters end-to-end", () => {
		const pack = makePack();
		const module = oracleModuleFromPack(pack);

		// Validate via the projected schema and check the inferred shape.
		const parsed = module.paramsSchema.parse({ floor: 80 });
		assert.equal(parsed.floor, 80);

		assert.throws(() => module.paramsSchema.parse({ floor: "wrong" }));
	});
});
