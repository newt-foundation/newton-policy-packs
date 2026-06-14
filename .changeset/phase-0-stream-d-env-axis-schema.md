---
"@newton-xyz/policy-pack-shared": minor
"@newton-xyz/policy-pack-balancer": patch
"@newton-xyz/policy-pack-blockaid": patch
"@newton-xyz/policy-pack-chainalysis": patch
"@newton-xyz/policy-pack-guardrail": patch
"@newton-xyz/policy-pack-persona": patch
"@newton-xyz/policy-pack-redstone": patch
"@newton-xyz/policy-pack-sumsub": patch
"@newton-xyz/policy-pack-vaultsfyi": patch
"@newton-xyz/policy-pack-webacy": patch
---

feat(shared): add env axis to deployments shape (NEWT-1539 Phase 0 follow-up)

The same `(pack, chainId)` cell can now hold separate deployments under
each Newton AVS env (`stagef`, `prod`). The Newton Gateway routes per-env
to distinct TaskManager addresses + operator sets; the same pack policy
deployed under `stagef` will not be evaluated by `prod` operators and
vice versa. The previous shape — one `Deployment` per `chainId` —
forced curators to override `policyClientAddress` to switch envs.

Schema changes (no production consumers, clean migration):

- `policy-pack-shared`:
  - New `GatewayEnv = "stagef" | "prod"` type export.
  - `PolicyPack.deployments` is now `Partial<Record<ChainId, Partial<Record<GatewayEnv, Deployment>>>>`
    (was `Partial<Record<ChainId, Deployment>>`).
  - `getDeployment(pack, chainId, env)` adds the env arg.
  - New `UnsupportedEnvError` distinguishes "this chain has entries but
    not the env you asked for" from `UnsupportedChainError`. The
    recovery is different: the curator either picks a different env
    (typo / wrong gateway) or asks the AVS team to deploy the pack
    into that env.
  - 5 new test cases in `pack.test.ts` covering hit / single-env / chain-miss
    / env-miss / multi-chain-error branches.
- `deployments.json` schema bumped v1 → v2:
  - `packs.<name>["11155111"]` was a flat `Deployment`; now it's
    `{ stagef: Deployment, prod?: Deployment }`. Existing 9 stagef
    Sepolia entries migrated under `.stagef` keys.
  - New top-level `envs` map labels each AVS env.
- `scripts/sync-deployments.sh`: `--env <stagef|prod>` is now required.
  No safe default — the env is part of the cell key.
- `scripts/generate-bindings.ts`: `emitDeployments` outputs the new
  env-keyed shape; per-pack `src/deployments.ts` regenerated.

Out of scope:
- Shield SDK migration to the new `getDeployment` signature → newton-shield PR.
- Deploys for the new `(chainId, env)` cells (Sepolia/prod, Base Sepolia/stagef,
  Base Sepolia/prod) → Stream D2 follow-up.
- `OracleModule` interface + per-pack export → Phase 1 (NEWT-1540).
- Composite manifest format + decode helpers → Phase 1.5 (NEWT-1541).
- `defineComposite` builder → Phase 2 (NEWT-1542).
