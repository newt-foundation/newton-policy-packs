# `@newton-xyz/policy-pack-shared`

The TypeScript contract every Newton policy pack implements. Consumed by `@newton-xyz/newton-shield-sdk`'s `createShield(...)` to type the curator's chosen pack.

## What's in here

- `PolicyPack<TParams, TWasmArgs, TSecrets>` — the canonical interface.
- `Deployment`, `ChainId` — types that mirror the per-pack-per-chain entries in the upstream `deployments.json`.

This package contains **no policy code** — no zod schemas for specific packs, no encode/decode logic, no on-chain reads. Each per-pack package (`@newton-xyz/policy-pack-vaultsfyi`, `@newton-xyz/policy-pack-chainalysis`, …) implements `PolicyPack` against its own AVS-side artifacts under `<pack>/` at the repo root.

## Why split this out

So the Shield SDK can depend on the contract without depending on every pack. A curator that integrates VaultsFYI installs `@newton-xyz/policy-pack-vaultsfyi` and gets that pack's bindings; the SDK never bundles unused packs.

## Versioning

Independent of any specific pack. A `0.x` minor bump here is breaking for every published pack and the SDK — coordinate carefully. A `0.x` patch is non-breaking (added optional fields, JSDoc, internal types).
