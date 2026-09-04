# @newton-xyz/policy-pack-arkham_risk

## 0.1.1

### Patch Changes

- 3ed360a: Publish deployed oracle addresses for the six Arkham and Pharos packs on Ethereum Sepolia and Base Sepolia.

  These packs shipped code-only in #100, so their `deployments` export was an empty object and nothing could resolve a `policyData` address from the SDK. Each pack now carries its `11155111` and `84532` `prod` cells, and `@newton-xyz/policy-pack-registry`'s `AUDITED_POLICY_DATA` picks up the same twelve entries.

  One `wasmCid` per pack across both chains, as the upload-once/deploy-per-cell split intends. No `stagef` cells: `newton-cli` 0.5.2's `policy-data deploy` has no env selector, and stagef is stripped from published bindings anyway, so those cells stay empty until the CLI can target that factory.

  No source, schema or Rego changes — `params`, `wasm-args` and `secrets` exports are untouched.
