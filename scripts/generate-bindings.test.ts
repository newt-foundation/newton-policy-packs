/**
 * Self-tests for generate-bindings.ts: the `_manifest` reservation walker,
 * the published-env filter, and the umbrella package wiring.
 * The walker rejects any params_schema.json that admits a top-level
 * `_manifest` field — that key is reserved as the composite-policy manifest
 * discriminator (NEWT-1541). A naive `properties._manifest` check is dodgeable
 * via JSON Schema combinators (oneOf/anyOf/allOf), patternProperties, or an
 * open-object schema; this test exercises every dodge path so a regression
 * would surface before it could ship.
 *
 * Imports `findManifestKeyViolation` from the production codegen script
 * directly — no duplicate walker. Wired to CI via the workspace test runner.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
	emitUmbrellaIndex,
	filterPublishedEnvs,
	findManifestKeyViolation,
	updateUmbrellaPackageJson,
} from "./generate-bindings";

describe("findManifestKeyViolation — accepted (no violation)", () => {
	it("returns null for a closed object schema with no _manifest", () => {
		assert.equal(
			findManifestKeyViolation({
				type: "object",
				additionalProperties: false,
				properties: { floor: { type: "number" } },
				required: ["floor"],
			}),
			null,
		);
	});

	it("returns null for an empty closed object", () => {
		assert.equal(
			findManifestKeyViolation({
				type: "object",
				additionalProperties: false,
				properties: {},
			}),
			null,
		);
	});

	it("returns null when patternProperties does NOT match _manifest", () => {
		assert.equal(
			findManifestKeyViolation({
				type: "object",
				additionalProperties: false,
				patternProperties: { "^[a-z]+$": { type: "number" } }, // _manifest starts with _, not [a-z]
			}),
			null,
		);
	});

	it("returns null for nested combinators that all close their objects", () => {
		assert.equal(
			findManifestKeyViolation({
				type: "object",
				additionalProperties: false,
				oneOf: [
					{ properties: { floor: { type: "number" } } },
					{ properties: { ceiling: { type: "number" } } },
				],
				properties: { floor: { type: "number" }, ceiling: { type: "number" } },
			}),
			null,
		);
	});

	it("returns null for non-object schemas (defensive)", () => {
		assert.equal(findManifestKeyViolation(null), null);
		assert.equal(findManifestKeyViolation(undefined), null);
		assert.equal(findManifestKeyViolation("string"), null);
		assert.equal(findManifestKeyViolation(42), null);
		assert.equal(findManifestKeyViolation([]), null);
	});

	it("does not recurse into `not` (forbidding _manifest is fine)", () => {
		// `not: { properties: { _manifest: ... } }` says "MUST NOT match a
		// schema that has _manifest" — this is a *prohibition* of _manifest,
		// not an admission. Walker correctly skips this branch.
		assert.equal(
			findManifestKeyViolation({
				type: "object",
				additionalProperties: false,
				properties: { floor: { type: "number" } },
				not: { properties: { _manifest: { type: "string" } } },
			}),
			null,
		);
	});
});

describe("findManifestKeyViolation — rejected (violation found)", () => {
	it("flags direct properties._manifest", () => {
		const result = findManifestKeyViolation({
			type: "object",
			properties: { _manifest: { type: "string" } },
		});
		assert.ok(result, "expected a violation");
		assert.match(result, /properties\._manifest/);
	});

	it("flags _manifest inside oneOf branch", () => {
		const result = findManifestKeyViolation({
			type: "object",
			additionalProperties: false,
			oneOf: [
				{ properties: { floor: { type: "number" } } },
				{ properties: { _manifest: { type: "string" } } },
			],
		});
		assert.ok(result);
		assert.match(result, /oneOf\[1\]\.properties\._manifest/);
	});

	it("flags _manifest inside anyOf branch", () => {
		const result = findManifestKeyViolation({
			type: "object",
			additionalProperties: false,
			anyOf: [{ properties: { _manifest: { type: "string" } } }],
		});
		assert.ok(result);
		assert.match(result, /anyOf\[0\]\.properties\._manifest/);
	});

	it("flags _manifest inside allOf branch", () => {
		const result = findManifestKeyViolation({
			type: "object",
			additionalProperties: false,
			allOf: [{ properties: { _manifest: { type: "string" } } }],
		});
		assert.ok(result);
		assert.match(result, /allOf\[0\]\.properties\._manifest/);
	});

	it("flags patternProperties matching _manifest exactly", () => {
		const result = findManifestKeyViolation({
			type: "object",
			additionalProperties: false,
			patternProperties: { "^_manifest$": { type: "string" } },
		});
		assert.ok(result);
		assert.match(result, /patternProperties.*matches "_manifest"/);
	});

	it("flags patternProperties matching _manifest via permissive regex", () => {
		// `^_.*` would match _manifest, _foo, etc.
		const result = findManifestKeyViolation({
			type: "object",
			additionalProperties: false,
			patternProperties: { "^_.*": { type: "string" } },
		});
		assert.ok(result);
	});

	// Open-object schemas (missing `additionalProperties: false`) are NOT
	// flagged by the walker — zod's `.strict()` at emitSchemaFile time stops
	// `_manifest` at the runtime SDK boundary, and forcing every existing pack
	// to add `additionalProperties: false` would be a partner-facing change.
	// See the walker comment in generate-bindings.ts for the rationale.

	it("flags _manifest nested two combinators deep (oneOf > allOf)", () => {
		const result = findManifestKeyViolation({
			type: "object",
			additionalProperties: false,
			oneOf: [
				{
					allOf: [{ properties: { _manifest: { type: "string" } } }],
				},
			],
		});
		assert.ok(result);
		assert.match(result, /oneOf\[0\]\.allOf\[0\]\.properties\._manifest/);
	});
});

describe("filterPublishedEnvs — stagef is internal-only, never published", () => {
	const entry = (policyData: string) => ({
		policyData,
		wasmCid: "bafytest",
		policyCodeHash: "0xdead",
		deployedAt: "2026-06-20",
	});

	it("strips stagef cells, keeps prod", () => {
		const out = filterPublishedEnvs({
			"1": { prod: entry("0xprod1"), stagef: entry("0xstagef1") },
			"8453": { prod: entry("0xprod8453"), stagef: entry("0xstagef8453") },
		});
		assert.deepEqual(Object.keys(out).sort(), ["1", "8453"]);
		assert.deepEqual(Object.keys(out["1"] ?? {}), ["prod"]);
		assert.deepEqual(Object.keys(out["8453"] ?? {}), ["prod"]);
	});

	it("drops a chain that has ONLY stagef (no empty {} emitted)", () => {
		const out = filterPublishedEnvs({
			"11155111": { prod: entry("0xprod") },
			"31337": { stagef: entry("0xstagefonly") }, // local-only cell, stagef only
		});
		assert.deepEqual(Object.keys(out), ["11155111"]);
		assert.equal(out["31337"], undefined);
	});

	it("never emits the string 'stagef' anywhere in the result", () => {
		const out = filterPublishedEnvs({
			"1": { prod: entry("0xa"), stagef: entry("0xb") },
		});
		assert.equal(JSON.stringify(out).includes("stagef"), false);
	});

	it("returns an empty object when every cell is stagef", () => {
		const out = filterPublishedEnvs({ "1": { stagef: entry("0xb") } });
		assert.deepEqual(out, {});
	});
});

describe("updateUmbrellaPackageJson — umbrella wiring is codegen-owned", () => {
	const basePkg = () => ({
		name: "@newton-xyz/policy-packs",
		version: "1.0.0",
		scripts: { build: "tsup" },
		peerDependencies: { "@newton-xyz/policy-core": ">=0.2.0 <1.0.0" },
		exports: {
			".": {
				types: "./dist/index.d.ts",
				import: "./dist/index.js",
				require: "./dist/index.cjs",
			},
			"./webacy": {
				types: "./dist/webacy.d.ts",
				import: "./dist/webacy.js",
				require: "./dist/webacy.cjs",
			},
		},
		devDependencies: {
			"@newton-xyz/policy-pack-webacy": "workspace:*",
			"@newton-xyz/policy-core": "^0.2.0",
			tsup: "^8.5.1",
		},
	});

	it("adds a new pack's subpath export and workspace devDep", () => {
		const out = updateUmbrellaPackageJson(basePkg(), ["balancer", "webacy"]);
		assert.deepEqual(Object.keys(out.exports ?? {}), [".", "./balancer", "./webacy"]);
		assert.deepEqual(out.exports?.["./balancer"], {
			types: "./dist/balancer.d.ts",
			import: "./dist/balancer.js",
			require: "./dist/balancer.cjs",
		});
		assert.equal(out.devDependencies?.["@newton-xyz/policy-pack-balancer"], "workspace:*");
	});

	it("drops a removed pack's export and devDep", () => {
		const out = updateUmbrellaPackageJson(basePkg(), ["balancer"]);
		assert.deepEqual(Object.keys(out.exports ?? {}), [".", "./balancer"]);
		assert.equal(out.devDependencies?.["@newton-xyz/policy-pack-webacy"], undefined);
	});

	it("preserves hand-maintained fields and non-pack entries verbatim", () => {
		const pkg = basePkg();
		const out = updateUmbrellaPackageJson(pkg, ["webacy"]);
		assert.equal(out.version, "1.0.0");
		assert.deepEqual(out.scripts, pkg.scripts);
		assert.deepEqual(out.peerDependencies, pkg.peerDependencies);
		assert.equal(out.devDependencies?.["@newton-xyz/policy-core"], "^0.2.0");
		assert.equal(out.devDependencies?.tsup, "^8.5.1");
		// Non-pack devDeps keep their existing relative order, after the packs.
		assert.deepEqual(Object.keys(out.devDependencies ?? {}), [
			"@newton-xyz/policy-pack-webacy",
			"@newton-xyz/policy-core",
			"tsup",
		]);
	});

	it("preserves a hand-added subpath whose shape is not the generated one", () => {
		const pkg = basePkg();
		pkg.exports["./utils"] = { import: "./dist/utils.js" };
		const out = updateUmbrellaPackageJson(pkg, ["webacy"]);
		assert.deepEqual(out.exports?.["./utils"], { import: "./dist/utils.js" });
	});

	it("is idempotent", () => {
		const once = updateUmbrellaPackageJson(basePkg(), ["balancer", "webacy"]);
		const twice = updateUmbrellaPackageJson(once, ["balancer", "webacy"]);
		assert.deepEqual(twice, once);
	});
});

describe("emitUmbrellaIndex — one namespace re-export per pack", () => {
	it("emits packs in the given order, under the AUTO-GENERATED banner", () => {
		const out = emitUmbrellaIndex(["balancer", "webacy"]);
		assert.ok(out.startsWith("// AUTO-GENERATED"));
		assert.ok(out.includes('export * as balancer from "./balancer";'));
		assert.ok(out.includes('export * as webacy from "./webacy";'));
		assert.ok(
			out.indexOf('export * as balancer') < out.indexOf('export * as webacy'),
		);
	});
});
