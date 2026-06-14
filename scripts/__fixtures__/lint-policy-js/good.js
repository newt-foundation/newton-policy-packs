// Fixture: a "good" policy.js that routes both success and error returns
// through `wrapOutput`. The lint guard MUST accept this file.
//
// This fixture is intentionally minimal — no host imports, no real data
// fetching, no Rego coupling. It exists to lock the AST-lint contract:
// the only thing that matters is the return-statement shape.

import { wrapOutput } from "@newton-xyz/policy-pack-shared";

const PACK_ID = "fixture-good";

export function run(args) {
	try {
		const parsed = JSON.parse(args);
		// Success path — wraps under PACK_ID
		return wrapOutput(PACK_ID, { score: parsed.score, ok: true });
	} catch (e) {
		// Error path — also wraps under PACK_ID, NOT a top-level `error` key
		return wrapOutput(PACK_ID, { error: String(e) });
	}
}
