---
"@newton-xyz/policy-pack-blockaid": major
---

Add hand-written `pack.ts` exporting `blockaid: PolicyPack<Params, WasmArgs, Secrets>` so curators can pass it directly to `createShield(...)` from `@newton-xyz/newton-shield-sdk`. `prepareQuery` derives the Blockaid `chain` slug from `publicClient.chain.id` and reads `from`/`to`/`value`/`data` from a typed per-call `options` bag — those mirror the on-chain transaction the depositor is about to submit and have to come from the SDK's intent context.

Encoding for the on-chain `policyParams` blob uses the canonical `encodePolicyParams` / `decodePolicyParams` utility from `@newton-xyz/policy-pack-shared@^0.2.0` — see NEWT-1516.

NEWT-1506.
