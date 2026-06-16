---
"@newton-xyz/policy-pack-shared": patch
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

Drop the `policy` field from `Deployment` / `deployments.json`.

A pack ships a reusable **oracle** (`NewtonPolicyData`), not a blessed `NewtonPolicy`. The pack's `policy.rego` is a reference that curators copy and deploy as their own policy — single-pack (one `policyData`) or composite (N). The reusable, verifiable artifacts a curator references are `policyData` + `wasmCid`; nothing in the SDK ever consumed the per-pack `policy` address.

Removes `policy` from:
- `Deployment` type in `@newton-xyz/policy-pack-shared`
- `DeploymentEntry` in `scripts/generate-bindings.ts` (codegen mirror)
- 36 entries in `deployments.json`
- 9 regenerated `packages/policy-pack-*/src/deployments.ts` bindings
- `deploy.sh` (stops deploying the per-pack single-pack `NewtonPolicy`; deploys only the `PolicyData` oracle) + `sync-deployments.sh` (stops recording `policy`)
- OPERATING.md / README.md / CONTRIBUTING.md framing (curators deploy their own policy)

Strictly a breaking type change, but no production consumers read `Deployment.policy` (only test fixtures did) — patch-bumped across the cascade so dependents stay inside the existing `^0.4.x` peer range per ADR 0001.
