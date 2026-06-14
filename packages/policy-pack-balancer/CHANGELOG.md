# @newton-xyz/policy-pack-balancer

## 2.0.0

### Major Changes

- ef583aa: feat(balancer)!: pack-side namespacing for composite-policy-packs (NEWT-1539 Phase 0 Stream B)

  Second Stream B per-pack PR. Replicates the pattern established in
  [#41 (vaultsfyi)](https://github.com/newt-foundation/newton-policy-packs/pull/41)
  verbatim.

  What changed in `balancer/`:

  - `policy.js` wraps every return path under `PACK_ID = "balancer"` via a
    local `wrapOutput(packId, valueOrError)` helper (inlined because
    `policy.js` is fed straight to `jco componentize` with no npm bundler
    step). Indirect-return form satisfies the AST-lint guard from
    Phase 0 § Stream C.
  - `policy.js` reads its inputs through an unwrap shim
    (`parsed[PACK_ID] ?? parsed`) so it accepts both the composite envelope
    shape (`{ "balancer": { poolId, chain, ... } }`) and the legacy flat
    shape during the migration window.
  - `policy.js` strips its own slot from `_secrets` before calling
    `loadHostSecrets()` so a same-named host secret can't shadow the args
    object. Sibling pack slots are intentionally left in place.
  - `policy.rego` reads from `data.wasm.balancer.<field>` instead of
    `data.wasm.<field>`. AVS-side `merge_jsons` no longer collides on shared
    keys like `tvl_drawdown_24h_pct` (the load-bearing case for the
    namespacing fix — vaultsfyi and balancer both emit this field).
  - New `wrapping_test.rego` (TDD-first) locks the Rego-side namespacing
    contract: every deny rule must read from `data.wasm.balancer.*`; a flat
    un-namespaced fixture must NOT trigger any rule; cross-pack composition
    fixtures (with a `vaultsfyi` slot containing extreme drawdown values)
    must not interfere with balancer's slice.
  - `policy_test.rego` (existing 13 tests) wraps fixtures under the
    `balancer` key so the pre-existing rule-by-rule coverage stays intact
    under the new shape.
  - New `packages/policy-pack-balancer/src/pack-id.test.ts` parses
    `policy.js` and asserts `PACK_ID === PACK_NAME === "balancer"`. Wires
    the previously-stub `test` script to Node's native test runner + tsx
    loader. Adds `tsx` to devDependencies.
  - `scripts/lint-policy-js.allowlist.json` drops balancer's 2 grandfathered
    entries (lines 231, 246); allowlist shrinks across the remaining 7
    packs.

  Out of scope (deferred to later streams):

  - WASM rebuild via `jco componentize` and on-chain redeploy → Stream D.
  - npm publish of the major bump → Stream E.
  - HTTP status check in `getJson` and explicit input validation
    (chainalysis already does both; cross-pack hardening sweep tracked
    separately under NEWT-1539).
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

- 1cd6e99: Add hand-written `pack.ts` exporting `balancer: PolicyPack<Params, WasmArgs, Secrets>` so curators can pass it directly to `createShield(...)` from `@newton-xyz/newton-shield-sdk`. No `prepareQuery`: `wasmArgs` (`poolId`, `chain`, optional `allowed_token_addresses`) is curator-supplied at intent-build time.

  Encoding for the on-chain `policyParams` blob uses the canonical `encodePolicyParams` / `decodePolicyParams` utility from `@newton-xyz/policy-pack-shared@^0.2.0` (UTF-8 JSON, sorted keys) — see NEWT-1516.

  NEWT-1505.

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
