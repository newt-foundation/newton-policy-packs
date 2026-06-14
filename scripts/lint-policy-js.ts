/**
 * AST-lint CI guard for `<pack>/policy.js` files (Phase 0 § Stream C of
 * NEWT-1539).
 *
 * **What this enforces.** Any `return JSON.stringify(...)` callsite inside a
 * `<pack>/policy.js` file is a violation. The canonical post-Phase-0 shape is
 * `return wrapOutput(PACK_ID, payload);` directly — `wrapOutput` (from
 * `@newton-xyz/policy-pack-shared`) already returns a JSON-stringified
 * `{ [PACK_ID]: payload }`, so wrapping it again with `JSON.stringify` would
 * produce double-escaped garbage. Any path that calls `JSON.stringify`
 * explicitly in a `return` statement is bypassing the wrapper.
 *
 * **Why this is load-bearing.** The AVS host shallow-merges every PolicyData
 * WASM's stdout via `merge_jsons` (`crates/operator/src/simulation.rs:296` →
 * `crates/core/src/common/task.rs:150-158`). Last-wins on outer top-level
 * keys: pre-namespacing, vaultsfyi's `risk_score: number` would silently
 * clobber chainalysis's `risk_score: string` under composition; every pack's
 * `{"error": "..."}` would collide on the bare `error` key. The `wrapOutput`
 * helper wraps every output under `{[PACK_ID]: ...}` so composite Rego can
 * reference fields unambiguously as `data.wasm.<pack-id>.<field>`. This lint
 * guard makes it impossible to accidentally bypass the wrapper.
 *
 * **Allowlist ratchet.** The Stream B per-pack migrations haven't shipped yet,
 * so today's `<pack>/policy.js` files contain pre-namespacing violations. The
 * `lint-policy-js.allowlist.json` file pre-records them as grandfathered
 * entries. The ratchet:
 *
 *   - **NEW violations** (file:line:column not in the allowlist) fail CI.
 *   - **STALE allowlist entries** (in the file but no longer firing — i.e.
 *     the pack already migrated) ALSO fail CI, forcing deletion in the same
 *     PR. The list can only shrink.
 *   - **DUPLICATE allowlist entries** are rejected at load time. Trying to
 *     "grow" the list by re-adding an entry would otherwise silently match.
 *   - Each Stream B per-pack PR drops its pack's entries from the allowlist
 *     in the same commit that adds the `wrapOutput` calls.
 *
 * **What this DOES cover.**
 *   - Static `JSON.stringify(...)` calls (member-access form).
 *   - `JSON["stringify"](...)` (computed string-literal access — same shape).
 *   - Parse errors on `<pack>/policy.js` (treated as a violation so
 *     unbuildable files don't silently pass).
 *   - **Every `ReturnStatement`** in the file, including ones in nested
 *     helper functions — not just the top-level `run` entry. A helper that
 *     returns `JSON.stringify(...)` is either dead code or called from `run`
 *     and produces double-escaped output; both are bugs. The contract is
 *     enforced as "no `return JSON.stringify(...)` ANYWHERE in policy.js."
 *
 * **What this DOES NOT cover (known limitations).**
 *   - **Aliasing.** `const stringify = JSON.stringify; return stringify(...)`
 *     is invisible to a syntactic matcher. Acceptable for Phase 0 because
 *     it's a deliberate workaround — code review catches it.
 *   - **Indirect returns.** `const out = JSON.stringify(...); return out;`
 *     ditto. Same code-review backstop.
 *   - **Other non-aliased evasions** that resolve to the same call but use a
 *     different syntactic shape: `globalThis.JSON.stringify(...)`,
 *     `(0, JSON.stringify)(...)` (parenthesized comma expression),
 *     `JSON.stringify.call(...)` / `.apply(...)`, `Reflect.apply(JSON.stringify, ...)`,
 *     destructured `const { stringify } = JSON`, tagged-template forms.
 *     None are common in pack code; all stand out in code review.
 *   - **Runtime output shape.** Whether the WASM actually reaches each return
 *     path with the right payload at runtime. That gap closes with a
 *     `jco`-based runtime simulation harness once host-import mocking lands —
 *     separate follow-up.
 *
 * **Scope.** Globs `<pack>/policy.js` from the repo root. Skips
 * `node_modules/`, `packages/`, `scripts/`, and any directory starting with
 * `.` (`.git`, `.changeset`, etc.). Self-tests via
 * `scripts/__fixtures__/lint-policy-js/{good,bad}.js` —
 * `pnpm lint:policy-js:test` runs the same `lintFile` against both.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Parser } from "acorn";
import { simple as walk } from "acorn-walk";

export interface Violation {
	readonly file: string;
	readonly line: number;
	readonly column: number;
	readonly snippet: string;
}

/**
 * Find every `<pack>/policy.js` file at repo root. A "pack" is any top-level
 * directory containing a `policy.js`, EXCLUDING:
 * - `node_modules/` — third-party deps
 * - `packages/` — TS bindings, not WASM source
 * - `scripts/` — including this file's fixtures
 * - any directory starting with `.` (`.git`, `.changeset`, etc.)
 */
export function findPolicyJsFiles(repoRoot: string): string[] {
	const found: string[] = [];
	for (const entry of readdirSync(repoRoot)) {
		if (
			entry.startsWith(".") ||
			entry === "node_modules" ||
			entry === "packages" ||
			entry === "scripts"
		)
			continue;
		const full = resolve(repoRoot, entry);
		try {
			if (!statSync(full).isDirectory()) continue;
		} catch {
			continue;
		}
		const policyJs = resolve(full, "policy.js");
		try {
			if (statSync(policyJs).isFile()) found.push(policyJs);
		} catch {
			// no policy.js at this top-level dir; not a pack
		}
	}
	return found.sort();
}

/**
 * Match `JSON.stringify(...)` and `JSON["stringify"](...)` call expressions.
 * The computed-access form (`JSON["stringify"]`) is a common evasion pattern
 * worth catching — both shapes resolve to the same runtime call, so both
 * produce double-escaped output if used to wrap a `wrapOutput` return.
 */
function isJsonStringifyCall(n: unknown): boolean {
	const c = n as {
		type?: string;
		callee?: {
			type?: string;
			object?: { name?: string };
			property?: { name?: string; type?: string; value?: unknown };
			computed?: boolean;
		};
	};
	if (c.type !== "CallExpression") return false;
	if (c.callee?.type !== "MemberExpression") return false;
	if (c.callee.object?.name !== "JSON") return false;

	if (c.callee.computed) {
		// `JSON["stringify"](...)` → property is a string Literal.
		return c.callee.property?.type === "Literal" && c.callee.property.value === "stringify";
	}
	// `JSON.stringify(...)` → property is an Identifier with name "stringify".
	return c.callee.property?.name === "stringify";
}

/**
 * Parse a single `policy.js` and report every `return JSON.stringify(...)`
 * callsite as a violation. The canonical shape is `return wrapOutput(PACK_ID,
 * payload);` directly — `wrapOutput` already returns a stringified JSON
 * envelope, so any explicit `JSON.stringify` in a return statement is by
 * definition wrong (would either double-escape or bypass the namespacing).
 *
 * Exported so the self-test in `lint-policy-js.test.ts` exercises the SAME
 * walker as production CI, not a duplicate copy.
 */
export function lintFile(file: string, repoRoot: string): Violation[] {
	const source = readFileSync(file, "utf8");
	const violations: Violation[] = [];

	let ast: ReturnType<typeof Parser.parse>;
	try {
		ast = Parser.parse(source, {
			ecmaVersion: 2022,
			sourceType: "module",
			locations: true,
		});
	} catch (err) {
		// Treat parse failures as violations so unbuildable `policy.js` doesn't
		// silently pass the guard.
		violations.push({
			file: relative(repoRoot, file),
			line: 0,
			column: 0,
			snippet: `parse error: ${(err as Error).message}`,
		});
		return violations;
	}

	walk(ast, {
		ReturnStatement(node: unknown) {
			const ret = node as {
				argument: unknown;
				loc?: { start: { line: number; column: number } };
			};
			if (!ret.argument) return;
			if (!isJsonStringifyCall(ret.argument)) return;

			// Any `return JSON.stringify(...)` in <pack>/policy.js is a violation,
			// regardless of what's inside. The correct shape is `return wrapOutput(...)`.
			const loc = ret.loc?.start ?? { line: 0, column: 0 };
			const snippet = source.split("\n")[Math.max(0, loc.line - 1)]?.trim().slice(0, 120) ?? "";
			violations.push({
				file: relative(repoRoot, file),
				line: loc.line,
				column: loc.column,
				snippet,
			});
		},
	});

	return violations;
}

export function lint(repoRoot: string): Violation[] {
	const files = findPolicyJsFiles(repoRoot);
	const all: Violation[] = [];
	for (const file of files) all.push(...lintFile(file, repoRoot));
	return all;
}

export interface AllowlistEntry {
	readonly file: string;
	readonly line: number;
	readonly column: number;
}

export interface Allowlist {
	readonly violations: ReadonlyArray<AllowlistEntry>;
}

/**
 * Load the allowlist file. Throws on duplicate entries — duplicates would
 * silently let the allowlist "grow" (a duplicate of an already-allowed entry
 * matches the same observed violation but doesn't trigger the stale check),
 * which violates the can-only-shrink ratchet invariant.
 */
export function loadAllowlist(repoRoot: string): Allowlist {
	const path = resolve(repoRoot, "scripts/lint-policy-js.allowlist.json");
	let parsed: { violations?: ReadonlyArray<AllowlistEntry> };
	try {
		parsed = JSON.parse(readFileSync(path, "utf8"));
	} catch {
		// No allowlist file → empty allowlist (every violation is new).
		return { violations: [] };
	}

	const violations = parsed.violations ?? [];
	const seen = new Set<string>();
	for (const v of violations) {
		const key = entryKey(v);
		if (seen.has(key)) {
			throw new Error(
				`lint-policy-js: duplicate allowlist entry ${key} in scripts/lint-policy-js.allowlist.json — the ratchet only allows the list to shrink, never grow. Deduplicate the file.`,
			);
		}
		seen.add(key);
	}
	return { violations };
}

export function entryKey(v: { file: string; line: number; column: number }): string {
	return `${v.file}:${v.line}:${v.column}`;
}

/**
 * Reconcile observed violations against the allowlist. Returns:
 *   - newViolations: in the lint output but not in the allowlist (HARD FAIL)
 *   - staleEntries: in the allowlist but not in the lint output (HARD FAIL —
 *     forces deletion so the list can only shrink)
 *   - matched: count of allowlisted-and-still-firing entries (FYI)
 */
export function reconcile(
	observed: ReadonlyArray<Violation>,
	allowlist: Allowlist,
): {
	newViolations: ReadonlyArray<Violation>;
	staleEntries: ReadonlyArray<AllowlistEntry>;
	matched: number;
} {
	const observedKeys = new Set(observed.map(entryKey));
	const allowedKeys = new Set(allowlist.violations.map(entryKey));

	const newViolations = observed.filter((v) => !allowedKeys.has(entryKey(v)));
	const staleEntries = allowlist.violations.filter((e) => !observedKeys.has(entryKey(e)));
	const matched = observed.length - newViolations.length;

	return { newViolations, staleEntries, matched };
}

/**
 * CLI entry point. Exits 0 on clean, 1 on any new violation OR stale
 * allowlist entry OR duplicate allowlist entry.
 */
function main(): void {
	const here = dirname(fileURLToPath(import.meta.url));
	const repoRoot = resolve(here, "..");
	const observed = lint(repoRoot);
	const allowlist = loadAllowlist(repoRoot);
	const { newViolations, staleEntries, matched } = reconcile(observed, allowlist);
	const files = findPolicyJsFiles(repoRoot);

	if (newViolations.length === 0 && staleEntries.length === 0) {
		const summary =
			matched === 0
				? `${files.length} pack(s) checked, no \`return JSON.stringify(...)\` callsites — every return uses \`wrapOutput\` directly`
				: `${files.length} pack(s) checked, ${matched} grandfathered violation(s) match allowlist; no new drift`;
		console.log(`✓ lint-policy-js: ${summary}`);
		return;
	}

	if (newViolations.length > 0) {
		console.error(
			`✗ lint-policy-js: ${newViolations.length} NEW violation(s) — \`return JSON.stringify(...)\` is not allowed in <pack>/policy.js. Use \`return wrapOutput(PACK_ID, payload);\` directly (\`wrapOutput\` already returns JSON-stringified output, so wrapping it with \`JSON.stringify\` would double-escape). Helper ships in @newton-xyz/policy-pack-shared (Phase 0 § Stream A).\n`,
		);
		for (const v of newViolations) {
			console.error(`  ${v.file}:${v.line}:${v.column}  ${v.snippet}`);
		}
		console.error(
			'\nFix: import { wrapOutput } from "@newton-xyz/policy-pack-shared" and replace `return JSON.stringify(payload)` with `return wrapOutput(PACK_ID, payload)`.\n',
		);
	}

	if (staleEntries.length > 0) {
		console.error(
			`✗ lint-policy-js: ${staleEntries.length} STALE allowlist entry/entries — these locations are in scripts/lint-policy-js.allowlist.json but no longer fire. Remove them in the same PR that fixes the underlying file.\n`,
		);
		for (const e of staleEntries) {
			console.error(`  ${e.file}:${e.line}:${e.column}`);
		}
		console.error(
			"\nFix: edit scripts/lint-policy-js.allowlist.json and delete the stale entries.\n",
		);
	}

	process.exit(1);
}

// Only run main() when invoked as a CLI, NOT when imported by the test file.
// `pathToFileURL` matches Windows path/slash semantics — the manual
// `file://${process.argv[1]}` template fails on Windows because Node emits
// `file:///C:/...` (three slashes + drive letter) while `process.argv[1]` is
// `C:\...`. Repo CI is Ubuntu so the bug is theoretical, but the canonical
// shape costs nothing.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	main();
}
