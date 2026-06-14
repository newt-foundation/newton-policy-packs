import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { PACK_NAME } from "./metadata";

// Phase 0 § Stream B drift static check (NEWT-1539). Mirrors
// `packages/policy-pack-vaultsfyi/src/pack-id.test.ts` (the canonical
// pattern from PR #41).
//
// Three sources of truth for the pack id:
//   1. `balancer/policy.js`            — `const PACK_ID = "<id>";`
//   2. `packages/policy-pack-balancer/src/metadata.ts` — `PACK_NAME` export
//   3. `balancer/policy_metadata.json` — `name` field
//
// `metadata.ts` is auto-generated from `policy_metadata.json` by
// `scripts/generate-bindings.ts`; (2) and (3) drift-check each other via
// `pnpm gen:bindings && git diff --exit-code` already.
//
// The unchecked surface is (1) ↔ (2): `policy.js` is a root AVS WASM
// artifact fed straight to `jco componentize` — it cannot bare-import
// `metadata.ts`, so `PACK_ID` is hardcoded inline (per
// `phase-0-pack-namespacing-plan.md` Stream B item 6). This test parses
// `policy.js` as text, regexes the `PACK_ID` literal out, and asserts
// `PACK_ID === PACK_NAME`. If a future hand-edit drifts either side, this
// fails at `pnpm test` before the WASM rebuild step in Stream D.

const __dirname = dirname(fileURLToPath(import.meta.url));
const POLICY_JS_PATH = resolve(__dirname, "../../../balancer/policy.js");

describe("PACK_ID drift check", () => {
	it("PACK_ID literal in policy.js matches PACK_NAME from metadata.ts", () => {
		const source = readFileSync(POLICY_JS_PATH, "utf8");
		const match = source.match(/const\s+PACK_ID\s*=\s*["']([^"']+)["']\s*;?/);
		assert.ok(
			match,
			`Could not find \`const PACK_ID = "..."\` declaration in ${POLICY_JS_PATH}. ` +
				"Phase 0 § Stream B requires every <pack>/policy.js to hardcode `PACK_ID`.",
		);
		const literalPackId = match[1];
		assert.equal(
			literalPackId,
			PACK_NAME,
			`PACK_ID drift: balancer/policy.js has \`PACK_ID = "${literalPackId}"\` ` +
				`but metadata.ts exports \`PACK_NAME = "${PACK_NAME}"\`. ` +
				"These must match per Phase 0 § Stream B (NEWT-1539). " +
				"`metadata.ts` is auto-generated from `policy_metadata.json` " +
				"(`pnpm gen:bindings`); update `policy_metadata.json`'s `name` field " +
				"and re-run `gen:bindings`, OR fix the literal in `policy.js`.",
		);
	});

	it("PACK_NAME matches the package folder name", () => {
		// Belt-and-braces: the canonical pack id is the folder name. The
		// folder name is locked at `balancer` per `scripts/deploy-all.sh`'s
		// ALL_PACKS list.
		assert.equal(
			PACK_NAME,
			"balancer",
			`PACK_NAME = "${PACK_NAME}" but the canonical folder is \`balancer\`. ` +
				"`metadata.ts` is auto-generated from `policy_metadata.json` — " +
				"if you renamed the pack, update `policy_metadata.json`'s `name` " +
				"field and the AVS-side directory together.",
		);
	});
});
