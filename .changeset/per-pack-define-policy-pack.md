---
"@newton-xyz/policy-pack-balancer": major
"@newton-xyz/policy-pack-blockaid": major
"@newton-xyz/policy-pack-chainalysis": major
"@newton-xyz/policy-pack-guardrail": major
"@newton-xyz/policy-pack-persona": major
"@newton-xyz/policy-pack-redstone": major
"@newton-xyz/policy-pack-sumsub": major
"@newton-xyz/policy-pack-vaultsfyi": major
"@newton-xyz/policy-pack-webacy": major
---

Migrate every pack to `definePolicyPack` and require `@newton-xyz/policy-pack-shared` 0.8. The `<name>OracleModule` export and the bare `PolicyPack` literal are removed; `paramsJsonSchema` is now derived from the pack's zod `paramsSchema` (the derived on-chain schema is byte-identical to the previous hand-written one - no policy redeploy). Consumers importing `<name>OracleModule` must compose the pack directly instead (pass the pack to `generateCompositeParamsSchema` / `defineComposite`, which now accept the `PolicyPack` form).
