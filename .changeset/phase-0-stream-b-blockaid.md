---
"@newton-xyz/policy-pack-blockaid": major
---

feat(blockaid)!: pack-side namespacing for composite-policy-packs (NEWT-1539 Phase 0 Stream B)

Third Stream B per-pack PR. Replicates the pattern locked in
[#41 (vaultsfyi)](https://github.com/newt-foundation/newton-policy-packs/pull/41)
and [#42 (balancer)](https://github.com/newt-foundation/newton-policy-packs/pull/42).

What changed in `blockaid/`:

- `policy.js` wraps both return paths under `PACK_ID = "blockaid"` via a
  local `wrapOutput(packId, valueOrError)` helper (inlined; indirect-
  return form satisfies the AST-lint guard).
- `policy.js` reads inputs through an unwrap shim
  (`parsed[PACK_ID] ?? parsed`) to accept both the composite envelope
  and legacy flat shapes during the migration window.
- `policy.js` strips its own slot from `_secrets` before
  `loadHostSecrets()` so a same-named host secret can't shadow the args
  object. Sibling pack slots are intentionally left in place.
- `policy.rego` reads from `data.wasm.blockaid.<field>` instead of
  `data.wasm.<field>`. AVS-side `merge_jsons` no longer collides on
  shared keys like `classification` (chainalysis emits a different shape
  for the same field name).
- New `wrapping_test.rego` (TDD-first) locks the Rego-side namespacing
  contract: every deny rule reads from `data.wasm.blockaid.*`; a flat
  un-namespaced fixture does NOT allow (under blockaid's fail-closed
  default, several deny rules fire when the namespaced slot is missing,
  which is the correct posture); cross-pack composition (with both
  chainalysis and vaultsfyi keys at sibling depth) does not affect
  blockaid's deny set.
- `policy_test.rego` (existing 14 tests) wraps fixtures under the
  `blockaid` key.
- New `packages/policy-pack-blockaid/src/pack-id.test.ts` parses
  `policy.js` and asserts `PACK_ID === PACK_NAME === "blockaid"`. Wires
  the previously-stub `test` script to Node's native test runner +
  tsx loader.
- `scripts/lint-policy-js.allowlist.json` drops blockaid's 2
  grandfathered entries (lines 106, 117).

Out of scope (deferred to later streams):

- WASM rebuild via `jco componentize` and on-chain redeploy → Stream D.
- npm publish of the major bump → Stream E.
- HTTP status check is already present in blockaid's `postJson` /
  `scanEvmTransaction` (status >= 400 throws); no cross-pack input
  hardening needed for this pack.
- `OracleModule` interface + per-pack export → Phase 1 (NEWT-1540).
- Composite manifest format + decode helpers → Phase 1.5 (NEWT-1541).
- `defineComposite` builder + Shield SDK migration → Phase 2 (NEWT-1542).
