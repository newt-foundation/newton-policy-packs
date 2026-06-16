# @newton-xyz/policy-pack-shared

## 0.4.1

### Patch Changes

- ffee4cf: Drop `notes` field from `Deployment` schema.

  The field carried no protocol load (not used by `getDeployment` lookup, CREATE2 derivation, or attestation flow) and the merge path in `sync-deployments.sh` overwrote every pack's notes on every sync, muddying provenance. Canonical sources for deploy provenance already exist (git blame on `deployments.json`, per-pack `deployment.log` audit trail, the PR description).

  Strictly a breaking type change, but no production consumers exist yet — clean migration. Patch-bumped across the cascade so dependent packs stay inside the existing `^0.4.0` peer range on `@newton-xyz/policy-pack-shared` (avoids the pre-1.0 caret-rule cascade where a minor on shared would force a major on every dependent).

## 0.4.0

### Minor Changes

- f11252c: feat(shared): add env axis to deployments shape (NEWT-1539 Phase 0 follow-up)

  The same `(pack, chainId)` cell can now hold separate deployments under
  each Newton AVS env (`stagef`, `prod`). The Newton Gateway routes per-env
  to distinct TaskManager addresses + operator sets; the same pack policy
  deployed under `stagef` will not be evaluated by `prod` operators and
  vice versa. The previous shape — one `Deployment` per `chainId` —
  forced curators to override `policyClientAddress` to switch envs.

  Schema changes (no production consumers, clean migration):

  - `policy-pack-shared`:
    - New `GatewayEnv = "stagef" | "prod"` type export.
    - `PolicyPack.deployments` is now `Partial<Record<ChainId, Partial<Record<GatewayEnv, Deployment>>>>`
      (was `Partial<Record<ChainId, Deployment>>`).
    - `getDeployment(pack, chainId, env)` adds the env arg.
    - New `UnsupportedEnvError` distinguishes "this chain has entries but
      not the env you asked for" from `UnsupportedChainError`. The
      recovery is different: the curator either picks a different env
      (typo / wrong gateway) or asks the AVS team to deploy the pack
      into that env.
    - 5 new test cases in `pack.test.ts` covering hit / single-env / chain-miss
      / env-miss / multi-chain-error branches.
  - `deployments.json` schema bumped v1 → v2:
    - `packs.<name>["11155111"]` was a flat `Deployment`; now it's
      `{ stagef: Deployment, prod?: Deployment }`. Existing 9 stagef
      Sepolia entries migrated under `.stagef` keys.
    - New top-level `envs` map labels each AVS env.
  - `scripts/sync-deployments.sh`: `--env <stagef|prod>` is now required.
    No safe default — the env is part of the cell key.
  - `scripts/generate-bindings.ts`: `emitDeployments` outputs the new
    env-keyed shape; per-pack `src/deployments.ts` regenerated.

  `pnpm changeset status` will warn that the per-pack peer-dep references
  `^0.4.0` while the latest released `policy-pack-shared` is `0.3.0`. This
  is expected — the warning compares against the _published_ version, not
  the pending bump in this PR. Once the changesets bot publishes the
  release PR, the warning resolves itself.

  The `gen:bindings` step emits files with biome-default formatting
  (2-space, double-quoted keys); committed sources use the project's
  biome config (tabs, unquoted keys where valid). The canonical
  post-codegen step is `pnpm gen:bindings && pnpm lint:fix` — running
  either in isolation produces a partial state.

  Out of scope:

  - Shield SDK migration to the new `getDeployment` signature → newton-shield PR.
  - Deploys for the new `(chainId, env)` cells (Sepolia/prod, Base Sepolia/stagef,
    Base Sepolia/prod) → Stream D2 follow-up.
  - `OracleModule` interface + per-pack export → Phase 1 (NEWT-1540).
  - Composite manifest format + decode helpers → Phase 1.5 (NEWT-1541).
  - `defineComposite` builder → Phase 2 (NEWT-1542).

## 0.3.0

### Minor Changes

- ac73d21: feat(shared): add `wrapOutput(packId, valueOrError)` helper for pack-side namespacing

  Phase 0 Stream A of [NEWT-1539](https://linear.app/magiclabs/issue/NEWT-1539)
  composite policy packs rework. Adds the canonical helper every pack's
  `policy.js` must call on every return path (success AND error) so the AVS-side
  shallow `merge_jsons` composes cleanly across packs without top-level key
  collisions.

  Pure additive; no breaking changes.

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
