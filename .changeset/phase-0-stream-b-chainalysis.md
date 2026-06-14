---
"@newton-xyz/policy-pack-chainalysis": major
---

feat(chainalysis)!: pack-side namespacing for composite-policy-packs (NEWT-1539 Phase 0 Stream B)

Fourth Stream B per-pack PR. Replicates the pattern locked in
[#41 (vaultsfyi)](https://github.com/newt-foundation/newton-policy-packs/pull/41).

What changed in `chainalysis/`:

- `policy.js` wraps both return paths under `PACK_ID = "chainalysis"`
  via a local `wrapOutput(packId, valueOrError)` helper.
- `policy.js` reads inputs through an unwrap shim
  (`parsed[PACK_ID] ?? parsed`) and strips its own slot from `_secrets`
  before `loadHostSecrets()`.
- `policy.rego` reads from `data.wasm.chainalysis.<field>`. Load-bearing
  case for chainalysis: vaultsfyi emits `risk_score` as a number,
  chainalysis emits it as a string — pre-namespacing these would silently
  clobber under `merge_jsons` last-wins.
- New `wrapping_test.rego` (TDD-first) asserts each deny rule reads from
  `data.wasm.chainalysis.*`; flat input does NOT trigger any deny
  (silent-skip pattern — every chainalysis deny rule has an explicit
  precondition that fails-skip when `v` is undefined); cross-pack
  composition with vaultsfyi's `risk_score: 10` (number) and blockaid's
  `classification: "Malicious"` does not affect chainalysis's deny set.
- `policy_test.rego` (existing 10 tests) wraps fixtures under the
  `chainalysis` key.
- New `packages/policy-pack-chainalysis/src/pack-id.test.ts` asserts
  `PACK_ID === PACK_NAME === "chainalysis"`.
- `scripts/lint-policy-js.allowlist.json` drops chainalysis's 2
  grandfathered entries (lines 126, 137).

Out of scope (deferred to later streams):

- WASM rebuild via `jco componentize` and on-chain redeploy → Stream D.
- npm publish of the major bump → Stream E.
- HTTP status check is already present in chainalysis's `getJson` /
  `getSanctionsResult` / `getAddressScreening` (status >= 400 throws);
  no cross-pack input hardening needed for this pack.
- `OracleModule` interface + per-pack export → Phase 1 (NEWT-1540).
- Composite manifest format + decode helpers → Phase 1.5 (NEWT-1541).
- `defineComposite` builder + Shield SDK migration → Phase 2 (NEWT-1542).
