import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { hexToBytes } from "viem";
import { z } from "zod";
import { decodePolicyParams, encodePolicyParams } from "./encoding";

describe("encodePolicyParams / decodePolicyParams", () => {
	it("round-trips a representative VaultsFYI params shape", () => {
		const pack = {
			paramsSchema: z.object({
				apy_z_max: z.number(),
				tvl_drawdown_24h_max_pct: z.number(),
				tvl_drawdown_7d_max_pct: z.number(),
				risk_score_floor: z.number().int().min(0).max(100),
				deny_on_allocation_change: z.boolean(),
				deny_on_critical_flag: z.boolean(),
				deny_on_corrupted: z.boolean(),
			}),
		};
		const params = {
			apy_z_max: 3,
			tvl_drawdown_24h_max_pct: 0.05,
			tvl_drawdown_7d_max_pct: 0.2,
			risk_score_floor: 85,
			deny_on_allocation_change: true,
			deny_on_critical_flag: true,
			deny_on_corrupted: true,
		};

		const encoded = encodePolicyParams(pack, params);
		assert.deepEqual(decodePolicyParams(pack, encoded), params);
	});

	it("produces byte-identical output regardless of insertion order", () => {
		const pack = { paramsSchema: z.object({ a: z.number(), b: z.number() }) };
		const lhs = encodePolicyParams(pack, { a: 1, b: 2 });
		const rhs = encodePolicyParams(pack, { b: 2, a: 1 });
		assert.equal(lhs, rhs);
	});

	it("sorts keys recursively (nested objects are also stable)", () => {
		const pack = {
			paramsSchema: z.object({
				outer: z.object({ z: z.number(), a: z.number() }),
			}),
		};
		const encoded = encodePolicyParams(pack, { outer: { z: 9, a: 1 } });
		const json = new TextDecoder().decode(hexToBytes(encoded));
		assert.equal(json, '{"outer":{"a":1,"z":9}}');
	});

	it("preserves array element order (arrays are not reordered)", () => {
		const pack = {
			paramsSchema: z.object({
				allowed_countries: z.array(z.string()),
			}),
		};
		const encoded = encodePolicyParams(pack, {
			allowed_countries: ["US", "CA", "GB"],
		});
		const json = new TextDecoder().decode(hexToBytes(encoded));
		assert.equal(json, '{"allowed_countries":["US","CA","GB"]}');
	});

	it("rejects unknown extra fields when the schema is strict", () => {
		const pack = {
			paramsSchema: z.object({ a: z.number() }).strict(),
		};
		assert.throws(() =>
			encodePolicyParams(pack, { a: 1, sneaky: "x" } as unknown as { a: number }),
		);
	});

	it("rejects malformed bytes on decode", () => {
		const pack = { paramsSchema: z.object({ a: z.number() }) };
		assert.throws(() => decodePolicyParams(pack, "0x7b6e6f7461"));
	});

	it("matches the AVS-side parse path (UTF-8 JSON → serde_json::from_str shape)", () => {
		// Mirrors `newton-prover-avs/crates/core/src/common/task.rs:402-408`: the
		// AVS reads `policy_params: bytes`, runs `String::from_utf8 →
		// serde_json::from_str`, then `validate_schema(schema, value)`. If our
		// encoder produces anything that doesn't survive that path, the AVS
		// falls back to `json!({})` and rejects every call — which is exactly
		// the `vaultsfyi@0.2.0` failure this refactor exists to fix.
		const pack = {
			paramsSchema: z.object({
				required_review_answer: z.enum(["GREEN", "YELLOW", "RED"]),
				allowed_countries: z.array(z.string()),
				min_age_years: z.number().int(),
			}),
		};
		const params = {
			required_review_answer: "GREEN" as const,
			allowed_countries: ["US", "GB"],
			min_age_years: 18,
		};
		const encoded = encodePolicyParams(pack, params);

		const fromUtf8 = new TextDecoder().decode(hexToBytes(encoded));
		const parsed = JSON.parse(fromUtf8);
		assert.deepEqual(parsed, {
			allowed_countries: ["US", "GB"],
			min_age_years: 18,
			required_review_answer: "GREEN",
		});
	});
});
