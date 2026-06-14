---
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

chore: Stream D Sepolia redeploy for namespaced WASM (NEWT-1539 Phase 0 Stream D)

On-chain follow-up to the Stream B per-pack source rewrites
([#41–#49](https://github.com/newt-foundation/newton-policy-packs/pulls?q=is%3Apr+NEWT-1539+is%3Amerged)).
Re-componentizes each `policy.js` (now namespaced under `PACK_ID`) and
deploys fresh `INewtonPolicy` + `INewtonPolicyData` pairs on Ethereum
Sepolia (chain id 11155111). Bindings (`packages/policy-pack-<pack>/src/deployments.ts`)
and the canonical `deployments.json` are updated to point at the new
addresses; old pre-namespacing addresses are dropped from the registry
per ADR 0003 force-migration.

Per-pack address changes are visible in `deployments.json`. WASM CIDs
and `policyCodeHash` values are also updated since the post-namespacing
WASM bytes hash differently.

No SDK API changes. Existing consumers on `@^1.x` will resolve to the
new `Deployment` constants on upgrade — `createShield(...)` continues to
work without code changes on the curator side.

Out of scope:
- npm publish of the patch bump → PR #40 (Stream E auto-publish).
- `OracleModule` interface + per-pack export → Phase 1 (NEWT-1540).
- Composite manifest format + decode helpers → Phase 1.5 (NEWT-1541).
- `defineComposite` builder + Shield SDK migration → Phase 2 (NEWT-1542).
