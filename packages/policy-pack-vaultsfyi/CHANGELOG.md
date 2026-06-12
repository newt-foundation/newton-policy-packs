# @newton-xyz/policy-pack-vaultsfyi

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
