---
"@newton-xyz/policy-pack-redstone": major
---

feat(redstone)!: pack-side namespacing for composite-policy-packs (NEWT-1539 Phase 0 Stream B)

Seventh Stream B per-pack PR. Replicates the pattern locked in
[#41 (vaultsfyi)](https://github.com/newt-foundation/newton-policy-packs/pull/41).

What changed in `redstone/`:

- `policy.js` wraps both return paths under `PACK_ID = "redstone"` via
  inline `wrapOutput` (indirect-return). Input-unwrap shim. `_secrets`
  cleanup.
- `policy.rego` reads from `data.wasm.redstone.<field>`.
- New `wrapping_test.rego` (TDD-first) — redstone uses the silent-skip
  negative-shape pattern (every deny rule uses `>` / `>=` comparisons
  that fail-skip on undefined `v.<field>`). Same shape as
  vaultsfyi/balancer/chainalysis. Flat-input assertion is
  `count(deny) == 0`.
- `policy_test.rego` (existing 11 tests) wraps fixtures under the
  `redstone` key.
- New `packages/policy-pack-redstone/src/pack-id.test.ts` asserts
  `PACK_ID === PACK_NAME === "redstone"`.
- `scripts/lint-policy-js.allowlist.json` drops redstone's 2
  grandfathered entries (lines 119, 132).

Out of scope:

- WASM rebuild → Stream D. npm publish → Stream E.
- HTTP status check is NOT yet present in redstone's `getJson`/`postJson`.
  Tracked as part of the cross-pack input-validation hardening sweep.
- `OracleModule` / manifest / `defineComposite` → Phases 1, 1.5, 2.
