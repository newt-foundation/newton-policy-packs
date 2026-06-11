---
"@newton-xyz/policy-pack-shared": patch
---

Widen `PolicyPack.prepareQuery` to accept an optional second `options` arg (NEWT-1499).

```ts
// before
prepareQuery?(args: PrepareQueryArgs): Promise<PrepareQueryResult<TWasmArgs>>;

// after
prepareQuery?(
  args: PrepareQueryArgs,
  options?: unknown,
): Promise<PrepareQueryResult<TWasmArgs>>;
```

Concrete packs that already implement `prepareQuery(args, options)` (e.g. VaultsFYI's `options?: { previousAllocationHash?: string }`) compiled against the old 1-arg interface only because TypeScript permits adding optional parameters. The widened signature lets the SDK consumer side type-safely forward a per-call options bag through `createShield(...).sendCall(...)` without bypassing the typed builder.

The shared interface keeps `options` typed as `unknown` so it can be forwarded verbatim — each pack narrows it in its own `prepareQuery` signature, and curators who care narrow it via the pack's own published types. Going generic (`prepareQuery?<O = void>(...)`) was rejected: bumping `PolicyPack` from 3 type params to 4 is too disruptive a churn for a 0.x change.

Additive change. No existing 1-arg `prepareQuery` implementations break.

Bumped at `patch` rather than `minor` to dodge the changesets cascade — every dependent pack (`policy-pack-balancer`, `-blockaid`, `-chainalysis`, `-guardrail`, `-persona`, `-redstone`, `-sumsub`, `-vaultsfyi`, `-webacy`) declares shared as a `peerDependency`, and a `minor` shared bump cascades to a `major` on each of them. Patch is semantically appropriate here (optional new parameter, no behavior change for old callers) and keeps the dependent-pack release surface stable.

