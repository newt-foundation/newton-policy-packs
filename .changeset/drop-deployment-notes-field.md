---
"@newton-xyz/policy-pack-shared": major
"@newton-xyz/policy-pack-balancer": major
"@newton-xyz/policy-pack-blockaid": major
"@newton-xyz/policy-pack-chainalysis": major
"@newton-xyz/policy-pack-guardrail": major
"@newton-xyz/policy-pack-persona": major
"@newton-xyz/policy-pack-redstone": major
"@newton-xyz/policy-pack-sumsub": major
"@newton-xyz/policy-pack-vaultsfyi": major
"@newton-xyz/policy-pack-webacy": major
---

Drop `notes` field from `Deployment` schema.

The field carried no protocol load (not used by `getDeployment` lookup, CREATE2 derivation, or attestation flow) and the merge path in `sync-deployments.sh` overwrote every pack's notes on every sync, muddying provenance. Canonical sources for deploy provenance already exist (git blame on `deployments.json`, per-pack `deployment.log` audit trail, the PR description).

Breaking change: `Deployment.notes` is no longer part of the public type or the runtime shape exported by every per-pack `deployments` object. Major bump cascades to all 9 packs per ADR 0001.
