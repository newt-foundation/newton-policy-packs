# @newton-xyz/policy-pack-sumsub

## 2.0.4

### Patch Changes

- 74c1ba7: Add `OracleModule<P, W, S>` type + `oracleModuleFromPack(pack)` helper to `@newton-xyz/policy-pack-shared`, and a `<name>OracleModule` constant export from each per-pack package (Phase 1 of the composite-policy rollout, NEWT-1540).

  `OracleModule` is the strict subset of `PolicyPack` that `defineComposite(...)` (Phase 2) consumes when stacking packs into a composite manifest — `id`, the three zod schemas, and the `deployments` map; no `prepareQuery`, no `metadata`. Each pack's hand-written `pack.ts` now exports `<name>OracleModule = oracleModuleFromPack(<name>)` so the subset stays in lockstep with the underlying `PolicyPack` (no field-by-field projection that could drift).

  Patch-bumped across the cascade so dependent packs stay inside the existing `^0.4.x` peer range on `@newton-xyz/policy-pack-shared` (avoids the pre-1.0 caret-rule cascade where a minor on shared would force a major on every dependent — see ADR 0001).

- Updated dependencies [74c1ba7]
  - @newton-xyz/policy-pack-shared@0.4.2

## 2.0.3

### Patch Changes

- ffee4cf: Drop `notes` field from `Deployment` schema.

  The field carried no protocol load (not used by `getDeployment` lookup, CREATE2 derivation, or attestation flow) and the merge path in `sync-deployments.sh` overwrote every pack's notes on every sync, muddying provenance. Canonical sources for deploy provenance already exist (git blame on `deployments.json`, per-pack `deployment.log` audit trail, the PR description).

  Strictly a breaking type change, but no production consumers exist yet — clean migration. Patch-bumped across the cascade so dependent packs stay inside the existing `^0.4.0` peer range on `@newton-xyz/policy-pack-shared` (avoids the pre-1.0 caret-rule cascade where a minor on shared would force a major on every dependent).

- Updated dependencies [ffee4cf]
  - @newton-xyz/policy-pack-shared@0.4.1

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

- 24c09e7: feat(sumsub)!: pack-side namespacing for composite-policy-packs (NEWT-1539 Phase 0 Stream B)

  Eighth Stream B per-pack PR. Replicates the pattern locked in
  [#41 (vaultsfyi)](https://github.com/newt-foundation/newton-policy-packs/pull/41).

  What changed in `sumsub/`:

  - `policy.js` wraps **all THREE return paths** under `PACK_ID = "sumsub"`
    via inline `wrapOutput` (early no-applicant, success, catch). Same
    multi-return-path shape as persona #46.
  - Input-unwrap shim and `_secrets` cleanup follow the canonical pattern.
  - `policy.rego` reads from `data.wasm.sumsub.<field>`.
  - New `wrapping_test.rego` (TDD-first) — sumsub uses the MIXED
    negative-shape pattern (like persona/guardrail). `no_applicant` has
    the bare `not v.has_applicant` shape — fires on undefined `v`. Other
    rules silent-skip. Flat-input assertion pins
    `"no_applicant" in deny` + `count(deny) == 1` + `not allow`.
  - `policy_test.rego` (existing 13 tests) wraps fixtures under the
    `sumsub` key — including the two inline-fixture tests
    (`test_deny_no_applicant`, `test_no_applicant_short_circuits`) that
    bypass `with_data`.
  - New `packages/policy-pack-sumsub/src/pack-id.test.ts`.
  - `scripts/lint-policy-js.allowlist.json` drops sumsub's 3
    grandfathered entries (lines 268, 294, 305).

  Out of scope:

  - WASM rebuild → Stream D. npm publish → Stream E.
  - HTTP status check is already present in sumsub's `sumsubGet` (line 218
    throws on `status >= 400`); no per-pack input hardening needed.
  - `OracleModule` / manifest / `defineComposite` → Phases 1, 1.5, 2.

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

- 172f52b: Add hand-written `pack.ts` exporting `sumsub: PolicyPack<Params, WasmArgs, Secrets>` so curators can pass it directly to `createShield(...)` from `@newton-xyz/newton-shield-sdk`. `prepareQuery` reads `walletAddress` from the SDK's per-call options bag (typically `IntentArgs.from`).

  The `required_review_answer` enum (`"GREEN" | "YELLOW" | "RED"`) round-trips as a plain JSON string through the canonical `encodePolicyParams` utility from `@newton-xyz/policy-pack-shared@^0.2.0` — see NEWT-1516.

  NEWT-1511.

- ff7092a: Lift `policyParams` encoding from per-pack `encodeParams` / `decodeParams` into a single canonical utility in `@newton-xyz/policy-pack-shared`. Wire format is **UTF-8 JSON with sorted keys**, which is what the AVS host already reads (`String::from_utf8 → serde_json::from_str` at `newton-prover-avs/crates/core/src/common/task.rs:402-408`). NEWT-1516.

  **Breaking — `@newton-xyz/policy-pack-shared`**: the `PolicyPack` interface no longer requires per-pack `encodeParams` / `decodeParams`. New exports `encodePolicyParams(pack, params): Hex` and `decodePolicyParams(pack, encoded): T` replace them. Sorted keys mean the same params object always produces byte-identical output, so SDK-side `verifyPolicyBinding` can byte-compare against `getPolicyConfig().policyParams`. Both functions validate via the pack's `paramsSchema`, so a curator typo or a corrupted on-chain blob throws at the SDK boundary rather than producing AVS-rejecting bytes.

  **Breaking — `@newton-xyz/policy-pack-vaultsfyi`**: dropped the pack-local ABI encoder. The on-chain wire format is now JSON, not Solidity ABI bytes. `vaultsfyi@0.2.0` was non-functional end-to-end against the AVS — it shipped `encodeAbiParameters` output that the AVS parsed as `{}` and rejected every call. Anyone who ran `setPolicy(vaultsfyi.encodeParams(...))` against the on-chain `NewtonPolicy` is on a broken clone and needs to re-issue `setPolicy` with `encodePolicyParams(vaultsfyi, params)` from the new shared package. The `RefinedParamsSchema` (sub-basis-point precision rejection) is preserved as curator-side input validation.

  This change intentionally cascades majors to all dependent packs per ADR 0001 (`docs/architecture/0001-policy-pack-shared-as-peer-dep.md`) — see "Major-bump for breaking shared changes intentionally cascades. Don't dodge that case." Follow-up tickets NEWT-1505 — NEWT-1512 add hand-written `pack.ts` files to the 8 bindings-only packs against the new interface.

### Patch Changes

- Updated dependencies [ff7092a]
  - @newton-xyz/policy-pack-shared@0.2.0

## 0.2.0

### Minor Changes

- ef623e9: First public release as bindings-only packages (M4 follow-up).

  Drops `"private": true` from all 8 bindings-only policy-pack packages so they publish to npm at `0.1.0`. Each package ships:

  - `ParamsSchema` (zod) + `Params` (type) — `encodeParams` is **not** included; curators encode `policyParams` themselves until the per-pack `pack.ts` lands.
  - `WasmArgsSchema` (zod) + `WasmArgs` (type) — per-call args the AVS WASM receives.
  - `SecretsSchema` (zod) + `Secrets` (type) — credentials uploaded before run/sim.
  - `deployments` — `chainId → { policy, policyData, wasmCid, ... }` map.
  - `PACK_NAME` / `PACK_VERSION` / `PACK_DESCRIPTION` / `PACK_LINK` / `PACK_AUTHOR` — static identity from `policy_metadata.json`.

  These packs do **not** export a canonical `PolicyPack` object yet, so they can't be passed to `createShield(...)` from `@newton-xyz/newton-shield-sdk`. Curators use the bindings with `NewtonShield.guardedCall` directly. Each pack's README documents this limitation.

  The per-pack `pack.ts` work is filed as a separate ticket per pack and is blocked on resolving the canonical `policyParams` encoding (UTF-8 JSON vs Solidity ABI tuple — see [NEWT-1516](https://linear.app/magiclabs/issue/NEWT-1516)). They'll land once that decision is made and curators show demand.
