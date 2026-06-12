---
"@newton-xyz/policy-pack-persona": major
---

Add hand-written `pack.ts` exporting `persona: PolicyPack<Params, WasmArgs, Secrets>` so curators can pass it directly to `createShield(...)` from `@newton-xyz/newton-shield-sdk`. `prepareQuery` reads `walletAddress` from the SDK's per-call options bag (typically `IntentArgs.from`).

`allowed_countries` (ISO alpha-2 string array) round-trips cleanly through the canonical `encodePolicyParams` JSON encoder from `@newton-xyz/policy-pack-shared@^0.2.0` — see NEWT-1516.

NEWT-1509.
