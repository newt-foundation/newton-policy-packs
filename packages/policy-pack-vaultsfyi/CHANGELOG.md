# @newton-xyz/policy-pack-vaultsfyi

## 2.0.2

### Patch Changes

- 10a5aea: chore: Stream D2 multi-cell redeploy (NEWT-1539 Phase 0 follow-up)

  Fills out the env axis added in PR #51 by deploying every pack to the
  three remaining `(chainId, env)` cells. The 4-cell matrix is now:

  | Cell                   | Status             |
  | ---------------------- | ------------------ |
  | (Sepolia, stagef)      | Stream D, in 2.0.0 |
  | (Sepolia, prod)        | This PR            |
  | (Base Sepolia, stagef) | This PR            |
  | (Base Sepolia, prod)   | This PR            |

  Each pack now has 4 `Deployment` records, one per cell. The Shield SDK
  (once it bumps to `policy-pack-shared@^0.4.0` and adds the env arg)
  will resolve the right policy address for any `(chainId, env)` pair
  without curators needing to override `policyClientAddress`.

  Per-pack address rotations are visible in `deployments.json` under
  `packs.<pack>.{11155111,84532}.{stagef,prod}`. WASM CIDs and
  `policyCodeHash` are unchanged across cells (same source policy.js
  componentized once, deployed N times).

  Per-pack `<pack>/dist/policy_cids.json` reflects the most recent
  deploy (Base Sepolia prod). Earlier cells' CIDs are captured in the
  deployment.log files and round-trippable from `<pack>/policy.rego` +
  `policy_metadata.json` (`policyCodeHash` is keccak256 of the .rego
  source per newton-cli's policy_files.rs:322-327).

  Out of scope:

  - Shield SDK migration to env-aware lookup → newton-shield PR.
  - `OracleModule` per-pack export → Phase 1 (NEWT-1540).
  - Composite manifest format → Phase 1.5 (NEWT-1541).
  - `defineComposite` builder → Phase 2 (NEWT-1542).

## 2.0.1

### Patch Changes

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

- Updated dependencies [f11252c]
  - @newton-xyz/policy-pack-shared@0.4.0

## 2.0.0

### Major Changes

- a4eda11: feat(vaultsfyi)!: pack-side namespacing for composite-policy-packs (NEWT-1539 Phase 0 Stream B)

  First Stream B per-pack PR ([Phase 0 § Stream B](https://linear.app/magiclabs/issue/NEWT-1539)
  of the composite-policy-packs refactor [NEWT-1534](https://linear.app/magiclabs/issue/NEWT-1534)).
  Establishes the inline-`PACK_ID` + inline-`wrapOutput` pattern the remaining
  8 packs replicate.

  What changed in `vaultsfyi/`:

  - `policy.js` now wraps every return path under `PACK_ID = "vaultsfyi"` via
    a local `wrapOutput(packId, valueOrError)` helper, mirroring the canonical
    `@newton-xyz/policy-pack-shared` `wrapOutput`. Inlined (not imported)
    because `policy.js` is fed straight to `jco componentize` with only the
    `newton:provider/*` host imports wired — there is no npm bundler step.
    The helper uses an indirect-return form so the AST-lint guard
    (`scripts/lint-policy-js.ts`, Phase 0 Stream C) accepts it.
  - `policy.js` now reads its inputs through an unwrap shim
    (`parsed[PACK_ID] ?? parsed`) so it accepts both the composite envelope
    shape (`{ "vaultsfyi": { network, vaultAddress, ... } }`) and the legacy
    flat shape during the migration window.
  - `policy.rego` now reads from `data.wasm.vaultsfyi.<field>` instead of
    `data.wasm.<field>`, so AVS-side `merge_jsons` composition across packs
    no longer collides on shared keys (e.g. vaultsfyi's `risk_score: number`
    vs chainalysis's `risk_score: string`).
  - New `wrapping_test.rego` locks the Rego-side namespacing contract: every
    deny rule must read from `data.wasm.vaultsfyi.*`; a flat un-namespaced
    fixture must NOT trigger any rule; cross-pack composition fixtures must
    not interfere.
  - `policy_test.rego` (existing 13 tests) now wraps its fixtures under the
    `vaultsfyi` key so the pre-existing rule-by-rule coverage stays intact
    under the new shape.

  What this means for consumers:

  - **Major bump.** The new PolicyData address (deployed in Stream D) and
    WASM CID will be different from today's. Curators consuming
    `@newton-xyz/policy-pack-vaultsfyi` must upgrade. There are no external
    curator integrations against the existing PolicyData address per the
    Phase 0 pre-flight (confirmed 2026-06-13).
  - The `paramsSchema` / `wasmArgsSchema` / `secretsSchema` shapes are
    unchanged. Only the on-chain artifacts (PolicyData address + WASM CID +
    the rego/js source) move.

  Out of scope (deferred to later streams):

  - WASM rebuild via `jco componentize` and on-chain redeploy of the new
    PolicyData / Policy addresses → Stream D (batch across all 9 packs).
  - npm publish of the major bump → Stream E (sequential after Stream D).
  - `OracleModule` interface + per-pack export → Phase 1 (NEWT-1540).
  - Composite manifest format + decode helpers → Phase 1.5 (NEWT-1541).
  - `defineComposite` builder + Shield SDK migration → Phase 2 (NEWT-1542).

### Patch Changes

- c9b1566: chore: Stream D Sepolia redeploy for namespaced WASM (NEWT-1539 Phase 0 Stream D)

  On-chain follow-up to the Stream B per-pack source rewrites
  ([#41–#49](https://github.com/newt-foundation/newton-policy-packs/pulls?q=is%3Apr+NEWT-1539+is%3Amerged)).
  Re-componentizes each `policy.js` (now namespaced under `PACK_ID`) and
  deploys fresh `INewtonPolicy` + `INewtonPolicyData` pairs on Ethereum
  Sepolia (chain id 11155111). Bindings (`packages/policy-pack-<pack>/src/deployments.ts`)
  and the canonical `deployments.json` are updated to point at the new
  addresses; old pre-namespacing addresses are dropped from the registry
  per ADR 0003 force-migration.

  Per-pack address changes are visible in `deployments.json`. WASM CIDs
  and `policyCodeHash` values are also updated since the post-namespacing
  WASM bytes hash differently.

  No SDK API changes. Existing consumers on `@^1.x` will resolve to the
  new `Deployment` constants on upgrade — `createShield(...)` continues to
  work without code changes on the curator side.

  Out of scope:

  - npm publish of the patch bump → PR #40 (Stream E auto-publish).
  - `OracleModule` interface + per-pack export → Phase 1 (NEWT-1540).
  - Composite manifest format + decode helpers → Phase 1.5 (NEWT-1541).
  - `defineComposite` builder + Shield SDK migration → Phase 2 (NEWT-1542).

- Updated dependencies [ac73d21]
  - @newton-xyz/policy-pack-shared@0.3.0

## 1.0.0

### Major Changes

- ff7092a: Lift `policyParams` encoding from per-pack `encodeParams` / `decodeParams` into a single canonical utility in `@newton-xyz/policy-pack-shared`. Wire format is **UTF-8 JSON with sorted keys**, which is what the AVS host already reads (`String::from_utf8 → serde_json::from_str` at `newton-prover-avs/crates/core/src/common/task.rs:402-408`). NEWT-1516.

  **Breaking — `@newton-xyz/policy-pack-shared`**: the `PolicyPack` interface no longer requires per-pack `encodeParams` / `decodeParams`. New exports `encodePolicyParams(pack, params): Hex` and `decodePolicyParams(pack, encoded): T` replace them. Sorted keys mean the same params object always produces byte-identical output, so SDK-side `verifyPolicyBinding` can byte-compare against `getPolicyConfig().policyParams`. Both functions validate via the pack's `paramsSchema`, so a curator typo or a corrupted on-chain blob throws at the SDK boundary rather than producing AVS-rejecting bytes.

  **Breaking — `@newton-xyz/policy-pack-vaultsfyi`**: dropped the pack-local ABI encoder. The on-chain wire format is now JSON, not Solidity ABI bytes. `vaultsfyi@0.2.0` was non-functional end-to-end against the AVS — it shipped `encodeAbiParameters` output that the AVS parsed as `{}` and rejected every call. Anyone who ran `setPolicy(vaultsfyi.encodeParams(...))` against the on-chain `NewtonPolicy` is on a broken clone and needs to re-issue `setPolicy` with `encodePolicyParams(vaultsfyi, params)` from the new shared package. The `RefinedParamsSchema` (sub-basis-point precision rejection) is preserved as curator-side input validation.

  This change intentionally cascades majors to all dependent packs per ADR 0001 (`docs/architecture/0001-policy-pack-shared-as-peer-dep.md`) — see "Major-bump for breaking shared changes intentionally cascades. Don't dodge that case." Follow-up tickets NEWT-1505 — NEWT-1512 add hand-written `pack.ts` files to the 8 bindings-only packs against the new interface.

### Patch Changes

- Updated dependencies [ff7092a]
  - @newton-xyz/policy-pack-shared@0.2.0

## 0.2.0

### Minor Changes

- 9bdc52e: Align with AVS-side `vaultsfyi/policy.js` and `policy.rego`:

  - `prepareQuery` no longer reads MetaMorpho's on-chain `supplyQueue` and no
    longer computes a keccak-of-bytes32-array hash. The AVS computes the
    canonical allocation hash itself (FNV-1a over `JSON.stringify({protocol,
tags, fees, childrenVaults})` from the vaults.fyi API), so any SDK-side
    pre-hash never matched and silently broke `deny_on_allocation_change`.
    `previousAllocationHash` is now a plain `string | null` threaded through
    to `wasmArgs.lastKnownAllocationHash`.
  - `risk_score_floor` is now an integer 0-100 (was: 0-1 fractional, basis-
    point-encoded). Matches `vault.scores.netScore` from the AVS upstream.
    Encoded as `uint16` in `policyParams`. Sub-bp refine no longer covers
    this field — it's a discrete integer scale.

  Both changes are coordinated with `vaultsfyi/policy.js` in this same repo.

### Patch Changes

- Updated dependencies [302d113]
  - @newton-xyz/policy-pack-shared@0.1.0
