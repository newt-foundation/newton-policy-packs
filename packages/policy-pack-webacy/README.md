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
| `WasmArgsSchema` (zod) + `WasmArgs` (type) | `wasm_args_schema.json` | Inputs the pack's WASM receives at evaluation time. |
| `SecretsSchema` (zod) + `Secrets` (type) | `secrets_schema.json` | API credentials uploaded before run/sim. |
| `ParamsSchema` (zod) + `Params` (type) | `params_schema.json` | Configuration thresholds, set at policy upload time. |
| `deployments` | top-level `deployments.json` | `chainId → { policy, policyData, wasmCid, ... }` |
| `PACK_NAME`, `PACK_VERSION`, `PACK_DESCRIPTION`, `PACK_LINK`, `PACK_AUTHOR` | `policy_metadata.json` | Static pack identity. |

## Regeneration

The `src/*` files are generated. Edit the upstream JSON schemas under [`/webacy/`](../../webacy/) and run `pnpm gen:bindings` from the repo root to regenerate.

The `package.json`, `tsconfig.json`, `tsup.config.ts`, and this README are scaffolded once and not overwritten on regen — you can hand-tune them.

## Limitations

This package ships **typed bindings only** — `params`, `wasmArgs`, `secrets`, and `deployments`. It does **not** export a canonical `PolicyPack` object yet, so it can't be passed to `createShield(...)` from `@newton-xyz/newton-shield-sdk`.

Curators using this pack today thread the bindings through `NewtonShield.guardedCall` directly:

```ts
import { ParamsSchema, WasmArgsSchema, deployments } from '@newton-xyz/policy-pack-webacy';

const wasmArgs = WasmArgsSchema.parse({ /* ... */ });
await shield.guardedCall({ to, data, functionSignature, wasmArgs });
```

A hand-written `pack.ts` exporting a typed `PolicyPack<Params, WasmArgs, Secrets>` will land when the pack's ABI tuple shape is coordinated with the AVS-side host that decodes `policyParams`. Track per-pack progress in the [`newton-policy-packs` issues](https://github.com/newt-foundation/newton-policy-packs/issues).

