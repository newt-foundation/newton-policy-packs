---
"@newton-xyz/policy-pack-shared": patch
---

`defineComposite` now auto-reorders modules to match the on-chain `getPolicyData()` order

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
