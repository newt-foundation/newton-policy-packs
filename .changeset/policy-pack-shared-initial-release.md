---
"@newton-xyz/policy-pack-shared": patch
---

Initial release of `@newton-xyz/policy-pack-shared`.

Defines the canonical typed contract every published `@newton-xyz/policy-pack-<name>` package implements:

- `PolicyPack<TParams, TWasmArgs, TSecrets>` interface
- `Deployment` and `ChainId` types mirroring the per-pack-per-chain entries in `deployments.json`
- `PrepareQueryArgs` and `PrepareQueryResult` for `prepareQuery`-driven packs
- `getDeployment(pack, chainId)` safe-lookup helper
- `UnsupportedChainError` thrown by the helper when a pack isn't deployed on the requested chain

Consumed by `@newton-xyz/newton-shield-sdk` as a peer dependency. Curators bind a `PolicyPack` to a Shield clone via the SDK's `createShield(...)`.

Patch-level bump on first publish: `package.json` already carries `0.1.0` and no version has shipped to npm, so any changeset level (patch / minor) lands the same `0.1.1` first version on the registry. Patch is fine.
