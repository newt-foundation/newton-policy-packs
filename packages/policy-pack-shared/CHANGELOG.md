# @newton-xyz/policy-pack-shared

## 0.1.0

### Minor Changes

- 302d113: Initial release of `@newton-xyz/policy-pack-shared` at version `0.1.0`.

  Defines the canonical typed contract every published `@newton-xyz/policy-pack-<name>` package implements:

  - `PolicyPack<TParams, TWasmArgs, TSecrets>` interface
  - `Deployment` and `ChainId` types mirroring the per-pack-per-chain entries in `deployments.json`
  - `PrepareQueryArgs` and `PrepareQueryResult` for `prepareQuery`-driven packs
  - `getDeployment(pack, chainId)` safe-lookup helper
  - `UnsupportedChainError` thrown by the helper when a pack isn't deployed on the requested chain

  Consumed by `@newton-xyz/newton-shield-sdk` as a peer dependency. Curators bind a `PolicyPack` to a Shield clone via the SDK's `createShield(...)`.

  Clean initial-release versioning: `package.json` is at `0.0.0`, this `minor` changeset bumps to `0.1.0` for the first npm publish. The dependent packs declare `peerDependencies: { "@newton-xyz/policy-pack-shared": "^0.1.0" }`; `changesets` updates those ranges to match the new version automatically when `changeset version` runs.
