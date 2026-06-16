# `@newton-xyz/policy-pack-blockaid`

Gates vault deposits at transaction-submission time using Blockaid's EVM transaction scan (validation + simulation) to catch malicious calldata, frontend-redirect attacks, and value-skim simulations

Typed TypeScript bindings for the Newton **blockaid** policy pack. Generated from the AVS-side artifacts at [`/blockaid/`](../../blockaid/) in this repo.

## Install

```bash
pnpm add @newton-xyz/policy-pack-blockaid
```

## What's exported

| Export | Source | Purpose |
|---|---|---|
| `blockaid` (`PolicyPack<Params, WasmArgs, Secrets>`) | `pack.ts` | Canonical pack object; pass to `createShield(...)` from `@newton-xyz/newton-shield-sdk`. |
| `prepareQuery`, `PrepareQueryOptions` | `prepare-query.ts` | Derives Blockaid `chain` from `publicClient.chain.id`; reads `from`/`to`/`value`/`data` from the SDK options bag. |
| `WasmArgsSchema` (zod) + `WasmArgs` (type) | `wasm_args_schema.json` | Inputs the pack's WASM receives at evaluation time. |
| `SecretsSchema` (zod) + `Secrets` (type) | `secrets_schema.json` | API credentials uploaded before run/sim. |
| `ParamsSchema` (zod) + `Params` (type) | `params_schema.json` | Configuration thresholds, set at policy upload time. |
| `deployments` | top-level `deployments.json` | `chainId → env → { policyData, wasmCid, policyCodeHash, deployedAt }` |
| `PACK_NAME`, `PACK_VERSION`, `PACK_DESCRIPTION`, `PACK_LINK`, `PACK_AUTHOR` | `policy_metadata.json` | Static pack identity. |

## Regeneration

The generated `src/*` files (everything except `pack.ts` and `prepare-query.ts`) are emitted from the upstream JSON schemas. Edit the schemas under [`/blockaid/`](../../blockaid/) and run `pnpm gen:bindings` from the repo root to regenerate.

The hand-written files, `package.json`, `tsconfig.json`, `tsup.config.ts`, and this README survive regen — you can hand-tune them.

