# `@newton-xyz/policy-pack-webacy`

Gates vault deposits based on Webacy's per-address risk score (DD Score), sanctions hits, and exploit-exposure flags

Typed TypeScript bindings for the Newton **webacy** policy pack. Generated from the AVS-side artifacts at [`/webacy/`](../../webacy/) in this repo.

## Install

```bash
pnpm add @newton-xyz/policy-pack-webacy
```

## What's exported

| Export | Source | Purpose |
|---|---|---|
| `webacy` (`PolicyPack<Params, WasmArgs, Secrets>`) | `pack.ts` | Canonical pack object; pass to `createShield(...)` from `@newton-xyz/newton-shield-sdk`. |
| `prepareQuery`, `PrepareQueryOptions` | `prepare-query.ts` | Reads pegged-token `address` (and optional `chain`/`lookback_days`) from the SDK options bag; derives Webacy chain slug from `publicClient.chain.id`. |
| `WasmArgsSchema` (zod) + `WasmArgs` (type) | `wasm_args_schema.json` | Inputs the pack's WASM receives at evaluation time. |
| `SecretsSchema` (zod) + `Secrets` (type) | `secrets_schema.json` | API credentials uploaded before run/sim. |
| `ParamsSchema` (zod) + `Params` (type) | `params_schema.json` | Configuration thresholds, set at policy upload time. |
| `deployments` | top-level `deployments.json` | `chainId → env → { policyData, wasmCid, policyCodeHash, deployedAt }` |
| `PACK_NAME`, `PACK_VERSION`, `PACK_DESCRIPTION`, `PACK_LINK`, `PACK_AUTHOR` | `policy_metadata.json` | Static pack identity. |

## Regeneration

The generated `src/*` files (everything except `pack.ts` and `prepare-query.ts`) are emitted from the upstream JSON schemas. Edit the schemas under [`/webacy/`](../../webacy/) and run `pnpm gen:bindings` from the repo root to regenerate.

The hand-written files, `package.json`, `tsconfig.json`, `tsup.config.ts`, and this README survive regen — you can hand-tune them.

