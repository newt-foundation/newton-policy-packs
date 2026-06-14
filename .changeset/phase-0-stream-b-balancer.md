---
"@newton-xyz/policy-pack-balancer": major
---

feat(balancer)!: pack-side namespacing for composite-policy-packs (NEWT-1539 Phase 0 Stream B)

Second Stream B per-pack PR. Replicates the pattern established in
[#41 (vaultsfyi)](https://github.com/newt-foundation/newton-policy-packs/pull/41)
verbatim.

What changed in `balancer/`:

- `policy.js` wraps every return path under `PACK_ID = "balancer"` via a
  local `wrapOutput(packId, valueOrError)` helper (inlined because
  `policy.js` is fed straight to `jco componentize` with no npm bundler
  step). Indirect-return form satisfies the AST-lint guard from
  Phase 0 § Stream C.
- `policy.js` reads its inputs through an unwrap shim
  (`parsed[PACK_ID] ?? parsed`) so it accepts both the composite envelope
  shape (`{ "balancer": { poolId, chain, ... } }`) and the legacy flat
  shape during the migration window.
- `policy.js` strips its own slot from `_secrets` before calling
  `loadHostSecrets()` so a same-named host secret can't shadow the args
  object. Sibling pack slots are intentionally left in place.
- `policy.rego` reads from `data.wasm.balancer.<field>` instead of
  `data.wasm.<field>`. AVS-side `merge_jsons` no longer collides on shared
  keys like `tvl_drawdown_24h_pct` (the load-bearing case for the
  namespacing fix — vaultsfyi and balancer both emit this field).
- New `wrapping_test.rego` (TDD-first) locks the Rego-side namespacing
  contract: every deny rule must read from `data.wasm.balancer.*`; a flat
  un-namespaced fixture must NOT trigger any rule; cross-pack composition
  fixtures (with a `vaultsfyi` slot containing extreme drawdown values)
  must not interfere with balancer's slice.
- `policy_test.rego` (existing 13 tests) wraps fixtures under the
  `balancer` key so the pre-existing rule-by-rule coverage stays intact
  under the new shape.
- New `packages/policy-pack-balancer/src/pack-id.test.ts` parses
  `policy.js` and asserts `PACK_ID === PACK_NAME === "balancer"`. Wires
  the previously-stub `test` script to Node's native test runner + tsx
  loader. Adds `tsx` to devDependencies.
- `scripts/lint-policy-js.allowlist.json` drops balancer's 2 grandfathered
  entries (lines 231, 246); allowlist shrinks across the remaining 7
  packs.

Out of scope (deferred to later streams):

- WASM rebuild via `jco componentize` and on-chain redeploy → Stream D.
- npm publish of the major bump → Stream E.
- HTTP status check in `getJson` and explicit input validation
  (chainalysis already does both; cross-pack hardening sweep tracked
  separately under NEWT-1539).
- `OracleModule` interface + per-pack export → Phase 1 (NEWT-1540).
- Composite manifest format + decode helpers → Phase 1.5 (NEWT-1541).
- `defineComposite` builder + Shield SDK migration → Phase 2 (NEWT-1542).
