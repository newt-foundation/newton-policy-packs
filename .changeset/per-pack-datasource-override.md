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

Move the data-source override from the shared interface to per-pack options.

The `0.5.0` release added generic `dataSourceChainId` / `dataSourceSubject`
fields to the shared `PrepareQueryArgs`. That was the wrong layer: each pack's
`wasm_args` are unique, so a generic base-interface override doesn't fit — the
responsibility to support (and shape) an override belongs to each pack.

- `PrepareQueryArgs` is now minimal again: `{ publicClient, subject }`. The two
  `dataSource*` fields are **removed**.
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
