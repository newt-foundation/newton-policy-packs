# @newton-xyz/policy-pack-shared

## 0.6.1

### Patch Changes

- d664ad4: Fix `getPolicyConfig` ABI: the on-chain read declared a phantom four-field
  return tuple `(bytes32 policyId, bytes policyParams, uint32 expireAfter,
uint8 expireUnit)`, but the canonical AVS `INewtonPolicy.PolicyConfig` is the
  two-field struct `(bytes policyParams, uint32 expireAfter)` — neither
  `policyId` nor `expireUnit` exists on it. The wrong ABI made viem misread the
  return data (`expireAfter` landed where a dynamic-bytes offset was expected),
  throwing `IntegerOutOfRangeError` against every correctly-deployed policy. This
  broke `introspectComposite` and `getPolicyManifest` (and any attach-time
  binding check that walks the same read path). Corrected the ABI in both
  `composite-introspect.ts` and `get-policy-manifest.ts` to the two-field tuple.
  No API change — `policyId` is already sourced from the separate
  `getPolicyId(client)` call, and the removed fields were never read.

## 0.6.0

### Minor Changes

- a26fe27: Move the data-source override from the shared interface to per-pack options.

  The `0.5.0` release added generic `dataSourceChainId` / `dataSourceSubject`
  fields to the shared `PrepareQueryArgs`. That was the wrong layer: each pack's
  `wasm_args` are unique, so a generic base-interface override doesn't fit — the
  responsibility to support (and shape) an override belongs to each pack.

  - `PrepareQueryArgs` is now minimal again: `{ publicClient, target }`. The two
    `dataSource*` fields are **removed**, and the entity field is renamed
    `subject` → **`target`** (the manager action's on-chain target — clearer than
    the too-vague `subject` that 0.5.0 introduced).
  - Packs that read an external data source keyed on chain/vault now expose their
    own override in their `prepareQuery` `options`, matching that pack's own
    `wasm_args`: **vaultsfyi** accepts `{ network?, vaultAddress? }` (the
    vaults.fyi slug + vault), **guardrail** accepts `{ chainId?, vaultAddress? }`.
    Curators pass them via the SDK's per-call `prepareQueryOptions` keyed by short
    pack id, e.g. `{ vaultsfyi: { network: "mainnet", vaultAddress: "0x…" } }`.

  The behavior is unchanged when no override is passed (production path).

  **Breaking:** consumers reading `dataSourceChainId` / `dataSourceSubject` off
  `PrepareQueryArgs` must move to the relevant pack's `options`. Per ADR 0001 the
  breaking shared change cascades across the per-pack packages. Pre-launch with no
  production consumers: `shared` `0.5.0` → `0.6.0` (pre-1.0, breaking = minor);
  each pack `3.0.0` → `4.0.0` (changesets escalates peer dependents to major when
  the new shared version leaves their range).

## 0.5.0

### Minor Changes

- 05f4183: Rename `PrepareQueryArgs.vault` → `subject` and add data-source overrides.

  `PrepareQueryArgs` (the input every pack's `prepareQuery` receives) renamed its
  `vault: Address` field to `subject: Address`. Most packs don't operate on a
  vault — Chainalysis screens a depositor address, RedStone reads a price feed —
  so the shared interface no longer bakes in one pack family's noun. `subject` is
  the on-chain entity the evaluation concerns; for a vault-risk pack (VaultsFYI,
  Guardrail) that is still the vault.

  Two new optional fields support testing on non-production networks where a
  pack's external data source has no coverage:

  - `dataSourceChainId?: number` — resolve the pack's external data source against
    this chain instead of `publicClient.chain.id`.
  - `dataSourceSubject?: Address` — use this address as the data-source key
    instead of `subject`.

  VaultsFYI and Guardrail honor both (their data sources index production
  networks only, so a testnet curator can point the lookup at a real mainnet
  vault while the Shield executes on a testnet). This decouples the oracle's data
  from the executed entity, so it is a testing/demo affordance — production
  callers leave both unset. See `docs/CONTRIBUTING.md` for the full definition.

  **Breaking:** consumers constructing `PrepareQueryArgs` (or calling a composite's
  `prepareQuery`) must pass `subject` instead of `vault`. Per ADR 0001 this is a
  breaking change to the shared interface, so it cascades a **major** bump to every
  per-pack package (they move 2.0.x → 3.0.0; `shared` itself is pre-1.0, so its
  breaking bump is `0.4.6` → `0.5.0`). Anyone who reads `vault` off `PrepareQueryArgs`
  — in a pack's `prepareQuery` or a direct caller — must replace that use with
  `subject`.

## 0.4.6

### Patch Changes

- 1e00699: Add `allowUnknownPackIds` opt-out to `defineComposite`

  `defineComposite` rejects any module whose short id isn't in `KNOWN_PACK_IDS`
  (`UnknownPackIdError`), which locks out curators composing a bespoke or
  unpublished pack. The new optional `allowUnknownPackIds?: boolean` (default
  `false`) on `DefineCompositeArgs` skips that membership gate when `true`.

  The flag relaxes ONLY the registry gate — the duplicate-short-id guard and every
  on-chain check (`getPolicyData()` set-match, `getWasmCid()` identity) still run.
  Additive and default-off, so existing callers are unaffected and typo/desync
  detection stays on for the published packs.

## 0.4.5

### Patch Changes

- 0f44630: `defineComposite` now auto-reorders modules to match the on-chain `getPolicyData()` order

  Curators no longer have to pass `modules` in the same order as the deployed
  `--policy-data-address` flags. `defineComposite` reads `getPolicyData()` and
  aligns the `modules` array to it by address membership, so the emitted manifest
  is always position-correct (`PolicyValidationLib.sol` enforces positional
  equality on-chain). The security binding is unchanged — the module **set** must
  match the deployed oracles, and the historical-pin `getWasmCid()` identity check
  still binds each pinned address to its module.

  A genuine set mismatch (an on-chain oracle no provided module covers) now throws
  the new `CompositeModuleSetMismatchError`. `PolicyDataOrderingMismatchError` is
  retained as an exported symbol for API stability but is no longer thrown
  (deprecated; slated for removal in the next major).

- 6dcb024: Drop the `policy` field from `Deployment` / `deployments.json`.

  A pack ships a reusable **oracle** (`NewtonPolicyData`), not a blessed `NewtonPolicy`. The pack's `policy.rego` is a reference that curators copy and deploy as their own policy — single-pack (one `policyData`) or composite (N). The reusable, verifiable artifacts a curator references are `policyData` + `wasmCid`; nothing in the SDK ever consumed the per-pack `policy` address.

  Removes `policy` from:

  - `Deployment` type in `@newton-xyz/policy-pack-shared`
  - `DeploymentEntry` in `scripts/generate-bindings.ts` (codegen mirror)
  - 36 entries in `deployments.json`
  - 9 regenerated `packages/policy-pack-*/src/deployments.ts` bindings
  - `deploy.sh` (stops deploying the per-pack single-pack `NewtonPolicy`; deploys only the `PolicyData` oracle) + `sync-deployments.sh` (stops recording `policy`)
  - OPERATING.md / README.md / CONTRIBUTING.md framing (curators deploy their own policy)

  Strictly a breaking type change, but no production consumers read `Deployment.policy` (only test fixtures did) — patch-bumped across the cascade so dependents stay inside the existing `^0.4.x` peer range per ADR 0001.

- f934443: Bind the historical-pin `wasmCid` check to module identity

  `defineComposite`'s historical-pin path now runs two checks per module: (a) the
  pinned address serves the claimed cid (unchanged), and (b) the claimed cid is
  one the module actually produced — `{wasmCid} ∪ priorWasmCids` from the pack's
  deployment record. Together they bind a pinned `(address, cid)` to the module's
  identity, closing a gap where a curator could pair a module's id with a foreign
  oracle's self-consistent address+cid.

  Adds an optional `priorWasmCids` field to `Deployment` (recorded by
  `sync-deployments.sh` on each redeploy, passed through by the bindings codegen)
  and a new `PinnedWasmCidNotInModuleHistoryError`. Check (b) is opt-in — a cell
  with no recorded `priorWasmCids` history falls back to curator-asserted trust,
  so this is non-breaking for existing pins.

## 0.4.4

### Patch Changes

- 5143979: Composite-policy Phase 2: `defineComposite` builder + `KNOWN_PACK_IDS` registry + SDK consumption helpers (NEWT-1542). Implements the spec from PR #72.

  New exports from `@newton-xyz/policy-pack-shared`:

  - `defineComposite({ modules, chainId, env, publicClient, policyAddress, expectedPolicyDataAddresses?, expectedWasmCids? }): Promise<CompositePolicyPack>` — async curator-facing builder. Reads `INewtonPolicy.getPolicyData()` at construction time to enforce positional ordering against the modules array. Supports historical-pinning for composites deployed before a pack redeploy.
  - `encodeCompositePolicyPack(pack, params): Hex` — convenience wrapper around `encodeCompositeParams` that threads the historical bindings carried on `CompositePolicyPack`. Curators using a fresh composite get the right bytes; curators using a historical-pin get the pinned addresses.
  - `getPolicyManifest({ publicClient, shieldAddress, singlePackPack? }): Promise<PolicyManifest>` — discriminated dispatch returning `{ kind: "single-pack", params } | { kind: "composite", manifest }`. Surfaces Phase 1.5 typed errors (`NotJsonError`, `BadManifestMagicError`, `MalformedManifestError`, etc.) on corrupt input — no silent coercion.
  - `KNOWN_PACK_IDS` (`as const` literal-union) + `KnownPackId` type + `isKnownPackId` guard.
  - `HistoricalBinding` type + extended `encodeCompositeParams(pack, params, historicalBindings?)` signature.
  - 8 new typed errors: `CompositeBuilderError`, `ChainMismatchError`, `UnknownPackIdError`, `PolicyDataLengthMismatchError`, `PolicyDataOrderingMismatchError`, `PinnedWasmCidMismatchError`, `CompositePrepareQueryError`, `SinglePackParamsValidationError`.

  Composite `prepareQuery` aggregation: parallel calls to each module's `prepareQuery`, threading per-module options keyed by short pack id (e.g. `{ chainalysis: { address: ... }, redstone: { symbol, rpcUrl, onchainOracle } }`). Fail-fast on any module's rejection.

  Codegen (`scripts/generate-bindings.ts`) cross-checks `KNOWN_PACK_IDS` against the discovered pack list at regen time — a pack PR that adds the directory but forgets the registry entry fails CI before merge.

  After this lands, `docs/composite-policies.md` Phase 2 status moves from "in progress" to done — the four-phase composite-policy rollout closes.

  Patch-bumped across the cascade so dependent packs stay inside the existing `^0.4.x` peer range on `@newton-xyz/policy-pack-shared` (per ADR 0001's pre-1.0 caret-rule rationale).

## 0.4.3

### Patch Changes

- 158b0f6: Implement composite-policy manifest format (Phase 1.5, NEWT-1541). Implements the spec from PR #69.

  New exports from `@newton-xyz/policy-pack-shared`:

  - `decodeManifest(bytes): CompositeManifest` — pure decoder, no on-chain calls
  - `isCompositeManifest(bytes): boolean` — cheap pre-check (returns false on invalid bytes, never throws)
  - `encodeCompositeParams(pack, params): Hex` — sorted-key canonical-form encoder, validates per-module params against each module's `paramsSchema` before emitting
  - `introspectComposite({ publicClient, shieldAddress }): Promise<IntrospectedComposite>` — depositor verification helper. Walks `getPolicyAddress` → `getPolicyId` → `getPolicyConfig` → `decodeManifest` → on-chain `getPolicyData()` and `getWasmCid()` checks. Uses multicall when `client.chain.contracts.multicall3` is configured; falls back to N+1 sequential `readContract` calls otherwise.
  - `MANIFEST_MAGIC = "NPM1"` and `MANIFEST_MAX_SUPPORTED_VERSION = 1` constants
  - Typed error hierarchy: `NotJsonError`, `NotAManifestError`, `BadManifestMagicError`, `UnsupportedManifestVersionError`, `MalformedManifestError`, `CompositeParamsValidationError`, `ManifestDeploymentMissingError`
  - `CompositeManifest` and `MinimalCompositePack` types
  - `IntrospectCompositeArgs` and `IntrospectedComposite` types

  Codegen (`scripts/generate-bindings.ts`) now rejects packs that declare a top-level `_manifest` property in `params_schema.json` — the `_manifest` key is reserved as the composite-manifest discriminator, and a collision would break depositor verification.

  33 new tests (27 manifest + 6 introspect) cover both happy paths, error semantics, the multicall vs sequential-fallback branch split, EIP-55 vs lowercase address normalization, and positional-vs-set ordering checks.

  Patch-bumped across the cascade so dependent packs stay inside the existing `^0.4.x` peer range on `@newton-xyz/policy-pack-shared` (avoids the pre-1.0 caret-rule cascade).

## 0.4.2

### Patch Changes

- 74c1ba7: Add `OracleModule<P, W, S>` type + `oracleModuleFromPack(pack)` helper to `@newton-xyz/policy-pack-shared`, and a `<name>OracleModule` constant export from each per-pack package (Phase 1 of the composite-policy rollout, NEWT-1540).

  `OracleModule` is the strict subset of `PolicyPack` that `defineComposite(...)` (Phase 2) consumes when stacking packs into a composite manifest — `id`, the three zod schemas, and the `deployments` map; no `prepareQuery`, no `metadata`. Each pack's hand-written `pack.ts` now exports `<name>OracleModule = oracleModuleFromPack(<name>)` so the subset stays in lockstep with the underlying `PolicyPack` (no field-by-field projection that could drift).

  Patch-bumped across the cascade so dependent packs stay inside the existing `^0.4.x` peer range on `@newton-xyz/policy-pack-shared` (avoids the pre-1.0 caret-rule cascade where a minor on shared would force a major on every dependent — see ADR 0001).

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
