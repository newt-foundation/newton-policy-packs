---
"@newton-xyz/policy-pack-shared": patch
"@newton-xyz/policy-pack-balancer": patch
"@newton-xyz/policy-pack-blockaid": patch
"@newton-xyz/policy-pack-chainalysis": patch
"@newton-xyz/policy-pack-guardrail": patch
"@newton-xyz/policy-pack-persona": patch
"@newton-xyz/policy-pack-redstone": patch
"@newton-xyz/policy-pack-sumsub": patch
"@newton-xyz/policy-pack-vaultsfyi": patch
"@newton-xyz/policy-pack-webacy": patch
---

Add `OracleModule<P, W, S>` type + `oracleModuleFromPack(pack)` helper to `@newton-xyz/policy-pack-shared`, and a `<name>OracleModule` constant export from each per-pack package (Phase 1 of the composite-policy rollout, NEWT-1540).

`OracleModule` is the strict subset of `PolicyPack` that `defineComposite(...)` (Phase 2) consumes when stacking packs into a composite manifest — `id`, the three zod schemas, and the `deployments` map; no `prepareQuery`, no `metadata`. Each pack's hand-written `pack.ts` now exports `<name>OracleModule = oracleModuleFromPack(<name>)` so the subset stays in lockstep with the underlying `PolicyPack` (no field-by-field projection that could drift).

Patch-bumped across the cascade so dependent packs stay inside the existing `^0.4.x` peer range on `@newton-xyz/policy-pack-shared` (avoids the pre-1.0 caret-rule cascade where a minor on shared would force a major on every dependent — see ADR 0001).
