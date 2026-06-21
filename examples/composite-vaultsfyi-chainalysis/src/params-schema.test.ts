import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { chainalysis } from "@newton-xyz/policy-pack-chainalysis";
import {
	generateCompositeParamsSchema,
	oracleModuleFromPack,
} from "@newton-xyz/policy-pack-shared";
import { vaultsfyi } from "@newton-xyz/policy-pack-vaultsfyi";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = resolve(__dirname, "..", "params_schema.json");

// Anti-drift guard for the committed `params_schema.json` (NEWT-1561 / the
// mainnet `Missing required property 'vaultsfyi' at ''` regression). The
// example's schema is the manifest ENVELOPE the AVS validates the on-chain
// `policyParams` blob against as-is — it MUST be the byte-for-byte output of
// `generateCompositeParamsSchema` for this composite's modules, not a
// hand-written inner-shape schema. CI doesn't unit-test, so this runs via
// `pnpm -r test` locally; if it ever diverges, regenerate the file from the
// modules below.
describe("composite-vaultsfyi-chainalysis params_schema.json", () => {
	const modules = [oracleModuleFromPack(vaultsfyi), oracleModuleFromPack(chainalysis)];

	it("is byte-identical to generateCompositeParamsSchema output for {vaultsfyi, chainalysis}", () => {
		const want = generateCompositeParamsSchema({ modules });
		const committed = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
		assert.deepEqual(
			committed,
			want,
			"params_schema.json drifted from the generator — regenerate it: " +
				"`generateCompositeParamsSchema({ modules: [vaultsfyiOracleModule, chainalysisOracleModule] })`.",
		);
	});

	it("describes the manifest envelope (root keys), not the inner params shape", () => {
		const committed = JSON.parse(readFileSync(SCHEMA_PATH, "utf8")) as {
			required: string[];
			properties: Record<string, unknown>;
		};
		// The regression was a schema whose root required `["vaultsfyi","chainalysis"]`.
		// The correct envelope requires the manifest keys; the per-pack slices live
		// under `params.<shortId>`.
		assert.deepEqual([...committed.required].sort(), ["_manifest", "modules", "params"]);
	});
});
