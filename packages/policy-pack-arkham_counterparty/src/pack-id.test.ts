import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { PACK_NAME } from "./metadata";

// Phase 0 § Stream B drift static check (NEWT-1539). Mirrors
// `packages/policy-pack-vaultsfyi/src/pack-id.test.ts` (canonical pattern from PR #41).

const __dirname = dirname(fileURLToPath(import.meta.url));
const POLICY_JS_PATH = resolve(__dirname, "../../../arkham_counterparty/policy.js");

describe("PACK_ID drift check", () => {
	it("PACK_ID literal in policy.js matches PACK_NAME from metadata.ts", () => {
		const source = readFileSync(POLICY_JS_PATH, "utf8");
		const match = source.match(/const\s+PACK_ID\s*=\s*["']([^"']+)["']\s*;?/);
		assert.ok(match, `Could not find \`const PACK_ID = "..."\` declaration in ${POLICY_JS_PATH}.`);
		const literalPackId = match[1];
		assert.equal(
			literalPackId,
			PACK_NAME,
			`PACK_ID drift: arkham_counterparty/policy.js has \`PACK_ID = "${literalPackId}"\` ` +
				`but metadata.ts exports \`PACK_NAME = "${PACK_NAME}"\`. ` +
				"These must match per Phase 0 § Stream B (NEWT-1539). " +
				"`metadata.ts` is auto-generated from `policy_metadata.json` " +
				"(`pnpm gen:bindings`); update `policy_metadata.json`'s `name` field " +
				"and re-run `gen:bindings`, OR fix the literal in `policy.js`.",
		);
	});

	it("PACK_NAME matches the package folder name", () => {
		assert.equal(
			PACK_NAME,
			"arkham_counterparty",
			`PACK_NAME = "${PACK_NAME}" but the canonical folder is \`arkham_counterparty\`. ` +
				"`metadata.ts` is auto-generated from `policy_metadata.json` — " +
				"if you renamed the pack, update `policy_metadata.json`'s `name` " +
				"field and the AVS-side directory together.",
		);
	});

	// The no-hyphen rule is enforced at runtime by `defineOracle`
	// (SHORT_ID_RE = /^[a-z][a-z0-9_]*$/ in @newton-xyz/policy-core): Rego
	// parses `a-b` as subtraction, so a kebab-case pack id would break every
	// `data.wasm.<id>` reference. Pin it here too so a rename fails at
	// `pnpm test` rather than at Shield construction time.
	it("PACK_NAME is a valid Rego-safe short id", () => {
		assert.match(
			PACK_NAME,
			/^[a-z][a-z0-9_]*$/,
			`PACK_NAME = "${PACK_NAME}" must match /^[a-z][a-z0-9_]*$/ — no hyphens, ` +
				"because Rego reads `a-b` as subtraction.",
		);
	});
});
