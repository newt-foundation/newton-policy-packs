---
"@newton-xyz/policy-pack-redstone": major
---

Add hand-written `pack.ts` exporting `redstone: PolicyPack<Params, WasmArgs, Secrets>` so curators can pass it directly to `createShield(...)` from `@newton-xyz/newton-shield-sdk`. `prepareQuery` accepts the curator-configured `symbol`, `rpcUrl`, `onchainOracle` (`{ address, selector, decimals? }`), optional `provider`, and the prior-call `prevSnapshot` (`{ divergenceBp, timestampMs }`) via the per-call options bag. The snapshot drives sustained-divergence tracking — mirrors VaultsFYI's `previousAllocationHash` freshness pattern.

Encoding for the on-chain `policyParams` blob uses the canonical `encodePolicyParams` / `decodePolicyParams` utility from `@newton-xyz/policy-pack-shared@^0.2.0` — see NEWT-1516.

NEWT-1510.
