# `defineComposite` builder + composite SDK consumption — design spec

**Status:** Proposed. Phase 2 of the composite-policy rollout (NEWT-1542). Implementation lands in a follow-up PR after design review.

This spec answers: how does a curator build a composite policy in TypeScript, and how do downstream consumers (the Shield SDK, depositor UIs) work with the resulting object? It binds together the artifacts shipped in Phase 0 (`wrapOutput`), Phase 1 (`OracleModule`), and Phase 1.5 (`encodeCompositeParams` / `decodeManifest` / `introspectComposite`) into one curator-facing API.

## Goals

1. **One builder call** produces a `CompositePolicyPack` ready to drop into the Shield SDK's `createShield(...)` (or whatever its composite-aware analog ends up being).
2. **Position-significant invariant enforced at construction time.** `defineComposite` reads the deployed `INewtonPolicy.getPolicyData()` array and validates the curator's `modules[]` against it, byte-equal and in order. A mis-ordered curator argument fails before any bytes are ever encoded — long before they could land on-chain.
3. **`KNOWN_PACK_IDS` mechanically enforces short-id uniqueness** across the published-pack universe. A new pack added to `@newton-xyz/policy-pack-<name>` MUST add its short id to the registry; the codegen rejects PRs that don't.
4. **Discriminated-union dispatch** for tools that need to handle both single-pack and composite shapes — `getPolicyManifest(bytes)` returns either `{ kind: "single-pack", params }` or `{ kind: "composite", manifest }`.
5. **`prepareQuery` aggregation.** Each module's `prepareQuery` runs at intent-build time; the composite's aggregated `prepareQuery` calls every module's helper and merges the results into one `wasmArgs` blob keyed by short pack id (symmetric with how `data.wasm.<shortId>` is composed AVS-side).

## Non-goals

- Conditional gates ("only call Chainalysis if VaultsFYI is high-risk"). Already documented as out-of-scope in `composite-policies.md:233`. Composites are AND-composition over the modules array.
- Per-action gates from one composite. Same Rego runs on every action the Shield routes. v2 protocol-level question.
- Live updates to one module's params. Updating any module re-encodes the WHOLE manifest and requires a new `setPolicy(...)` transaction.

## Audience

- **Curators** — write `await defineComposite({ modules, ... })` once per Shield, hand the result to the SDK.
- **Pack authors** — add their short pack id to `KNOWN_PACK_IDS` when contributing a new pack, otherwise nothing changes.
- **The Shield SDK** — accepts `CompositePolicyPack` from `createShield(...)` (or successor) the same way it accepts a single `PolicyPack` today.
- **Depositor / dashboard tools** — call `getPolicyManifest(bytes)` to discriminate single-pack vs composite without needing to know which path their target Shield uses.

## `defineComposite` API

```ts
interface DefineCompositeArgs {
  /**
   * The OracleModule list, in the EXACT order the curator's deployed
   * NewtonPolicy carries them on-chain. defineComposite verifies positional
   * equality against `INewtonPolicy.getPolicyData()` at construction time.
   * Mis-ordered modules fail here — never reach setPolicy.
   */
  readonly modules: ReadonlyArray<OracleModule<unknown, unknown, unknown>>;

  readonly chainId: ChainId;
  readonly env: GatewayEnv;

  /** viem PublicClient used to read on-chain state for the invariant check. */
  readonly publicClient: PublicClient;

  /**
   * The deployed composite NewtonPolicy contract address. The curator obtained
   * this from running `newton-cli policy deploy` with multiple
   * --policy-data-address flags (one per module).
   */
  readonly policyAddress: Address;
}

interface CompositePolicyPack {
  readonly kind: "composite";

  /** The same array passed in, validated against on-chain ordering. */
  readonly modules: ReadonlyArray<OracleModule<unknown, unknown, unknown>>;

  readonly chainId: ChainId;
  readonly env: GatewayEnv;
  readonly policyAddress: Address;

  /**
   * Cached snapshot from `INewtonPolicy(policyAddress).getPolicyData()` taken
   * at construction time. Read-only — not refetched. Downstream code that
   * needs fresh on-chain state calls `introspectComposite(...)` again.
   */
  readonly onChainPolicyData: ReadonlyArray<Address>;

  /**
   * Aggregated prepareQuery — calls every module's prepareQuery and merges
   * results into one `wasmArgs` blob keyed by short pack id. See § "prepareQuery
   * aggregation" below.
   */
  prepareQuery?(args: PrepareQueryArgs): Promise<PrepareQueryResult<Record<string, unknown>>>;
}

export async function defineComposite(args: DefineCompositeArgs): Promise<CompositePolicyPack>;
```

### Invariant checks at construction time

`defineComposite` MUST throw before returning when:

1. `args.modules.length === 0` — `CompositeBuilderError("modules must be non-empty")`
2. Two modules in `args.modules` derive the same short pack id — `CompositeBuilderError("duplicate short pack id <X>")` (matches encoder's check, but caught earlier with a more curator-friendly path).
3. Any short pack id is NOT in `KNOWN_PACK_IDS` — `UnknownPackIdError(shortId)`. Catches typos and packs that haven't been published.
4. `INewtonPolicy(args.policyAddress).getPolicyData()` length doesn't match `args.modules.length` — `PolicyDataLengthMismatchError(onChainLen, providedLen)`.
5. Positional mismatch: `getDeployment(args.modules[i], args.chainId, args.env).policyData !== onChainPolicyData[i]` (after `getAddress(...)` normalization) — `PolicyDataOrderingMismatchError(moduleIndex, expected, actual)`.
6. Any module's deployment for `(args.chainId, args.env)` is missing — re-throws the existing `UnsupportedChainError` / `UnsupportedEnvError` from `getDeployment`.

### Why async

The on-chain `getPolicyData()` read is the only reason. Could be sync if the curator passed the array directly — but then the curator could pass the wrong array and we wouldn't catch it. Reading from chain is the source of truth; making the builder async is the cost of correctness.

### Why `policyAddress` not derived from `(modules, chainId, env)`

A composite's `NewtonPolicy` address is NOT predictable from its modules — it's a fresh CREATE2 deployment per composite. The curator deployed it via `newton-cli policy deploy`, capturing its address. That address is the curator's input; `defineComposite` validates the on-chain state against it.

## `KNOWN_PACK_IDS` registry

```ts
// packages/policy-pack-shared/src/known-pack-ids.ts

/**
 * Canonical registry of every published @newton-xyz/policy-pack-<name>
 * package's short pack id. Order doesn't matter; presence does.
 *
 * defineComposite rejects modules whose short pack id isn't here. Catches
 * typos, abandoned-but-not-unpublished packs, and registry desync.
 *
 * Adding a new pack: add its short id here in the same PR that adds the
 * pack code. CI fails on uncommitted regen drift.
 */
export const KNOWN_PACK_IDS = [
  "balancer",
  "blockaid",
  "chainalysis",
  "guardrail",
  "persona",
  "redstone",
  "sumsub",
  "vaultsfyi",
  "webacy",
] as const satisfies ReadonlyArray<string>;

export type KnownPackId = (typeof KNOWN_PACK_IDS)[number];
```

### Why the registry lives in `policy-pack-shared`, not generated

Two reasons:

1. **Type narrowing at compile time.** `KnownPackId` is a string literal union (`"balancer" | "blockaid" | ...`); SDK consumers can use it to narrow types when they're handling specific packs. A generated array would lose the literal-union narrowing.
2. **Codegen rejects drift.** `scripts/generate-bindings.ts` cross-checks the discovered pack list against `KNOWN_PACK_IDS` at regen time and fails on missing or extra entries. A pack PR that forgets to update the registry fails CI before merge.

## `prepareQuery` aggregation

A composite's `prepareQuery` calls every module's helper and merges results:

```ts
prepareQuery: async (args) => {
  const results = await Promise.all(
    pack.modules.map(async (m) => {
      if (!m.prepareQuery) return [shortPackIdFromModuleId(m.id), {}] as const;
      const result = await m.prepareQuery(args);
      return [shortPackIdFromModuleId(m.id), result.wasmArgs] as const;
    })
  );
  const merged = Object.fromEntries(results);
  return { wasmArgs: merged };
};
```

Symmetric with how `data.wasm.<shortId>` is composed AVS-side via the merge. Each module's `prepareQuery` runs in parallel; the result is keyed by short pack id.

### Freshness hashes are NOT aggregated

Phase 1's `PrepareQueryResult<T>` carries an optional `freshnessHash?: Hex` field used by VaultsFYI for allocation-binding. Composites can't meaningfully aggregate freshness hashes across modules — `keccak(concatModuleHashes)` collides with single-module freshness, and the AVS doesn't currently consume composite-level freshness. **v1 design:** composites drop freshness hashes. If a curator needs one, they bind their composite to a single module's freshness behavior by listing only that module. v2 question if we ever want composite freshness.

## `getPolicyManifest` discriminated dispatch

For tools (depositor UIs, dashboards) that don't know in advance whether a Shield is bound to a single-pack or composite policy:

```ts
type PolicyManifest<TParams = unknown> =
  | { readonly kind: "single-pack"; readonly params: TParams }
  | { readonly kind: "composite"; readonly manifest: CompositeManifest };

interface GetPolicyManifestArgs {
  readonly publicClient: PublicClient;
  readonly shieldAddress: Address;
  /** Optional: a single-pack PolicyPack if the caller wants params parsed into a typed shape. */
  readonly singlePackPack?: { readonly paramsSchema: z.ZodType<unknown> };
}

export async function getPolicyManifest(
  args: GetPolicyManifestArgs,
): Promise<PolicyManifest>;
```

Walks `getPolicyAddress` → `getPolicyId` → `getPolicyConfig` (same as `introspectComposite`'s first 3 steps), then dispatches:

- If `isCompositeManifest(bytes)` → return `{ kind: "composite", manifest: decodeManifest(bytes) }`
- Otherwise → return `{ kind: "single-pack", params: <bytes parsed via JSON + optional paramsSchema> }`

This lets the Shield SDK's UI surface render the right view without knowing the Shield's policy shape ahead of time.

## SDK consumption helpers

The Shield SDK already accepts `PolicyPack<P, W, S>` from `createShield(...)`. Phase 2 extends that surface to also accept `CompositePolicyPack`:

```ts
// (notional — actual API lives in @newton-xyz/newton-shield-sdk, not this repo)
function createShield<TPack extends PolicyPack<unknown, unknown, unknown> | CompositePolicyPack>(
  args: { ...; pack: TPack; ... }
): Shield;
```

The two cases dispatch on `pack.kind`:
- Single-pack: existing single-pack flow (encode params via `encodePolicyParams`, single PolicyData, single `prepareQuery` call per intent).
- Composite: new flow (encode via `encodeCompositeParams`, multi-PolicyData, aggregated `prepareQuery`).

Phase 2 ships only the policy-pack-shared side. The actual Shield SDK changes ship in newton-shield, NOT this repo. This spec describes the SHARED surface that newton-shield consumes.

## Open questions

- **Should `KNOWN_PACK_IDS` carry version info?** v1 says no — short pack id is identity, not versioning; downstream dispatch on `OracleModule.id` (which carries `<purpose>/<version>`) handles that. **Recommendation:** Skip versioning in the registry.
- **Should `defineComposite` cache the `getPolicyData()` snapshot indefinitely or expire it?** Composites are intended for low-frequency tuning; on-chain state changes are rare. **Recommendation:** Cache for the lifetime of the `CompositePolicyPack` object — callers who suspect drift call `defineComposite` again to rebuild.
- **Should there be a sync `defineCompositeUnchecked(...)` for tests?** Tempting because the async invariant check makes test fixtures noisy. Risk: someone uses the unchecked path in production. **Recommendation:** Add it ONLY if test suites genuinely need it, mark with a clear "DO NOT USE IN PRODUCTION" prefix.
- **Type-narrowing CompositePolicyPack with a typed modules tuple.** `CompositePolicyPack<TModules extends ReadonlyArray<OracleModule<...>>>` could give Phase 2 callers a typed `params` shape. Trade-off: more complex types, harder error messages. **Recommendation:** Skip for v1 — the params validation already happens at runtime via each module's `paramsSchema`.

## Implementation plan

Single PR — Phase 2 implementation:

1. `packages/policy-pack-shared/src/known-pack-ids.ts` — `KNOWN_PACK_IDS` constant + `KnownPackId` type
2. `packages/policy-pack-shared/src/known-pack-ids.test.ts` — unit tests + cross-check that every existing `<name>OracleModule.id` (Phase 1 export) derives a short id present in `KNOWN_PACK_IDS`
3. `packages/policy-pack-shared/src/composite-pack.ts` — `defineComposite`, `CompositePolicyPack`, `CompositeBuilderError`, `UnknownPackIdError`, `PolicyDataLengthMismatchError`, `PolicyDataOrderingMismatchError`, the aggregated `prepareQuery` builder
4. `packages/policy-pack-shared/src/composite-pack.test.ts` — fake `PublicClient`-driven tests covering every invariant check, prepareQuery aggregation, registry-rejection
5. `packages/policy-pack-shared/src/get-policy-manifest.ts` — `getPolicyManifest` discriminated dispatch + tests
6. `scripts/generate-bindings.ts` — cross-check `KNOWN_PACK_IDS` against discovered packs at regen time; fail on missing or extra entries
7. Re-exports from `packages/policy-pack-shared/src/index.ts`

After this lands, `composite-policies.md` Phase 2 status moves from "in progress" to done, and the four-phase composite-policy rollout closes.

## See also

- [`composite-policies.md`](./composite-policies.md) — the curator-facing rollout doc that motivates this builder
- [`composite-manifest-spec.md`](./composite-manifest-spec.md) — Phase 1.5 byte-format spec; `defineComposite` produces inputs `encodeCompositeParams` consumes
- [`packages/policy-pack-shared/src/oracle-module.ts`](../packages/policy-pack-shared/src/oracle-module.ts) — Phase 1's `OracleModule` type
- [`packages/policy-pack-shared/src/composite-manifest.ts`](../packages/policy-pack-shared/src/composite-manifest.ts) — Phase 1.5's `MinimalCompositePack`, `encodeCompositeParams`, `shortPackIdFromModuleId`
