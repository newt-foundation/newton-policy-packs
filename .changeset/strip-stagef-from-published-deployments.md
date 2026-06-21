---
"@newton-xyz/policy-pack-balancer": minor
"@newton-xyz/policy-pack-blockaid": minor
"@newton-xyz/policy-pack-chainalysis": minor
"@newton-xyz/policy-pack-guardrail": minor
"@newton-xyz/policy-pack-persona": minor
"@newton-xyz/policy-pack-redstone": minor
"@newton-xyz/policy-pack-sumsub": minor
"@newton-xyz/policy-pack-vaultsfyi": minor
"@newton-xyz/policy-pack-webacy": minor
---

Stop publishing the internal `stagef` env in each pack's `deployments` map.

`stagef` is internal staging infrastructure. The generated `deployments.ts` now ships only `prod` cells; the repo-root `deployments.json` keeps the full record (including `stagef`) as the internal audit trail. External consumers reading `pack.deployments[chainId].stagef` will get `undefined` — use `prod`, or `getDeployment(pack, chainId, "prod")`. Each chain that had a `prod` deployment is unaffected; chains that only had `stagef` no longer appear in the published map.
