# `@newton-xyz/policy-pack-xerberus_what_if`

Portfolio what-if gate: denies a transaction that pushes token concentration past a limit, raises HHI, erodes the share of the book exitable within 30 days, or lengthens the slowest exit beyond curator-set bounds

Typed TypeScript bindings for the Newton **xerberus_what_if** policy pack. Generated from the AVS-side artifacts at [`/xerberus_what_if/`](../../xerberus_what_if/) in this repo.

## Install

```bash
pnpm add @newton-xyz/policy-pack-xerberus_what_if
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

The `src/*` files are generated. Edit the upstream JSON schemas under [`/xerberus_what_if/`](../../xerberus_what_if/) and run `pnpm gen:bindings` from the repo root to regenerate.

The `package.json`, `tsconfig.json`, `tsup.config.ts`, and this README are scaffolded once and not overwritten on regen — you can hand-tune them.
