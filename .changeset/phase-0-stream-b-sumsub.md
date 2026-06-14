---
"@newton-xyz/policy-pack-sumsub": major
---

feat(sumsub)!: pack-side namespacing for composite-policy-packs (NEWT-1539 Phase 0 Stream B)

Eighth Stream B per-pack PR. Replicates the pattern locked in
[#41 (vaultsfyi)](https://github.com/newt-foundation/newton-policy-packs/pull/41).

What changed in `sumsub/`:

- `policy.js` wraps **all THREE return paths** under `PACK_ID = "sumsub"`
  via inline `wrapOutput` (early no-applicant, success, catch). Same
  multi-return-path shape as persona #46.
- Input-unwrap shim and `_secrets` cleanup follow the canonical pattern.
- `policy.rego` reads from `data.wasm.sumsub.<field>`.
- New `wrapping_test.rego` (TDD-first) — sumsub uses the MIXED
  negative-shape pattern (like persona/guardrail). `no_applicant` has
  the bare `not v.has_applicant` shape — fires on undefined `v`. Other
  rules silent-skip. Flat-input assertion pins
  `"no_applicant" in deny` + `count(deny) == 1` + `not allow`.
- `policy_test.rego` (existing 13 tests) wraps fixtures under the
  `sumsub` key — including the two inline-fixture tests
  (`test_deny_no_applicant`, `test_no_applicant_short_circuits`) that
  bypass `with_data`.
- New `packages/policy-pack-sumsub/src/pack-id.test.ts`.
- `scripts/lint-policy-js.allowlist.json` drops sumsub's 3
  grandfathered entries (lines 268, 294, 305).

Out of scope:

- WASM rebuild → Stream D. npm publish → Stream E.
- HTTP status check is already present in sumsub's `sumsubGet` (line 218
  throws on `status >= 400`); no per-pack input hardening needed.
- `OracleModule` / manifest / `defineComposite` → Phases 1, 1.5, 2.
