---
"@newton-xyz/policy-pack-webacy": major
---

feat(webacy)!: pack-side namespacing for composite-policy-packs (NEWT-1539 Phase 0 Stream B — FINAL)

**Final** Stream B per-pack PR. Replicates the pattern locked in
[#41 (vaultsfyi)](https://github.com/newt-foundation/newton-policy-packs/pull/41).
Closes the 9-pack Stream B sweep.

What changed in `webacy/`:

- `policy.js` wraps both return paths under `PACK_ID = "webacy"` via
  inline `wrapOutput`. Input-unwrap shim. `_secrets` cleanup.
- `policy.rego` reads from `data.wasm.webacy.<field>`.
- New `wrapping_test.rego` (TDD-first) — webacy uses pure silent-skip
  (every deny rule has explicit precondition or comparison that
  fails-skip on undefined). Same shape as
  vaultsfyi/balancer/chainalysis/redstone. Flat-input assertion is
  `count(deny) == 0`.
- `policy_test.rego` (existing 13 tests) wraps fixtures.
- New `packages/policy-pack-webacy/src/pack-id.test.ts`.
- `scripts/lint-policy-js.allowlist.json` drops webacy's 2 grandfathered
  entries (lines 98, 113). Allowlist contains only vaultsfyi entries
  (lines 115, 144) — those land in PR #41 (vaultsfyi).

Out of scope:

- WASM rebuild → Stream D. npm publish → Stream E.
- HTTP status check is NOT yet present in webacy's `getJson`. Tracked
  as part of the cross-pack input-validation hardening sweep
  (separately, NEWT-1539 follow-up).
- `OracleModule` / manifest / `defineComposite` → Phases 1, 1.5, 2.
