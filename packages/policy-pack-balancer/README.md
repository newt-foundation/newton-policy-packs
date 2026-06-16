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
| `balancer` (`PolicyPack<Params, WasmArgs, Secrets>`) | `pack.ts` | Canonical pack object; pass to `createShield(...)` from `@newton-xyz/newton-shield-sdk`. |
| `WasmArgsSchema` (zod) + `WasmArgs` (type) | `wasm_args_schema.json` | Inputs the pack's WASM receives at evaluation time. |
| `SecretsSchema` (zod) + `Secrets` (type) | `secrets_schema.json` | API credentials uploaded before run/sim. |
| `ParamsSchema` (zod) + `Params` (type) | `params_schema.json` | Configuration thresholds, set at policy upload time. |
| `deployments` | top-level `deployments.json` | `chainId → env → { policyData, wasmCid, policyCodeHash, deployedAt }` |
| `PACK_NAME`, `PACK_VERSION`, `PACK_DESCRIPTION`, `PACK_LINK`, `PACK_AUTHOR` | `policy_metadata.json` | Static pack identity. |

## Usage

```ts
import { balancer } from "@newton-xyz/policy-pack-balancer";
import { encodePolicyParams } from "@newton-xyz/policy-pack-shared";

const params = balancer.paramsSchema.parse({
  max_token_weight_pct: 80,
  deny_on_underlying_risk: true,
  min_tvl_usd: 100_000,
  tvl_drawdown_24h_max_pct: 0.1,
  tvl_drawdown_7d_max_pct: 0.25,
});

const policyParams = encodePolicyParams(balancer, params); // UTF-8 JSON, sorted keys
```

## Regeneration

The generated `src/*` files (everything except `pack.ts`) are emitted from the upstream JSON schemas. Edit the schemas under [`/balancer/`](../../balancer/) and run `pnpm gen:bindings` from the repo root to regenerate.

The hand-written `pack.ts`, `package.json`, `tsconfig.json`, `tsup.config.ts`, and this README survive regen — you can hand-tune them.

