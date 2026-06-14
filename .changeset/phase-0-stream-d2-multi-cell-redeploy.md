---
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

chore: Stream D2 multi-cell redeploy (NEWT-1539 Phase 0 follow-up)

Fills out the env axis added in PR #51 by deploying every pack to the
three remaining `(chainId, env)` cells. The 4-cell matrix is now:

| Cell | Status |
|---|---|
| (Sepolia, stagef) | Stream D, in 2.0.0 |
| (Sepolia, prod) | This PR |
| (Base Sepolia, stagef) | This PR |
| (Base Sepolia, prod) | This PR |

Each pack now has 4 `Deployment` records, one per cell. The Shield SDK
(once it bumps to `policy-pack-shared@^0.4.0` and adds the env arg)
will resolve the right policy address for any `(chainId, env)` pair
without curators needing to override `policyClientAddress`.

Per-pack address rotations are visible in `deployments.json` under
`packs.<pack>.{11155111,84532}.{stagef,prod}`. WASM CIDs and
`policyCodeHash` are unchanged across cells (same source policy.js
componentized once, deployed N times).

Per-pack `<pack>/dist/policy_cids.json` reflects the most recent
deploy (Base Sepolia prod). Earlier cells' CIDs are captured in the
deployment.log files and round-trippable from `<pack>/policy.rego` +
`policy_metadata.json` (`policyCodeHash` is keccak256 of the .rego
source per newton-cli's policy_files.rs:322-327).

Out of scope:
- Shield SDK migration to env-aware lookup → newton-shield PR.
- `OracleModule` per-pack export → Phase 1 (NEWT-1540).
- Composite manifest format → Phase 1.5 (NEWT-1541).
- `defineComposite` builder → Phase 2 (NEWT-1542).
