---
"@newton-xyz/policy-pack-chainalysis": major
---

Add hand-written `pack.ts` exporting `chainalysis: PolicyPack<Params, WasmArgs, Secrets>` so curators can pass it directly to `createShield(...)` from `@newton-xyz/newton-shield-sdk`. `prepareQuery` reads the screened wallet `address` from the SDK's per-call options bag (typically `IntentArgs.from`).

Encoding for the on-chain `policyParams` blob uses the canonical `encodePolicyParams` / `decodePolicyParams` utility from `@newton-xyz/policy-pack-shared@^0.2.0` — see NEWT-1516.

NEWT-1507.
