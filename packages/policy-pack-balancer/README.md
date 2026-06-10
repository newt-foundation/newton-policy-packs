# `@newton-xyz/policy-pack-balancer`

Composite Balancer v3 pool risk gate: blocks deposits into pools with excessive token concentration, non-allowlisted tokens, boosted underlying protocol risk, low TVL, or sharp TVL drawdowns

Typed TypeScript bindings for the Newton **balancer** policy pack. Generated from the AVS-side artifacts at [`/balancer/`](../../balancer/) in this repo.

## Install

```bash
pnpm add @newton-xyz/policy-pack-balancer
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

The `src/*` files are generated. Edit the upstream JSON schemas under [`/balancer/`](../../balancer/) and run `pnpm gen:bindings` from the repo root to regenerate.

The `package.json`, `tsconfig.json`, `tsup.config.ts`, and this README are scaffolded once and not overwritten on regen — you can hand-tune them.
