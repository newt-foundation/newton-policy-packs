// Fixture: a "bad" policy.js that bypasses `wrapOutput`. The lint guard MUST
// reject this file with at least one violation.
//
// Four violation patterns covered:
//  1. Raw `return JSON.stringify({ ... })` with an inline object literal
//     (the most common drift case)
//  2. `return JSON.stringify({ error: ... })` returning a top-level `error`
//     key — would collide across packs in the AVS merge_jsons
//  3. `return JSON.stringify(some_helper())` where the inner call is NOT
//     `wrapOutput`
//  4. `return JSON.stringify(wrapOutput(...))` — would double-escape the
//     output (wrapOutput already returns JSON-stringified envelope)

const PACK_ID = "fixture-bad";

function buildPayload(parsed) {
	return { score: parsed.score, ok: true };
}

export function run(args) {
	try {
		const parsed = JSON.parse(args);
		// Violation 1: inline object literal, not routed through wrapOutput
		return JSON.stringify({ score: parsed.score, ok: true });
	} catch (e) {
		// Violation 2: top-level `error` key — collides under merge_jsons
		return JSON.stringify({ error: String(e) });
	}
}

export function altRun(args) {
	const parsed = JSON.parse(args);
	// Violation 3: indirect helper call, not wrapOutput
	return JSON.stringify(buildPayload(parsed));
}

export function doubleEscaped(args) {
	const parsed = JSON.parse(args);
	// Violation 4: would double-escape — wrapOutput already returns a string
	return JSON.stringify(wrapOutput(PACK_ID, parsed));
}
