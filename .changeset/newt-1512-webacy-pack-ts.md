---
"@newton-xyz/policy-pack-webacy": major
---

Add hand-written `pack.ts` exporting `webacy: PolicyPack<Params, WasmArgs, Secrets>` so curators can pass it directly to `createShield(...)` from `@newton-xyz/newton-shield-sdk`. `prepareQuery` reads the pegged-token contract `address` (plus optional `chain`/`lookback_days`) from the SDK's per-call options bag and derives the Webacy chain slug from `publicClient.chain.id`.

Encoding for the on-chain `policyParams` blob uses the canonical `encodePolicyParams` / `decodePolicyParams` utility from `@newton-xyz/policy-pack-shared@^0.2.0` — see NEWT-1516.

NEWT-1512.
