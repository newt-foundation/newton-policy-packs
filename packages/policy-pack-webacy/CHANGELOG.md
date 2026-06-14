# @newton-xyz/policy-pack-webacy

## 2.0.0

### Major Changes

- d5d8465: feat(webacy)!: pack-side namespacing for composite-policy-packs (NEWT-1539 Phase 0 Stream B — FINAL)

  **Final** Stream B per-pack PR. Replicates the pattern locked in
  [#41 (vaultsfyi)](https://github.com/newt-foundation/newton-policy-packs/pull/41).
  Closes the 9-pack Stream B sweep.

  What changed in `webacy/`:

  - `policy.js` wraps both return paths under `PACK_ID = "webacy"` via
    inline `wrapOutput`. Input-unwrap shim. `_secrets` cleanup.
  - `policy.rego` reads from `data.wasm.webacy.<field>`.
  - New `wrapping_test.rego` (TDD-first) — webacy uses pure silent-skip
    (every deny rule has explicit precondition or comparison that
    fails-skip on undefined). Same shape as
    vaultsfyi/balancer/chainalysis/redstone. Flat-input assertion is
    `count(deny) == 0`.
  - `policy_test.rego` (existing 13 tests) wraps fixtures.
  - New `packages/policy-pack-webacy/src/pack-id.test.ts`.
  - `scripts/lint-policy-js.allowlist.json` drops webacy's 2 grandfathered
    entries (lines 98, 113). Allowlist contains only vaultsfyi entries
    (lines 115, 144) — those land in PR #41 (vaultsfyi).

  Out of scope:

  - WASM rebuild → Stream D. npm publish → Stream E.
  - HTTP status check is NOT yet present in webacy's `getJson`. Tracked
    as part of the cross-pack input-validation hardening sweep
    (separately, NEWT-1539 follow-up).
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

- 23b673b: Add hand-written `pack.ts` exporting `webacy: PolicyPack<Params, WasmArgs, Secrets>` so curators can pass it directly to `createShield(...)` from `@newton-xyz/newton-shield-sdk`. `prepareQuery` reads the pegged-token contract `address` (plus optional `chain`/`lookback_days`) from the SDK's per-call options bag and derives the Webacy chain slug from `publicClient.chain.id`.

  Encoding for the on-chain `policyParams` blob uses the canonical `encodePolicyParams` / `decodePolicyParams` utility from `@newton-xyz/policy-pack-shared@^0.2.0` — see NEWT-1516.

  NEWT-1512.

- ff7092a: Lift `policyParams` encoding from per-pack `encodeParams` / `decodeParams` into a single canonical utility in `@newton-xyz/policy-pack-shared`. Wire format is **UTF-8 JSON with sorted keys**, which is what the AVS host already reads (`String::from_utf8 → serde_json::from_str` at `newton-prover-avs/crates/core/src/common/task.rs:402-408`). NEWT-1516.

  **Breaking — `@newton-xyz/policy-pack-shared`**: the `PolicyPack` interface no longer requires per-pack `encodeParams` / `decodeParams`. New exports `encodePolicyParams(pack, params): Hex` and `decodePolicyParams(pack, encoded): T` replace them. Sorted keys mean the same params object always produces byte-identical output, so SDK-side `verifyPolicyBinding` can byte-compare against `getPolicyConfig().policyParams`. Both functions validate via the pack's `paramsSchema`, so a curator typo or a corrupted on-chain blob throws at the SDK boundary rather than producing AVS-rejecting bytes.

  **Breaking — `@newton-xyz/policy-pack-vaultsfyi`**: dropped the pack-local ABI encoder. The on-chain wire format is now JSON, not Solidity ABI bytes. `vaultsfyi@0.2.0` was non-functional end-to-end against the AVS — it shipped `encodeAbiParameters` output that the AVS parsed as `{}` and rejected every call. Anyone who ran `setPolicy(vaultsfyi.encodeParams(...))` against the on-chain `NewtonPolicy` is on a broken clone and needs to re-issue `setPolicy` with `encodePolicyParams(vaultsfyi, params)` from the new shared package. The `RefinedParamsSchema` (sub-basis-point precision rejection) is preserved as curator-side input validation.

  This change intentionally cascades majors to all dependent packs per ADR 0001 (`docs/architecture/0001-policy-pack-shared-as-peer-dep.md`) — see "Major-bump for breaking shared changes intentionally cascades. Don't dodge that case." Follow-up tickets NEWT-1505 — NEWT-1512 add hand-written `pack.ts` files to the 8 bindings-only packs against the new interface.

### Minor Changes

- 960a432: Close fail-open paths in blockaid, guardrail, and webacy allow rules.

  - **blockaid**: switch from `classification != "Malicious"` to a positive allowlist `{"Benign", "Warning"}`. The previous check let `"Unknown"` (the parse-failure default in policy.js) and any future Blockaid result type pass. Adds a `blockaid_unknown_classification` deny tag.
  - **guardrail**: add a required `require_health` boolean param (default true on the operator side) and require `health_available == true` whenever it is set. The previous `health_ok if v.health_available == false` clause turned every health-endpoint outage into an allow. Adds a `guardrail_health_unavailable` deny tag.
  - **webacy**: gate allow on `within_expected_range == true` and a new required `max_abs_dev_pct` param against `abs_dev_clean`. Tokens currently outside their peg range with no recent depeg events / no streak / non-stale data previously passed silently. Also tightens `wasm_args` `lookback_days` to a hard `[1, 30]` range — out-of-range inputs now throw in the WASM (rego denies via `default allow := false`) instead of being silently clamped.

  Operators must set the new params (`require_health`, `max_abs_dev_pct`) when binding these policies; missing required params will fail validation.

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
