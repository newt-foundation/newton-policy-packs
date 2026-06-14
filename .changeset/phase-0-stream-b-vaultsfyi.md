---
"@newton-xyz/policy-pack-vaultsfyi": major
---

feat(vaultsfyi)!: pack-side namespacing for composite-policy-packs (NEWT-1539 Phase 0 Stream B)

First Stream B per-pack PR ([Phase 0 § Stream B](https://linear.app/magiclabs/issue/NEWT-1539)
of the composite-policy-packs refactor [NEWT-1534](https://linear.app/magiclabs/issue/NEWT-1534)).
Establishes the inline-`PACK_ID` + inline-`wrapOutput` pattern the remaining
8 packs replicate.

What changed in `vaultsfyi/`:

- `policy.js` now wraps every return path under `PACK_ID = "vaultsfyi"` via
  a local `wrapOutput(packId, valueOrError)` helper, mirroring the canonical
  `@newton-xyz/policy-pack-shared` `wrapOutput`. Inlined (not imported)
  because `policy.js` is fed straight to `jco componentize` with only the
  `newton:provider/*` host imports wired — there is no npm bundler step.
  The helper uses an indirect-return form so the AST-lint guard
  (`scripts/lint-policy-js.ts`, Phase 0 Stream C) accepts it.
- `policy.js` now reads its inputs through an unwrap shim
  (`parsed[PACK_ID] ?? parsed`) so it accepts both the composite envelope
  shape (`{ "vaultsfyi": { network, vaultAddress, ... } }`) and the legacy
  flat shape during the migration window.
- `policy.rego` now reads from `data.wasm.vaultsfyi.<field>` instead of
  `data.wasm.<field>`, so AVS-side `merge_jsons` composition across packs
  no longer collides on shared keys (e.g. vaultsfyi's `risk_score: number`
  vs chainalysis's `risk_score: string`).
- New `wrapping_test.rego` locks the Rego-side namespacing contract: every
  deny rule must read from `data.wasm.vaultsfyi.*`; a flat un-namespaced
  fixture must NOT trigger any rule; cross-pack composition fixtures must
  not interfere.
- `policy_test.rego` (existing 13 tests) now wraps its fixtures under the
  `vaultsfyi` key so the pre-existing rule-by-rule coverage stays intact
  under the new shape.

What this means for consumers:

- **Major bump.** The new PolicyData address (deployed in Stream D) and
  WASM CID will be different from today's. Curators consuming
  `@newton-xyz/policy-pack-vaultsfyi` must upgrade. There are no external
  curator integrations against the existing PolicyData address per the
  Phase 0 pre-flight (confirmed 2026-06-13).
- The `paramsSchema` / `wasmArgsSchema` / `secretsSchema` shapes are
  unchanged. Only the on-chain artifacts (PolicyData address + WASM CID +
  the rego/js source) move.

Out of scope (deferred to later streams):

- WASM rebuild via `jco componentize` and on-chain redeploy of the new
  PolicyData / Policy addresses → Stream D (batch across all 9 packs).
- npm publish of the major bump → Stream E (sequential after Stream D).
- `OracleModule` interface + per-pack export → Phase 1 (NEWT-1540).
- Composite manifest format + decode helpers → Phase 1.5 (NEWT-1541).
- `defineComposite` builder + Shield SDK migration → Phase 2 (NEWT-1542).
