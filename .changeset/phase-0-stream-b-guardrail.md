---
"@newton-xyz/policy-pack-guardrail": major
---

feat(guardrail)!: pack-side namespacing for composite-policy-packs (NEWT-1539 Phase 0 Stream B)

Fifth Stream B per-pack PR. Replicates the pattern locked in
[#41 (vaultsfyi)](https://github.com/newt-foundation/newton-policy-packs/pull/41).

What changed in `guardrail/`:

- `policy.js` wraps both return paths under `PACK_ID = "guardrail"` via
  inline `wrapOutput` (indirect-return). Input-unwrap shim. `_secrets`
  cleanup.
- `policy.rego` reads from `data.wasm.guardrail.<field>`.
- New `wrapping_test.rego` (TDD-first) — guardrail uses a MIXED
  negative-shape pattern: most deny rules silent-skip on undefined `v`
  (like vaultsfyi/balancer/chainalysis), but
  `guardrail_health_unavailable` has the bare `not v.health_available`
  shape (like blockaid's `not v.simulation_succeeded`) — when `v` is
  undefined and `t.require_health` is true, the AND grounds true and
  this rule fires. The flat-input assertion pins this specific deny +
  `not allow`, mirroring blockaid's shape; this is the correct fail-
  closed posture (a missing pack slot should deny when the operator
  required health).
- `policy_test.rego` (existing 12 tests) wraps fixtures under the
  `guardrail` key.
- New `packages/policy-pack-guardrail/src/pack-id.test.ts` asserts
  `PACK_ID === PACK_NAME === "guardrail"`.
- `scripts/lint-policy-js.allowlist.json` drops guardrail's 2
  grandfathered entries (lines 122, 134).

Out of scope:

- WASM rebuild → Stream D. npm publish → Stream E.
- HTTP status check is already present in guardrail's `getJson` /
  `fetchAlerts` (status >= 400 throws); no per-pack input hardening
  needed for this pack.
- `OracleModule` / manifest / `defineComposite` → Phases 1, 1.5, 2.
