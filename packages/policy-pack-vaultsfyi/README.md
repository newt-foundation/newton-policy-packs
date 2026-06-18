# `@newton-xyz/policy-pack-vaultsfyi`

Gates vault deposits based on real-time risk signals: APY anomalies, TVL drawdowns, risk score floors, and allocation changes

Typed TypeScript bindings for the Newton **vaultsfyi** policy pack. Generated from the AVS-side artifacts at [`/vaultsfyi/`](../../vaultsfyi/) in this repo.

## Install

```bash
pnpm add @newton-xyz/policy-pack-vaultsfyi
```

## What's exported

| Export | Source | Purpose |
|---|---|---|
| `vaultsfyi` (`PolicyPack<Params, WasmArgs, Secrets>`) | `pack.ts` | Canonical pack object; pass to `createShield(...)` from `@newton-xyz/newton-shield-sdk`. |
| `prepareQuery`, `PrepareQueryOptions` | `prepare-query.ts` | Populates `vaultAddress` from `PrepareQueryArgs.target` and `network` from `publicClient.chain.id`; optional `previousAllocationHash`, plus `network` / `vaultAddress` testing overrides, via the options bag. |
| `WasmArgsSchema` (zod) + `WasmArgs` (type) | `wasm_args_schema.json` | Inputs the pack's WASM receives at evaluation time. |
| `SecretsSchema` (zod) + `Secrets` (type) | `secrets_schema.json` | API credentials uploaded before run/sim. |
| `ParamsSchema` (zod) + `Params` (type) | `params_schema.json` | Configuration thresholds, set at policy upload time. |
| `deployments` | top-level `deployments.json` | `chainId → env → { policyData, wasmCid, policyCodeHash, deployedAt }` |
| `PACK_NAME`, `PACK_VERSION`, `PACK_DESCRIPTION`, `PACK_LINK`, `PACK_AUTHOR` | `policy_metadata.json` | Static pack identity. |

## Regeneration

The `src/*` files are generated. Edit the upstream JSON schemas under [`/vaultsfyi/`](../../vaultsfyi/) and run `pnpm gen:bindings` from the repo root to regenerate.

The `package.json`, `tsconfig.json`, `tsup.config.ts`, and this README are scaffolded once and not overwritten on regen — you can hand-tune them.
