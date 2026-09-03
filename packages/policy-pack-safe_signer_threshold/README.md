# `@newton-xyz/policy-pack-safe_signer_threshold`

Gates execution on a Safe's on-chain configuration: identity of the Safe, minimum signature threshold, and minimum/maximum owner count

Typed TypeScript bindings for the Newton **safe_signer_threshold** policy pack. Generated from the AVS-side artifacts at [`/safe_signer_threshold/`](../../safe_signer_threshold/) in this repo.

## Install

```bash
pnpm add @newton-xyz/policy-pack-safe_signer_threshold
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

The `src/*` files are generated. Edit the upstream JSON schemas under [`/safe_signer_threshold/`](../../safe_signer_threshold/) and run `pnpm gen:bindings` from the repo root to regenerate.

The `package.json`, `tsconfig.json`, `tsup.config.ts`, and this README are scaffolded once and not overwritten on regen — you can hand-tune them.
