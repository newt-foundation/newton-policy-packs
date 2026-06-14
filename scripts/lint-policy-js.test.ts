/**
 * Self-test for the AST-lint guard. Runs the PRODUCTION `lintFile` from
 * `lint-policy-js.ts` against fixtures under `scripts/__fixtures__/lint-policy-js/`.
 *
 * Importing `lintFile` (rather than re-implementing the walker here) is
 * load-bearing — codex review caught that a duplicated walker would let the
 * test pass while the production script silently broke. Same code, same
 * contract, every check.
 *
 * Fixtures:
 *  - `good.js` — every return uses `return wrapOutput(...)` directly. Lint
 *                MUST accept (zero violations).
 *  - `bad.js`  — four distinct violation patterns. Lint MUST reject and
 *                surface all four with line numbers.
 *
 * Runs via the same test runner as `policy-pack-shared/src/wrap.test.ts`:
 * `node --import tsx --test`. Wired to CI under the `lint:policy-js:test` script.
 */

import { strict as assert } from "node:assert";
import { unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { lintFile } from "./lint-policy-js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = resolve(here, "__fixtures__/lint-policy-js");
const goodFixture = resolve(fixtureRoot, "good.js");
const badFixture = resolve(fixtureRoot, "bad.js");

describe("lint-policy-js (AST guard)", () => {
	it("accepts good.js — every return uses `return wrapOutput(...)` directly", () => {
		const violations = lintFile(goodFixture, fixtureRoot);
		assert.deepEqual(
			violations,
			[],
			`expected zero violations on good.js, got: ${JSON.stringify(violations)}`,
		);
	});

	it("rejects bad.js — surfaces all four violation patterns", () => {
		const violations = lintFile(badFixture, fixtureRoot);
		// Four return-JSON.stringify-of-anything callsites:
		//   - inline object literal in success path
		//   - inline { error: ... } object in catch path
		//   - indirect helper call (buildPayload(parsed))
		//   - JSON.stringify(wrapOutput(...)) — would double-escape; still a violation
		assert.equal(
			violations.length,
			4,
			`expected exactly 4 violations on bad.js, got ${violations.length}: ${JSON.stringify(violations)}`,
		);
		// Pin line numbers — fixture file is stable; if these drift the fixture
		// changed and the test should be updated alongside.
		const lines = violations.map((v) => v.line).sort((a, b) => a - b);
		assert.deepEqual(
			lines,
			[24, 27, 34, 40],
			`unexpected violation lines: ${JSON.stringify(lines)}`,
		);
	});

	it("catches computed `JSON['stringify'](...)` access", () => {
		// Synthesize a fixture inline so we don't ship a separate file just for
		// this edge case — bypass attempt that the new contract MUST catch.
		const tmp = resolve(fixtureRoot, "_tmp-computed.js");
		writeFileSync(tmp, 'export function run(args) {\n  return JSON["stringify"]({ a: 1 });\n}\n');
		try {
			const violations = lintFile(tmp, fixtureRoot);
			assert.equal(
				violations.length,
				1,
				`expected 1 violation on JSON["stringify"], got ${violations.length}`,
			);
			assert.equal(violations[0]?.line, 2);
		} finally {
			unlinkSync(tmp);
		}
	});
});
