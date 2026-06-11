# @newton-xyz/policy-pack-shared

## 0.1.1

### Patch Changes

- 62ad695: Widen `PolicyPack.prepareQuery` to accept an optional second `options` arg (NEWT-1499).

  ```ts
  // before
  prepareQuery?(args: PrepareQueryArgs): Promise<PrepareQueryResult<TWasmArgs>>;

  // after
  prepareQuery?(
    args: PrepareQueryArgs,
    options?: unknown,
  ): Promise<PrepareQueryResult<TWasmArgs>>;
  ```

  Concrete packs that already implement `prepareQuery(args, options)` (e.g. VaultsFYI's `options?: { previousAllocationHash?: string }`) compiled against the old 1-arg interface only because TypeScript permits adding optional parameters. The widened signature lets the SDK consumer side type-safely forward a per-call options bag through `createShield(...).sendCall(...)` without bypassing the typed builder.

  The shared interface keeps `options` typed as `unknown` so it can be forwarded verbatim — each pack narrows it in its own `prepareQuery` signature, and curators who care narrow it via the pack's own published types. Going generic (`prepareQuery?<O = void>(...)`) was rejected: bumping `PolicyPack` from 3 type params to 4 is too disruptive a churn for a 0.x change.

  Additive change. No existing 1-arg `prepareQuery` implementations break.

  Bumped at `patch` rather than `minor` to dodge the changesets cascade — every dependent pack (`policy-pack-balancer`, `-blockaid`, `-chainalysis`, `-guardrail`, `-persona`, `-redstone`, `-sumsub`, `-vaultsfyi`, `-webacy`) declares shared as a `peerDependency`, and a `minor` shared bump cascades to a `major` on each of them. Patch is semantically appropriate here (optional new parameter, no behavior change for old callers) and keeps the dependent-pack release surface stable.

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
