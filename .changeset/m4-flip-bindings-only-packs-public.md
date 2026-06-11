---
"@newton-xyz/policy-pack-balancer": minor
"@newton-xyz/policy-pack-blockaid": minor
"@newton-xyz/policy-pack-chainalysis": minor
"@newton-xyz/policy-pack-guardrail": minor
"@newton-xyz/policy-pack-persona": minor
"@newton-xyz/policy-pack-redstone": minor
"@newton-xyz/policy-pack-sumsub": minor
"@newton-xyz/policy-pack-webacy": minor
---

First public release as bindings-only packages (M4 follow-up).

Drops `"private": true` from all 8 bindings-only policy-pack packages so they publish to npm at `0.1.0`. Each package ships:

- `ParamsSchema` (zod) + `Params` (type) — `encodeParams` is **not** included; curators encode `policyParams` themselves until the per-pack `pack.ts` lands.
- `WasmArgsSchema` (zod) + `WasmArgs` (type) — per-call args the AVS WASM receives.
- `SecretsSchema` (zod) + `Secrets` (type) — credentials uploaded before run/sim.
- `deployments` — `chainId → { policy, policyData, wasmCid, ... }` map.
- `PACK_NAME` / `PACK_VERSION` / `PACK_DESCRIPTION` / `PACK_LINK` / `PACK_AUTHOR` — static identity from `policy_metadata.json`.

These packs do **not** export a canonical `PolicyPack` object yet, so they can't be passed to `createShield(...)` from `@newton-xyz/newton-shield-sdk`. Curators use the bindings with `NewtonShield.guardedCall` directly. Each pack's README documents this limitation.

The per-pack `pack.ts` work is filed as a separate ticket per pack and is blocked on resolving the canonical `policyParams` encoding (UTF-8 JSON vs Solidity ABI tuple — see [NEWT-1516](https://linear.app/magiclabs/issue/NEWT-1516)). They'll land once that decision is made and curators show demand.
