# `@newton-xyz/policy-pack-persona`

Gates permissioned vault deposits on Persona KYC: requires a recent approved inquiry bound to the sending wallet with passing government-ID, selfie, and watchlist verifications, plus country and age checks

Typed TypeScript bindings for the Newton **persona** policy pack. Generated from the AVS-side artifacts at [`/persona/`](../../persona/) in this repo.

## Install

```bash
pnpm add @newton-xyz/policy-pack-persona
```

## What's exported

| Export | Source | Purpose |
|---|---|---|
| `WasmArgsSchema` (zod) + `WasmArgs` (type) | `wasm_args_schema.json` | Inputs the pack's WASM receives at evaluation time. |
| `SecretsSchema` (zod) + `Secrets` (type) | `secrets_schema.json` | API credentials uploaded before run/sim. |
| `ParamsSchema` (zod) + `Params` (type) | `params_schema.json` | Configuration thresholds, set at policy upload time. |
| `deployments` | top-level `deployments.json` | `chainId → { policy, policyData, wasmCid, ... }` |
| `PACK_NAME`, `PACK_VERSION`, `PACK_DESCRIPTION`, `PACK_LINK`, `PACK_AUTHOR` | `policy_metadata.json` | Static pack identity. |

## Regeneration

The `src/*` files are generated. Edit the upstream JSON schemas under [`/persona/`](../../persona/) and run `pnpm gen:bindings` from the repo root to regenerate.

The `package.json`, `tsconfig.json`, `tsup.config.ts`, and this README are scaffolded once and not overwritten on regen — you can hand-tune them.
