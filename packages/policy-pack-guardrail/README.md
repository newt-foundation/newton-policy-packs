# `@newton-xyz/policy-pack-guardrail`

Gates vault deposits when Guardrail.so reports active high/critical alerts on the target protocol or the protocol's health score is below floor

Typed TypeScript bindings for the Newton **guardrail** policy pack. Generated from the AVS-side artifacts at [`/guardrail/`](../../guardrail/) in this repo.

## Install

```bash
pnpm add @newton-xyz/policy-pack-guardrail
```

## What's exported

| Export | Source | Purpose |
|---|---|---|
| `guardrail` (`PolicyPack<Params, WasmArgs, Secrets>`) | `pack.ts` | Canonical pack object; pass to `createShield(...)` from `@newton-xyz/newton-shield-sdk`. |
| `prepareQuery`, `PrepareQueryOptions` | `prepare-query.ts` | Populates `vaultAddress` from `PrepareQueryArgs.subject` and `chainId` from `publicClient.chain.id`; optional `protocolId`, plus `chainId` / `vaultAddress` testing overrides, via the options bag. |
| `WasmArgsSchema` (zod) + `WasmArgs` (type) | `wasm_args_schema.json` | Inputs the pack's WASM receives at evaluation time. |
| `SecretsSchema` (zod) + `Secrets` (type) | `secrets_schema.json` | API credentials uploaded before run/sim. |
| `ParamsSchema` (zod) + `Params` (type) | `params_schema.json` | Configuration thresholds, set at policy upload time. |
| `deployments` | top-level `deployments.json` | `chainId → env → { policyData, wasmCid, policyCodeHash, deployedAt }` |
| `PACK_NAME`, `PACK_VERSION`, `PACK_DESCRIPTION`, `PACK_LINK`, `PACK_AUTHOR` | `policy_metadata.json` | Static pack identity. |

## Regeneration

The generated `src/*` files (everything except `pack.ts` and `prepare-query.ts`) are emitted from the upstream JSON schemas. Edit the schemas under [`/guardrail/`](../../guardrail/) and run `pnpm gen:bindings` from the repo root to regenerate.

The hand-written files, `package.json`, `tsconfig.json`, `tsup.config.ts`, and this README survive regen — you can hand-tune them.

