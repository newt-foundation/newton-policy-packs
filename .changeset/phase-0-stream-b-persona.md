---
"@newton-xyz/policy-pack-persona": major
---

feat(persona)!: pack-side namespacing for composite-policy-packs (NEWT-1539 Phase 0 Stream B)

Sixth Stream B per-pack PR. Replicates the pattern locked in
[#41 (vaultsfyi)](https://github.com/newt-foundation/newton-policy-packs/pull/41).

What changed in `persona/`:

- `policy.js` wraps **all THREE return paths** under `PACK_ID = "persona"`
  via inline `wrapOutput` (early no-inquiry return at the original line
  125, success return at 161, error catch at 174). Persona is the first
  Stream B pack with more than 2 return paths.
- Input-unwrap shim (`parsed[PACK_ID] ?? parsed`) and `_secrets`
  cleanup follow the canonical pattern.
- `policy.rego` reads from `data.wasm.persona.<field>`.
- New `wrapping_test.rego` (TDD-first) — persona uses the MIXED
  negative-shape pattern (like guardrail). Most deny rules silent-skip
  on undefined `v`, but `no_inquiry` has the bare `not v.has_inquiry`
  shape — when `v` is undefined, `not undefined` grounds true and the
  rule fires. The flat-input assertion pins `"no_inquiry" in deny` +
  `count(deny) == 1` + `not allow`.
- `policy_test.rego` (existing 16 tests) wraps fixtures under the
  `persona` key — including the two inline-fixture tests
  (`test_deny_no_inquiry`, `test_no_inquiry_short_circuits`) that
  bypass `with_data`.
- New `packages/policy-pack-persona/src/pack-id.test.ts` asserts
  `PACK_ID === PACK_NAME === "persona"`.
- `scripts/lint-policy-js.allowlist.json` drops persona's 3
  grandfathered entries (lines 125, 161, 174).

Out of scope:

- WASM rebuild → Stream D. npm publish → Stream E.
- HTTP status check is NOT yet present in persona's `getJson`. Of the
  six packs migrated so far, chainalysis and guardrail already gate on
  `status >= 400`; vaultsfyi/balancer/blockaid/persona do not. The
  cross-pack input-validation hardening sweep is tracked as a separate
  NEWT-1539 follow-up — Stream B is namespacing only. Persona's gap
  is structurally mitigated by the rego layer: a 404 JSON body parses
  to `list = { error: ... }` shape, `pickLatestApproved` returns null,
  the early no-inquiry branch emits `has_inquiry: false`, and
  `not v.has_inquiry` fires deny.
- `OracleModule` / manifest / `defineComposite` → Phases 1, 1.5, 2.
