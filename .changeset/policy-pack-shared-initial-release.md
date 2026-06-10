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

Patch-level bump (despite being the initial release) so the cascade through every pack's `peerDependencies` doesn't propose major bumps to packs that aren't actually changing.
