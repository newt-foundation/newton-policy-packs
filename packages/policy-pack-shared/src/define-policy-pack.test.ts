import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { definePolicyPack, PolicyPackDefinitionError } from "./define-policy-pack";

const base = {
	paramsSchema: z.object({ maxLtv: z.number().int().min(0).max(10000) }).strict(),
	wasmArgsSchema: z.object({}).strict(),
	secretsSchema: z.object({}).strict(),
	deployments: {},
	metadata: { name: "Example", version: "1.0.0", description: "example" },
} as const;

test("builds a pack and derives paramsJsonSchema when omitted", () => {
	const pack = definePolicyPack({ id: "example/max-ltv/v1", ...base });
	assert.equal(pack.id, "example/max-ltv/v1");
	assert.ok(pack.paramsJsonSchema, "paramsJsonSchema derived");
	const json = pack.paramsJsonSchema as Record<string, unknown>;
	assert.equal(json.type, "object");
});

test("rejects an id that derives an invalid short id", () => {
	assert.throws(
		() => definePolicyPack({ id: "Bad-Id/x/v1", ...base }),
		PolicyPackDefinitionError,
	);
});

test("does NOT reject a first-party-looking short id (no membership gate)", () => {
	// Q7: an unknown/first-party-looking id is NORMAL, not blocked. A custom
	// author may name a module `vaultsfyi` - provenance (Task 5) tags it, the
	// factory does not block it.
	assert.doesNotThrow(() => definePolicyPack({ id: "vaultsfyi/x/v1", ...base }));
});

test("rejects a non-zod paramsSchema", () => {
	assert.throws(
		() =>
			definePolicyPack({
				...base,
				id: "example/x/v1",
				paramsSchema: {} as unknown as z.ZodType<unknown>,
			}),
		PolicyPackDefinitionError,
	);
});

test("throws on a format-refinement (derivation gate)", () => {
	assert.throws(
		() =>
			definePolicyPack({
				id: "example/x/v1",
				...base,
				// .datetime() emits `format:"date-time"` (rejected); .email() would
				// CONVERT to pattern and pass, so it is not a valid negative case.
				paramsSchema: z.object({ when: z.string().datetime() }).strict(),
			}),
		// ParamsSchemaDerivationError bubbles through; assert on the message.
		/newton-rego|regorus-clean/,
	);
});

test("accepts a well-formed unsafeParamsJsonSchemaOverride and still gates it", () => {
	// base.paramsSchema is z.object({ maxLtv }), so an override describing { maxLtv }
	// reconciles (same key set) and passes both the regorus gate and the ported check.
	const pack = definePolicyPack({
		id: "example/x/v1",
		...base,
		unsafeParamsJsonSchemaOverride: { type: "object", properties: { maxLtv: { type: "integer" } } },
	});
	assert.ok(pack.paramsJsonSchema);
	// regorus-hostile override is rejected by the keyword gate:
	assert.throws(
		() =>
			definePolicyPack({
				id: "example/y/v1",
				...base,
				unsafeParamsJsonSchemaOverride: { oneOf: [] },
			}),
		PolicyPackDefinitionError,
	);
});

test("rejects an unsafeParamsJsonSchemaOverride whose keys drift from paramsSchema (ported reconciliation)", () => {
	// DX-1: the override must not be WEAKER than the retired defineCustomModule.
	// base.paramsSchema describes { maxLtv }; an override describing a DIFFERENT
	// field set must throw, or SDK-valid params get denied fail-closed at the AVS.
	assert.throws(
		() =>
			definePolicyPack({
				id: "example/z/v1",
				...base,
				unsafeParamsJsonSchemaOverride: { type: "object", properties: { wrongField: { type: "integer" } } },
			}),
		/describe different fields|maxLtv/,
	);
});
