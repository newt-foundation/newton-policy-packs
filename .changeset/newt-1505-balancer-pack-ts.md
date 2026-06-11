---
"@newton-xyz/policy-pack-balancer": major
---

Add hand-written `pack.ts` exporting `balancer: PolicyPack<Params, WasmArgs, Secrets>` so curators can pass it directly to `createShield(...)` from `@newton-xyz/newton-shield-sdk`. No `prepareQuery`: `wasmArgs` (`poolId`, `chain`, optional `allowed_token_addresses`) is curator-supplied at intent-build time.

Encoding for the on-chain `policyParams` blob uses the canonical `encodePolicyParams` / `decodePolicyParams` utility from `@newton-xyz/policy-pack-shared@^0.2.0` (UTF-8 JSON, sorted keys) — see NEWT-1516.

NEWT-1505.
