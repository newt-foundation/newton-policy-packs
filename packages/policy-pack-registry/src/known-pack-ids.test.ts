import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { isKnownPackId, KNOWN_PACK_IDS } from "./known-pack-ids";

describe("KNOWN_PACK_IDS", () => {
	it("contains exactly the 9 currently-published pack short ids", () => {
		assert.deepEqual([...KNOWN_PACK_IDS].sort(), [
			"balancer",
			"blockaid",
			"chainalysis",
			"guardrail",
			"persona",
			"redstone",
			"sumsub",
			"vaultsfyi",
			"webacy",
		]);
	});

	it("contains no duplicates", () => {
		assert.equal(new Set(KNOWN_PACK_IDS).size, KNOWN_PACK_IDS.length);
	});
});

describe("isKnownPackId", () => {
	it("returns true for every entry in the registry", () => {
		for (const id of KNOWN_PACK_IDS) {
			assert.equal(isKnownPackId(id), true, `${id} should be known`);
		}
	});

	it("returns false for unrelated strings", () => {
		assert.equal(isKnownPackId("not-a-pack"), false);
		assert.equal(isKnownPackId(""), false);
		assert.equal(isKnownPackId("vaultsfyi/risk-envelope/v1"), false); // full id, not short id
	});
});
