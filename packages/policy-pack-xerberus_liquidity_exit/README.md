# `@newton-xyz/policy-pack-xerberus_liquidity_exit`

Liquidity exit gate: denies acquiring a position that cannot be unwound within a curator-set number of days at a bounded market impact, or when the Xerberus data is stale

Typed TypeScript bindings for the Newton **xerberus_liquidity_exit** policy pack. Generated from the AVS-side artifacts at [`/xerberus_liquidity_exit/`](../../xerberus_liquidity_exit/) in this repo.

## Install

```bash
pnpm add @newton-xyz/policy-pack-xerberus_liquidity_exit
```

## What's exported

| Export | Source | Purpose |
|---|---|---|
| `WasmArgsSchema` (zod) + `WasmArgs` (type) | `wasm_args_schema.json` | Inputs the pack's WASM receives at evaluation time. |
| `SecretsSchema` (zod) + `Secrets` (type) | `secrets_schema.json` | API credentials uploaded before run/sim. |
| `ParamsSchema` (zod) + `Params` (type) | `params_schema.json` | Configuration thresholds, set at policy upload time. |
| `deployments` | top-level `deployments.json` | `chainId → env → { policyData, wasmCid, priorWasmCids?, policyCodeHash, deployedAt }` (env keys: `stagef`, `prod`) — the reusable oracle; curators deploy their own policy referencing it |
| `PACK_NAME`, `PACK_VERSION`, `PACK_DESCRIPTION`, `PACK_LINK`, `PACK_AUTHOR` | `policy_metadata.json` | Static pack identity. |

## Regeneration

The `src/*` files are generated. Edit the upstream JSON schemas under [`/xerberus_liquidity_exit/`](../../xerberus_liquidity_exit/) and run `pnpm gen:bindings` from the repo root to regenerate.

The `package.json`, `tsconfig.json`, `tsup.config.ts`, and this README are scaffolded once and not overwritten on regen — you can hand-tune them.
