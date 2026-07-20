---
"@newton-xyz/policy-pack-balancer": major
"@newton-xyz/policy-pack-blockaid": major
"@newton-xyz/policy-pack-chainalysis": major
"@newton-xyz/policy-pack-guardrail": major
"@newton-xyz/policy-pack-persona": major
"@newton-xyz/policy-pack-redstone": major
"@newton-xyz/policy-pack-sumsub": major
"@newton-xyz/policy-pack-vaultsfyi": major
"@newton-xyz/policy-pack-webacy": major
"@newton-xyz/policy-pack-registry": minor
---

Re-point every oracle pack onto `@newton-xyz/policy-core`; retire `@newton-xyz/policy-pack-shared`.

The foundational policy contract (the `PolicyPack` interface, the composite
manifest wire-format, the oracle-authoring factory) moved out of
`@newton-xyz/policy-pack-shared` into the new `@newton-xyz/policy-core` package
(published from the vaultkit monorepo). This fixes an ownership inversion where
the consumer's core contract lived in the provider's SDK.

Each `@newton-xyz/policy-pack-*` (BREAKING):

- Now peer-depends on `@newton-xyz/policy-core` (`>=0.2.0 <1.0.0`) instead of
  `@newton-xyz/policy-pack-shared`. Import `defineOracle` (renamed from
  `definePolicyPack`) and the policy/pack types from `@newton-xyz/policy-core`.
- `@newton-xyz/policy-pack-shared` is retired. Its published versions stay
  installable but are deprecated; migrate imports to `@newton-xyz/policy-core`.

New package `@newton-xyz/policy-pack-registry`: the provider-owned trust data
(`KNOWN_PACK_IDS` + the generated `AUDITED_POLICY_DATA` audited-address map).
Inject both into `@newton-xyz/policy-core`'s `classifyProvenance`. The
classification mechanism lives in policy-core; the trust data lives here.
