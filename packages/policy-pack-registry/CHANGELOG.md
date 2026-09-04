# @newton-xyz/policy-pack-registry

## 0.2.1

### Patch Changes

- 3ed360a: Publish deployed oracle addresses for the six Arkham and Pharos packs on Ethereum Sepolia and Base Sepolia.

  These packs shipped code-only in #100, so their `deployments` export was an empty object and nothing could resolve a `policyData` address from the SDK. Each pack now carries its `11155111` and `84532` `prod` cells, and `@newton-xyz/policy-pack-registry`'s `AUDITED_POLICY_DATA` picks up the same twelve entries.

  One `wasmCid` per pack across both chains, as the upload-once/deploy-per-cell split intends. No `stagef` cells: `newton-cli` 0.5.2's `policy-data deploy` has no env selector, and stagef is stripped from published bindings anyway, so those cells stay empty until the CLI can target that factory.

  No source, schema or Rego changes — `params`, `wasm-args` and `secrets` exports are untouched.

## 0.2.0

### Minor Changes

- a3f6d97: Re-point every oracle pack onto `@newton-xyz/policy-core`; retire `@newton-xyz/policy-pack-shared`.

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
