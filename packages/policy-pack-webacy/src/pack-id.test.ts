import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { PACK_NAME } from "./metadata";

// Phase 0 § Stream B drift static check (NEWT-1539). Mirrors
// `packages/policy-pack-vaultsfyi/src/pack-id.test.ts` (canonical pattern from PR #41).

const __dirname = dirname(fileURLToPath(import.meta.url));
const POLICY_JS_PATH = resolve(__dirname, "../../../webacy/policy.js");

describe("PACK_ID drift check", () => {
	it("PACK_ID literal in policy.js matches PACK_NAME from metadata.ts", () => {
		const source = readFileSync(POLICY_JS_PATH, "utf8");
		const match = source.match(/const\s+PACK_ID\s*=\s*["']([^"']+)["']\s*;?/);
		assert.ok(match, `Could not find \`const PACK_ID = "..."\` declaration in ${POLICY_JS_PATH}.`);
		const literalPackId = match[1];
		assert.equal(
			literalPackId,
			PACK_NAME,
			`PACK_ID drift: webacy/policy.js has \`PACK_ID = "${literalPackId}"\` ` +
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
			"webacy",
			`PACK_NAME = "${PACK_NAME}" but the canonical folder is \`webacy\`. ` +
				"`metadata.ts` is auto-generated from `policy_metadata.json` — " +
				"if you renamed the pack, update `policy_metadata.json`'s `name` " +
				"field and the AVS-side directory together.",
		);
	});
});
