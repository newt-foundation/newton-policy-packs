/**
 * Wrap a pack's WASM oracle output under its top-level `PACK_ID` key. Every
 * `policy.js` MUST call this on every return path (success AND error) so the
 * AVS-side `merge_jsons` (`newton-prover-avs/crates/operator/src/simulation.rs:296`)
 * composes cleanly across packs without top-level key collisions.
 *
 * The merge is shallow + last-wins: pre-namespacing, vaultsfyi's
 * `risk_score: number` would silently clobber chainalysis's `risk_score: string`
 * under composition. After namespacing, every pack's output sits under its
 * unique `PACK_ID` key and merges into a single `data.wasm` blob that
 * composite Rego can reference unambiguously as `data.wasm.<pack-id>.<field>`.
 *
 * The contract this helper locks:
 * - **Output is JSON-stringified** so `policy.js` can `return wrapOutput(...)`
 *   directly. The AVS host parses every PolicyData WASM's stdout as UTF-8
 *   JSON before merging.
 * - **Top-level keys are exactly `[packId]`** — assertable in
 *   `<pack>/wrapping_test.rego` with a fixture `data.wasm.<pack-id>` shape.
 *   To be enforced at PR time by an AST-lint CI guard (Phase 0 § Stream C,
 *   shipped in a separate PR) that flags any raw `return JSON.stringify(...)`
 *   callsite in `<pack>/policy.js` not routed through this helper.
 * - **`undefined` and other JSON-nonrepresentable payloads** (functions,
 *   symbols) cause `JSON.stringify` to omit the key, returning `'{}'` rather
 *   than `{ [packId]: undefined }`. The AVS contract doesn't admit such
 *   payloads — every `policy.js` returns either a structured success object
 *   or `{ error: "..." }` — so this is documented as out-of-contract input
 *   rather than guarded at runtime. The Stream C AST-lint catches the
 *   shape upstream.
 * - **Both success and error paths route through here.** Returning
 *   `{"error": "..."}` directly from `policy.js` would collide across packs in
 *   `merge_jsons` (every pack's error key would land at the top level and
 *   the last one wins). Wrapping the error under `[packId]` keeps per-pack
 *   error semantics (composite Rego can selectively deny on
 *   `data.wasm.<pack-id>.error`).
 *
 * @param packId The pack's stable id, matching the `<name>OracleModule.id`
 *               that ships in Phase 1 and the `KNOWN_PACK_IDS` registry in
 *               Phase 2. Convention: lowercase single-word, matches the
 *               pack's folder name (e.g. `"vaultsfyi"`, `"chainalysis"`).
 * @param valueOrError The pack's output payload — `{ score, risk_score, ... }`
 *                     for success, `{ error: "..." }` for failure paths.
 *                     Untyped at this layer because each pack's WASM emits
 *                     its own shape and the `PolicyPack` /  `OracleModule`
 *                     interfaces today carry input schemas (`paramsSchema`,
 *                     `wasmArgsSchema`, `secretsSchema`) but no on-chain
 *                     output schema — composite Rego references fields by
 *                     name (`data.wasm.<pack-id>.<field>`) and trusts the
 *                     pack-specific WASM bindings paired to each
 *                     `wasm_cid` in the manifest (Phase 1.5).
 * @returns JSON-stringified `{ [packId]: valueOrError }` ready to drop into
 *          a `policy.js` `return` statement.
 *
 * @example
 *   // vaultsfyi/policy.js (success path)
 *   return wrapOutput("vaultsfyi", { score: 80, risk_score: 75, timestamp });
 *   // → '{"vaultsfyi":{"score":80,"risk_score":75,"timestamp":...}}'
 *
 *   // vaultsfyi/policy.js (error path)
 *   return wrapOutput("vaultsfyi", { error: String(e) });
 *   // → '{"vaultsfyi":{"error":"..."}}'  — namespaced, won't collide
 */
export function wrapOutput(packId: string, valueOrError: unknown): string {
	return JSON.stringify({ [packId]: valueOrError });
}
