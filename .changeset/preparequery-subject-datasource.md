---
"@newton-xyz/policy-pack-shared": minor
"@newton-xyz/policy-pack-vaultsfyi": major
"@newton-xyz/policy-pack-chainalysis": major
"@newton-xyz/policy-pack-redstone": major
"@newton-xyz/policy-pack-webacy": major
"@newton-xyz/policy-pack-persona": major
"@newton-xyz/policy-pack-sumsub": major
"@newton-xyz/policy-pack-blockaid": major
"@newton-xyz/policy-pack-guardrail": major
"@newton-xyz/policy-pack-balancer": major
---

Rename `PrepareQueryArgs.vault` → `subject` and add data-source overrides.

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
