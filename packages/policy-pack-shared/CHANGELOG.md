# @newton-xyz/policy-pack-shared

## 0.2.0

### Minor Changes

- ff7092a: Lift `policyParams` encoding from per-pack `encodeParams` / `decodeParams` into a single canonical utility in `@newton-xyz/policy-pack-shared`. Wire format is **UTF-8 JSON with sorted keys**, which is what the AVS host already reads (`String::from_utf8 → serde_json::from_str` at `newton-prover-avs/crates/core/src/common/task.rs:402-408`). NEWT-1516.

  **Breaking — `@newton-xyz/policy-pack-shared`**: the `PolicyPack` interface no longer requires per-pack `encodeParams` / `decodeParams`. New exports `encodePolicyParams(pack, params): Hex` and `decodePolicyParams(pack, encoded): T` replace them. Sorted keys mean the same params object always produces byte-identical output, so SDK-side `verifyPolicyBinding` can byte-compare against `getPolicyConfig().policyParams`. Both functions validate via the pack's `paramsSchema`, so a curator typo or a corrupted on-chain blob throws at the SDK boundary rather than producing AVS-rejecting bytes.

  **Breaking — `@newton-xyz/policy-pack-vaultsfyi`**: dropped the pack-local ABI encoder. The on-chain wire format is now JSON, not Solidity ABI bytes. `vaultsfyi@0.2.0` was non-functional end-to-end against the AVS — it shipped `encodeAbiParameters` output that the AVS parsed as `{}` and rejected every call. Anyone who ran `setPolicy(vaultsfyi.encodeParams(...))` against the on-chain `NewtonPolicy` is on a broken clone and needs to re-issue `setPolicy` with `encodePolicyParams(vaultsfyi, params)` from the new shared package. The `RefinedParamsSchema` (sub-basis-point precision rejection) is preserved as curator-side input validation.

  This change intentionally cascades majors to all dependent packs per ADR 0001 (`docs/architecture/0001-policy-pack-shared-as-peer-dep.md`) — see "Major-bump for breaking shared changes intentionally cascades. Don't dodge that case." Follow-up tickets NEWT-1505 — NEWT-1512 add hand-written `pack.ts` files to the 8 bindings-only packs against the new interface.

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
