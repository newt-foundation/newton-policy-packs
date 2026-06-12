---
"@newton-xyz/policy-pack-sumsub": major
---

Add hand-written `pack.ts` exporting `sumsub: PolicyPack<Params, WasmArgs, Secrets>` so curators can pass it directly to `createShield(...)` from `@newton-xyz/newton-shield-sdk`. `prepareQuery` reads `walletAddress` from the SDK's per-call options bag (typically `IntentArgs.from`).

The `required_review_answer` enum (`"GREEN" | "YELLOW" | "RED"`) round-trips as a plain JSON string through the canonical `encodePolicyParams` utility from `@newton-xyz/policy-pack-shared@^0.2.0` — see NEWT-1516.

NEWT-1511.
