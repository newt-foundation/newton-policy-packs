# @newton-xyz/policy-pack-vaultsfyi

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
