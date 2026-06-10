# `packages/` — TypeScript bindings tree

Per-pack TypeScript bindings for the AVS-side policy packs at the repo root. Each subdirectory publishes as `@newton-xyz/policy-pack-<name>`.

## Layout

```
packages/
├── policy-pack-shared/       # @newton-xyz/policy-pack-shared (the PolicyPack<P, W, S> contract)
├── policy-pack-vaultsfyi/    # @newton-xyz/policy-pack-vaultsfyi (first real pack — has prepare-query)
├── policy-pack-balancer/     # @newton-xyz/policy-pack-balancer (scaffolded; no prepare-query yet)
├── policy-pack-blockaid/
├── policy-pack-chainalysis/
├── policy-pack-guardrail/
├── policy-pack-persona/
├── policy-pack-redstone/
├── policy-pack-sumsub/
└── policy-pack-webacy/
```

Each pack's `src/` has six generated files (carrying an AUTO-GENERATED banner) plus optional hand-written ones:

| File | Source | Owner |
|---|---|---|
| `wasm-args.ts` | `<pack>/wasm_args_schema.json` | generated |
| `secrets.ts` | `<pack>/secrets_schema.json` | generated |
| `params.ts` | `<pack>/params_schema.json` | generated |
| `metadata.ts` | `<pack>/policy_metadata.json` | generated |
| `deployments.ts` | top-level `deployments.json` (sliced) | generated |
| `index.ts` | re-exports | generated |
| `pack.ts` | hand-written `PolicyPack` object | optional, hand-written |
| `prepare-query.ts` | reads on-chain state | optional, hand-written |
| anything else | hand-written helpers | hand-written |

The codegen wipes only the six generated files on regen. Hand-written files survive.

## Adding a new pack

1. Drop the AVS-side artifacts under a new top-level dir at the repo root: `<name>/{policy.rego, policy.js, *_schema.json, policy_metadata.json}`.
2. Add an entry under `packs.<name>` in the top-level `deployments.json` for every chain it's been deployed on.
3. Run `pnpm gen:bindings` from the repo root.
4. The new package appears at `packages/policy-pack-<name>/` with generated bindings.
5. Run `pnpm install` to register the new workspace.
6. Optionally write a hand-written `pack.ts` exporting a `PolicyPack` object so curators can use it with `createShield(...)`.

## Regeneration

```bash
pnpm gen:bindings
```

Pack-side schema changes regenerate bindings automatically. Hand-written `pack.ts` / `prepare-query.ts` files are preserved across regen — only the six AUTO-GENERATED files are wiped and rewritten.

CI runs `pnpm gen:bindings` and fails on diff, so an uncommitted regen blocks the PR.

## Known biome OOM warning

`pnpm lint` may print `[warn] Linter process terminated abnormally (possibly out of memory)` while still exiting `0`. This is a biome 2.4.16 reporter glitch on monorepo workspaces and is harmless when the exit code is 0 — the actual check completed successfully. Verify with `find packages/*/src scripts -name '*.ts' -type f -print0 | xargs -0 pnpm biome check` for an explicit pass.
