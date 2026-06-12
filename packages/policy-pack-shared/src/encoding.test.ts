import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
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

	it("rejects invalid UTF-8 on decode (matches AVS String::from_utf8)", () => {
		// `0x80` is a lone continuation byte — invalid UTF-8. AVS-side
		// `String::from_utf8` rejects with `RegoError::InvalidPolicyDataUtf8`;
		// the SDK must too, otherwise round-trip looks fine but evaluation
		// fails. Default `new TextDecoder()` would silently produce U+FFFD —
		// the encoder uses `{ fatal: true }` to match the AVS contract.
		const pack = { paramsSchema: z.object({ a: z.number() }) };
		assert.throws(() => decodePolicyParams(pack, "0x80"), TypeError);
	});

	it("rejects unknown keys on a generator-emit-shape schema (z.object().describe().strict())", () => {
		// Mirrors the chain `scripts/generate-bindings.ts` emits for
		// `ParamsSchema`: `z.object({...}).describe("...").strict()`. If a
		// future zod / generator change ever made `.strict()` after
		// `.describe()` a no-op, this test catches it before consumers ship
		// AVS-rejecting bytes.
		const pack = {
			paramsSchema: z.object({ a: z.number() }).describe("generator-shape").strict(),
		};
		assert.throws(() =>
			encodePolicyParams(pack, { a: 1, sneaky: "x" } as unknown as { a: number }),
		);
	});

	it("encodes the canonical VaultsFYI shape to a pinned hex snapshot", () => {
		// Pinned canonical encoding for the shape vaultsfyi@0.2.0 ships. If
		// `JSON.stringify`'s numeric formatting (trailing-zero handling,
		// exponent threshold, etc.) ever drifts in a way that changes the
		// bytes, this test fails at PR time — before the AVS sees it.
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
		const EXPECTED =
			"0x7b226170795f7a5f6d6178223a332c2264656e795f6f6e5f616c6c6f636174696f6e5f6368616e6765223a747275652c2264656e795f6f6e5f636f72727570746564223a747275652c2264656e795f6f6e5f637269746963616c5f666c6167223a747275652c227269736b5f73636f72655f666c6f6f72223a38352c2274766c5f64726177646f776e5f3234685f6d61785f706374223a302e30352c2274766c5f64726177646f776e5f37645f6d61785f706374223a302e327d";
		assert.equal(encodePolicyParams(pack, params), EXPECTED);
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

	// Real Rust round-trip via the `tools/avs-parity` binary. Gated on
	// `RUN_AVS_PARITY=1` so plain `pnpm test` doesn't require a Rust toolchain
	// — CI sets the env var on the workflow that already has cargo available.
	// Build the binary once with `cargo build --release` from `tools/avs-parity/`.
	const runParity = process.env.RUN_AVS_PARITY === "1";
	(runParity ? it : it.skip)(
		"matches serde_json round-trip byte-for-byte (AVS parity harness)",
		() => {
			const here = path.dirname(fileURLToPath(import.meta.url));
			const bin = path.resolve(here, "../../../tools/avs-parity/target/release/avs-parity");
			assert.ok(
				existsSync(bin),
				`avs-parity binary not built at ${bin} — run \`cargo build --release\` in tools/avs-parity/`,
			);

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

			const result = spawnSync(bin, [], { input: encoded, encoding: "utf8" });
			assert.equal(result.status, 0, `avs-parity exited ${result.status}: ${result.stderr}`);
			const roundTripped = result.stdout.trim();
			assert.equal(
				roundTripped,
				encoded,
				"serde_json round-trip diverged from SDK encoder — AVS would reject",
			);
		},
	);
});
