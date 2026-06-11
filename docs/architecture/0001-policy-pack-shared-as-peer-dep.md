# ADR 0001 — `@newton-xyz/policy-pack-shared` ships as a peer dep on each pack

- **Status:** Accepted
- **Date:** 2026-06-11
- **Linear:** [NEWT-1504](https://linear.app/magiclabs/issue/NEWT-1504)
- **Surfaced by:** pr-reviewer on PR #20 (NEWT-1499 widening of `PolicyPack.prepareQuery`)

## Context

Every per-pack `@newton-xyz/policy-pack-<name>` package declares
`@newton-xyz/policy-pack-shared` as a `peerDependency`. This is the shape
emitted by `scripts/generate-bindings.ts` and unchanged since the
monorepo bootstrap.

The **changesets cascade** is the operational cost of that choice. When
shared bumps `minor`, every dependent pack with `peerDependencies: { shared: "^X.Y.0" }`
gets a `major` cascade because the peer-dep range bump is treated as
breaking by `changesets/assemble-release-plan`. We have hit this twice in
the first six months of the package:

1. **NEWT-1492 — initial release** (2026-06-10). `shared@0.0.0 → 0.1.0` would
   have cascaded major bumps across all 9 dependent packs. We dodged via
   `patch` (`shared@0.1.0 → 0.1.1`) since the package wasn't yet on npm.
2. **NEWT-1499 — widen `prepareQuery(args, options?)`** (2026-06-11). Same
   cascade. Same dodge: `patch` (`shared@0.1.0 → 0.1.1`) because the
   widening is additive and 1-arg packs satisfy the new signature via TS
   contravariance.

Both dodges are semantically defensible (additive change → patch is fine
under SemVer for an exported interface), but the cascade itself is an
architectural smell — every additive interface change forces this
calculus, and the changelog ends up with footnotes explaining why a
"minor-shaped" change shipped as a patch.

## Options considered

### Option A — `shared` as peer-dep (status quo)

```jsonc
// packages/policy-pack-vaultsfyi/package.json
{
  "peerDependencies": {
    "@newton-xyz/policy-pack-shared": "^0.1.1"
  },
  "devDependencies": {
    "@newton-xyz/policy-pack-shared": "workspace:*"
  }
}
```

- **Pro:** consumers get exactly one copy of `policy-pack-shared` no
  matter how many packs they install. The `PolicyPack<T>` type identity
  is the same nominal symbol across packs, which matters for SDK call
  sites that accept `PolicyPack<...>` from multiple packs in the same
  workflow (e.g., a Shield clone with both a risk pack and a KYC pack
  bound — not the MVP shape but plausible v2).
- **Pro:** tree-shakable; consumers pay for what they import.
- **Con:** every additive shared bump cascades to a major on dependents.
  Changeset choreography forces the patch-vs-minor decision documented
  above.

### Option B — `shared` as runtime dep on each pack

```jsonc
{
  "dependencies": {
    "@newton-xyz/policy-pack-shared": "^0.1.1"
  }
}
```

- **Pro:** shared bumps don't cascade; each pack independently chooses
  when to upgrade. Cleaner version graph; no patch-bump theater.
- **Con:** end users get N copies of shared in `node_modules` (one per
  pack they install). pnpm dedupes when the resolved versions match,
  but a consumer pinning `policy-pack-vaultsfyi@0.2.0` with
  `shared@^0.1.1` and `policy-pack-blockaid@0.3.0` with
  `shared@^0.2.0` ends up with two physical copies.
- **Con (load-bearing):** when two physical copies of shared land in the
  consumer's `node_modules`, the `PolicyPack<T>` type identity diverges.
  TypeScript reports the now-familiar TS2719 "Two different types with
  this name" between packs, even though the runtime shape is identical.
  We've already paid this cost once on the SDK side (where shared is
  imported from one tree and viem via peer-dep from another) and added
  cast comments to bridge it. Multiplying that across every pack-pack
  interaction is a real regression.

### Option C — hybrid: declare `shared` as both peer and runtime dep

```jsonc
{
  "peerDependencies": {
    "@newton-xyz/policy-pack-shared": "^0.1.1"
  },
  "peerDependenciesMeta": {
    "@newton-xyz/policy-pack-shared": { "optional": true }
  },
  "dependencies": {
    "@newton-xyz/policy-pack-shared": "^0.1.1"
  }
}
```

The intent: the optional peer-dep declares "if you have shared in your
deps tree, dedupe to that"; the runtime dep declares "if you don't, use
my copy". pnpm treats the optional peer as a dedup hint and falls back
to the runtime dep otherwise.

- **Pro:** consumers who explicitly install shared dedupe correctly; the
  cascade pressure relaxes because the peer-dep range is optional.
- **Con:** install-time complexity. Documenting "you can override our
  shared by installing your own" is non-trivial, and curators rarely
  want this level of resolution control.
- **Con:** the cascade behavior changes from "every shared bump triggers
  major bumps on dependents" to "every shared bump is invisible at the
  changesets level," which trades one footnote for another. We'd lose
  the explicit signal that consumers should consider whether to upgrade.

## Decision

**Keep `shared` as a peer-dep (Option A).**

Three reasons drove this:

1. **Type identity preservation.** Option A is the only path that
   guarantees one `PolicyPack<T>` symbol across all packs the consumer
   imports. The other options either accept multi-copy nominal-identity
   drift (B) or rely on consumers to manually dedupe (C).
2. **Low frequency of the cascade cost.** We've hit it twice in 6
   months and dodged both via patch. A change that genuinely warrants
   a major bump on dependents should cascade — patch-bump dodges only
   work because the changes are additive. When we have a real breaking
   change to shared, we want the cascade.
3. **Consumer install footprint.** Curators integrating multiple packs
   should pay for shared once, not once-per-pack. Option B punishes the
   common case to optimize the rare case.

## Operational consequences

- **Patch-bump for additive shared changes** is the default release
  pattern. Document it in `CONTRIBUTING.md` (follow-up).
- **Major-bump for breaking shared changes** intentionally cascades.
  Don't dodge that case — let consumers see the major-version signal
  on every dependent pack so they re-pin explicitly.
- **`pnpm changeset status` will warn** about peer-dep range mismatches
  when `shared` is bumped without bumping every dependent in lockstep.
  These warnings are pre-version-step; `changesets/action`'s version
  step rewrites every dependent's `peerDependencies` range to match,
  so the warnings clear automatically once the version PR opens.

## Revisit when

- A pack-pack workflow becomes load-bearing in the SDK and the type
  identity argument starts paying real dividends. (Today it's
  speculative — the MVP shape is one pack per Shield clone.)
- A breaking shared bump genuinely needs to cascade — the cascade
  validates the peer-dep choice.
- pnpm or npm changes how peer-deps interact with changesets such that
  the cascade behavior shifts.
- The pack count crosses ~20 and the cascade math becomes unwieldy.
  9 packs is fine; 50 might not be.

## References

- pr-reviewer surfaced this on PR #20:
  https://github.com/newt-foundation/newton-policy-packs/pull/20
- Changesets cascade behavior:
  `node_modules/@changesets/assemble-release-plan/dist/...` —
  search for `peerDependencies` in `determineDependents.ts`.
- NEWT-1504:
  https://linear.app/magiclabs/issue/NEWT-1504
