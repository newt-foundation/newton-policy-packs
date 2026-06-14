import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { wrapOutput } from "./wrap";

describe("wrapOutput", () => {
	it("wraps a success payload under the pack-id key", () => {
		const out = wrapOutput("vaultsfyi", { score: 80, risk_score: 75 });
		assert.equal(out, '{"vaultsfyi":{"score":80,"risk_score":75}}');
		const parsed = JSON.parse(out) as Record<string, unknown>;
		assert.deepEqual(Object.keys(parsed), ["vaultsfyi"]);
	});

	it("wraps an error payload under the pack-id key (not at top level)", () => {
		// The error path is the load-bearing case: pre-namespacing, every pack
		// returning `{"error": "..."}` would collide on `error` after
		// `merge_jsons` (last-wins). Post-namespacing, each pack's error sits
		// under its own key and composite Rego can selectively deny on
		// `data.wasm.<pack-id>.error`.
		const out = wrapOutput("chainalysis", { error: "rate-limited" });
		assert.equal(out, '{"chainalysis":{"error":"rate-limited"}}');
		const parsed = JSON.parse(out) as Record<string, unknown>;
		assert.deepEqual(Object.keys(parsed), ["chainalysis"]);
		// And specifically NOT a bare top-level `error` key.
		assert.equal((parsed as { error?: unknown }).error, undefined);
	});

	it("preserves the inner payload structurally (no reorder, no normalize)", () => {
		// The merge_jsons contract is shallow + last-wins on the OUTER
		// top-level keys. Inside each pack's namespace, the pack owns its own
		// shape — `wrapOutput` must NOT reorder or normalize the inner
		// payload. Composite Rego references `data.wasm.<pack-id>.<field>`
		// by key (Rego field access is by name, not byte position), so the
		// load-bearing claim here is structural equality post-roundtrip,
		// not literal byte identity.
		const inner = { b: 2, a: 1, nested: { z: 9, a: 1 } };
		const out = wrapOutput("redstone", inner);
		const parsed = JSON.parse(out) as { redstone: typeof inner };
		assert.deepEqual(parsed.redstone, inner);
	});

	it("survives merge_jsons composition without top-level key collisions", () => {
		// Simulates the AVS-side merge: every pack's wrapOutput stdout becomes
		// one entry in the merged `data.wasm` blob. The merge is shallow
		// (`Object.assign`-shaped); namespacing is the entire reason this
		// works. If two packs accidentally chose the same `packId`, the
		// merge would clobber — but that's caught upstream by the
		// `KNOWN_PACK_IDS` registry check in Phase 2, not here.
		const a = JSON.parse(wrapOutput("vaultsfyi", { risk_score: 80 }));
		const b = JSON.parse(wrapOutput("chainalysis", { sanctioned: false }));
		const merged = { ...a, ...b };
		assert.deepEqual(merged, {
			vaultsfyi: { risk_score: 80 },
			chainalysis: { sanctioned: false },
		});
		// Both packs survive; neither clobbered the other.
		assert.deepEqual(Object.keys(merged).sort(), ["chainalysis", "vaultsfyi"]);
	});

	it("handles primitive payloads (numbers, strings, booleans, null)", () => {
		// `valueOrError` is typed `unknown` because pack outputs vary; locking
		// the four common primitive shapes prevents future code paths that
		// assume an object payload from breaking the wrapper contract.
		assert.equal(wrapOutput("p", 42), '{"p":42}');
		assert.equal(wrapOutput("p", "hello"), '{"p":"hello"}');
		assert.equal(wrapOutput("p", true), '{"p":true}');
		assert.equal(wrapOutput("p", null), '{"p":null}');
	});

	it("handles array payloads", () => {
		// Some packs return list-shaped outputs (e.g. risk_categories). The
		// wrapper passes them through verbatim — JSON.stringify preserves
		// array element order.
		const out = wrapOutput("chainalysis", { risk_categories: ["sanctions", "pep"] });
		assert.equal(out, '{"chainalysis":{"risk_categories":["sanctions","pep"]}}');
	});

	it("does NOT call sortKeysDeep — merge_jsons doesn't require it", () => {
		// `encodePolicyParams` sorts keys recursively because the SDK does
		// byte-equality checks against on-chain `policyParams`. wrapOutput is
		// a different contract: the AVS host parses each PolicyData stdout
		// as UTF-8 JSON via `serde_json::from_str` and merges into a single
		// `data.wasm` blob — Rego references fields by name, not by byte
		// position. Sorting would add cost without affecting correctness AND
		// would diverge from the existing `policy.js` `JSON.stringify(...)`
		// shape we're locking via the AST-lint guard.
		const out = wrapOutput("p", { z: 1, a: 2 });
		// Insertion order preserved (z before a).
		assert.equal(out, '{"p":{"z":1,"a":2}}');
	});

	it("rejects non-string packId at the type level (runtime smoke check)", () => {
		// Type system catches this at compile time. The runtime smoke check
		// confirms passing a non-string still produces structurally-valid
		// JSON. The AST-lint guard in Stream C is the real backstop — every
		// `<pack>/policy.js` callsite reads `PACK_ID` as a build-time-injected
		// const sourced from `packages/policy-pack-<pack>/src/metadata.ts`
		// (Phase 0 § Stream B item 6 specifies build-time codegen because
		// `policy.js` is a root AVS WASM artifact and can't bare-import TS).
		// @ts-expect-error: packId must be string
		const out = wrapOutput(123, { a: 1 });
		// Coerced via the computed property key.
		assert.equal(out, '{"123":{"a":1}}');
	});

	it("documents undefined / non-JSON-representable payload behavior (pinned)", () => {
		// `JSON.stringify({ [packId]: undefined })` returns `'{}'` (the key
		// is omitted because `undefined` is non-representable in JSON). Same
		// for function and symbol values. This violates the documented
		// "top-level keys are exactly `[packId]`" invariant on paper, but
		// the AVS contract doesn't admit such payloads — every `policy.js`
		// returns either a structured success object or `{ error: "..." }`
		// — so this is out-of-contract input rather than a runtime guard
		// concern. Stream C AST-lint catches the shape upstream. Pinning the
		// observed behavior here so any future change (e.g. switching to a
		// custom replacer) is caught as an intentional contract change.
		assert.equal(wrapOutput("p", undefined), "{}");
		assert.equal(
			wrapOutput("p", () => 1),
			"{}",
		);
		assert.equal(wrapOutput("p", Symbol("s")), "{}");
	});
});
