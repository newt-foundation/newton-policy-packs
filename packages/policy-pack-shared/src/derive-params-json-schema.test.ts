import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { generateCompositeParamsSchema } from "./composite-manifest";
import { deriveParamsJsonSchema, ParamsSchemaDerivationError } from "./derive-params-json-schema";

const ID = { id: "example/thing/v1" };

test("derives a regorus-clean schema for a flat strict object", () => {
	const schema = z.object({ maxLtv: z.number().min(0).max(10000), enabled: z.boolean() }).strict();
	const json = deriveParamsJsonSchema(schema, ID) as Record<string, unknown>;
	assert.equal(json.type, "object");
	assert.equal("$schema" in json, false, "root $schema must be stripped");
	assert.ok(json.properties, "properties present");
});

test("passes an enum + numeric bounds through the gate", () => {
	const schema = z
		.object({ tier: z.enum(["low", "mid", "high"]), cap: z.number().int().min(1) })
		.strict();
	assert.doesNotThrow(() => deriveParamsJsonSchema(schema, ID));
});

test("converts .email() to an allowlisted pattern (does NOT throw)", () => {
	// PROVEN against zod-to-json-schema 3.25.2: emailStrategy "pattern:zod" renders
	// z.string().email() as `pattern`, not `format`, so it PASSES the gate. This is
	// the one format-refinement that converts.
	const schema = z.object({ contact: z.string().email() }).strict();
	assert.doesNotThrow(() => deriveParamsJsonSchema(schema, ID));
});

test("throws ParamsSchemaDerivationError on a format-producing refinement", () => {
	// PROVEN: z.string().datetime() emits `format:"date-time"` (dateStrategy does
	// NOT apply to it - it routes through the string parser), which
	// REGORUS_SCHEMA_KEYWORDS rejects. This MUST fail at authoring, not fail-closed
	// at attestation. (.url() -> format:"uri" and .ip() -> format also work here.)
	const schema = z.object({ when: z.string().datetime() }).strict();
	assert.throws(() => deriveParamsJsonSchema(schema, ID), ParamsSchemaDerivationError);
});

test("optional + nullable fields pass", () => {
	const schema = z.object({ note: z.string().optional(), cap: z.number().nullable() }).strict();
	assert.doesNotThrow(() => deriveParamsJsonSchema(schema, ID));
});

test("nested strict objects pass", () => {
	const schema = z.object({ band: z.object({ lo: z.number(), hi: z.number() }).strict() }).strict();
	assert.doesNotThrow(() => deriveParamsJsonSchema(schema, ID));
});

test("arrays of primitives and of strict objects pass", () => {
	const schema = z
		.object({
			tags: z.array(z.string()),
			rows: z.array(z.object({ k: z.string(), v: z.number() }).strict()),
		})
		.strict();
	assert.doesNotThrow(() => deriveParamsJsonSchema(schema, ID));
});

test("a union passes (derives to anyOf / type-array, both allowlisted)", () => {
	const schema = z.object({ v: z.union([z.string(), z.number()]) }).strict();
	assert.doesNotThrow(() => deriveParamsJsonSchema(schema, ID));
});

test("ANTI-VACUOUS control: the gate really rejects an unsupported keyword", () => {
	// Prove the harness can fail: hand a raw schema with a regorus-hostile keyword
	// straight to the gate this helper wraps. If this does NOT throw, the gate is
	// not actually running and the green above is meaningless.
	assert.throws(
		() =>
			generateCompositeParamsSchema({ modules: [{ id: ID.id, paramsJsonSchema: { oneOf: [] } }] }),
		/newton-rego does not support/,
	);
});
