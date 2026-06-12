---
"@newton-xyz/policy-pack-guardrail": major
---

Add hand-written `pack.ts` exporting `guardrail: PolicyPack<Params, WasmArgs, Secrets>` so curators can pass it directly to `createShield(...)` from `@newton-xyz/newton-shield-sdk`. `prepareQuery` populates `vaultAddress` from `PrepareQueryArgs.vault` and `chainId` from `publicClient.chain.id`; curators that prefer Guardrail's protocol-level alerts can pass `protocolId` via the options bag.

Encoding for the on-chain `policyParams` blob uses the canonical `encodePolicyParams` / `decodePolicyParams` utility from `@newton-xyz/policy-pack-shared@^0.2.0` — see NEWT-1516.

NEWT-1508.
