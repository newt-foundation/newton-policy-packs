# `@newton-xyz/policy-pack-arkham_counterparty`

Adaptive counterparty gate: allows routine payments to established counterparties whose amount and daily outflow match the wallet's historical baseline, and denies new recipients, anomalous amounts, and concentration or outflow spikes

Typed TypeScript bindings for the Newton **arkham_counterparty** policy pack. Generated from the AVS-side artifacts at [`/arkham_counterparty/`](../../arkham_counterparty/) in this repo.

## Install

```bash
pnpm add @newton-xyz/policy-pack-arkham_counterparty
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

The `src/*` files are generated. Edit the upstream JSON schemas under [`/arkham_counterparty/`](../../arkham_counterparty/) and run `pnpm gen:bindings` from the repo root to regenerate.

The `package.json`, `tsconfig.json`, `tsup.config.ts`, and this README are scaffolded once and not overwritten on regen — you can hand-tune them.
