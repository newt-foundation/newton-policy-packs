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
   * The PolicyPack list, in the EXACT order the curator's deployed
   * NewtonPolicy carries them on-chain. defineComposite verifies positional
   * equality against `INewtonPolicy.getPolicyData()` at construction time.
   * Mis-ordered modules fail here — never reach setPolicy.
   *
   * `PolicyPack` (not `OracleModule`) because the composite's runtime path
   * needs `prepareQuery` from each module — `OracleModule` is the
   * manifest-only subset (no `prepareQuery`). Pack packages export both:
   * `<name>` (the PolicyPack) for runtime, `<name>OracleModule` for the
   * manifest layer. defineComposite consumes the runtime form.
   */
  readonly modules: ReadonlyArray<PolicyPack<unknown, unknown, unknown>>;

  readonly chainId: ChainId;
  readonly env: GatewayEnv;

  /**
   * viem PublicClient used to read on-chain state for the invariant check.
   * `publicClient.chain?.id` MUST match `args.chainId` when `chain` is
   * present — defineComposite throws `ChainMismatchError` on mismatch to
   * catch the cross-chain configuration bug class up front.
   */
  readonly publicClient: PublicClient;

  /**
   * The deployed composite NewtonPolicy contract address. The curator obtained
   * this from running `newton-cli policy deploy` with multiple
   * --policy-data-address flags (one per module). The repeated-flag form
   * shipped in newton-prover-avs PR #672 (merged 2026-06-13). The minimum
   * `newton-cli` version that exposes it is pinned at the time of this spec's
   * Phase 2 implementation PR — see the implementation PR description for
   * the released version. Older CLIs only deploy single-PolicyData policies
   * — use the single-pack code path with those.
   */
  readonly policyAddress: Address;

  /**
   * Pinning override for redeploy drift. Defaults to comparing each module's
   * `getDeployment(module, chainId, env).policyData` against the on-chain
   * `getPolicyData()[i]` — works for fresh composites built today.
   *
   * If a pack redeploys (its (chainId, env) cell rolls over to a new
   * policyData address), an EXISTING composite stays valid on-chain — its
   * `getPolicyData()` still returns the OLD addresses. The default
   * comparison would throw `PolicyDataOrderingMismatchError` even though
   * the historical composite is fine. Pass `expectedPolicyDataAddresses`
   * (one per module, in pack-order) to pin to historical addresses; the
   * builder validates against THAT array instead of `module.deployments`.
   */
  readonly expectedPolicyDataAddresses?: ReadonlyArray<Address>;
}

interface CompositePolicyPack {
  readonly kind: "composite";

  /** The same array passed in, validated against on-chain ordering. */
  readonly modules: ReadonlyArray<PolicyPack<unknown, unknown, unknown>>;

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
   *
   * The optional second argument is a per-module options bag keyed by short
   * pack id (e.g. `{ chainalysis: { address: "0x..." }, redstone: { symbol:
   * "ETH", rpcUrl: "...", onchainOracle: "0x..." } }`). Each module's
   * `prepareQuery` receives `args` (publicClient + vault) and its own
   * `options[shortId]`. Modules without a per-call options shape ignore the
   * second arg.
   */
  prepareQuery(
    args: PrepareQueryArgs,
    options?: Record<string, unknown>,
  ): Promise<PrepareQueryResult<Record<string, unknown>>>;
}

export async function defineComposite(args: DefineCompositeArgs): Promise<CompositePolicyPack>;
```

### Invariant checks at construction time

`defineComposite` MUST throw before returning when:

1. `args.modules.length === 0` — `CompositeBuilderError("modules must be non-empty")`.
2. `args.policyAddress === "0x0000...0000"` — `CompositeBuilderError("policyAddress is the zero address")`.
3. `args.publicClient.chain?.id` is set and doesn't match `args.chainId` — `ChainMismatchError(args.chainId, publicClient.chain.id)`. Caught up front because mismatched chain context produces correct-looking but cross-chain-unsafe results.
4. Two modules in `args.modules` derive the same short pack id — `CompositeBuilderError("duplicate short pack id <X>")` (matches encoder's check, but caught earlier with a more curator-friendly path).
5. Any short pack id is NOT in `KNOWN_PACK_IDS` — `UnknownPackIdError(shortId)`. Catches typos and packs that haven't been published.
6. `INewtonPolicy(args.policyAddress).getPolicyData()` length doesn't match `args.modules.length` — `PolicyDataLengthMismatchError(onChainLen, providedLen)`.
7. Positional mismatch: `expectedAddrs[i] !== onChainPolicyData[i]` (after `getAddress(...)` normalization on both sides) — `PolicyDataOrderingMismatchError(moduleIndex, expected, actual)`. The expected addresses come from `args.expectedPolicyDataAddresses` if provided, otherwise from `getDeployment(args.modules[i], args.chainId, args.env).policyData`. If the default lookup fires a mismatch, the error message includes a hint: "*if this composite was deployed before a recent pack redeploy, pass `expectedPolicyDataAddresses` with the historical addresses to pin to the on-chain composite*".
8. Any module's deployment for `(args.chainId, args.env)` is missing AND `expectedPolicyDataAddresses` was NOT provided — re-throws the existing `UnsupportedChainError` / `UnsupportedEnvError` from `getDeployment`. With `expectedPolicyDataAddresses` set, deployment lookup is skipped — historical composites can outlive a pack's current cell.

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

A composite's `prepareQuery` calls every module's helper, threading per-module options, and merges results keyed by short pack id:

```ts
prepareQuery: async (args, options = {}) => {
  const results = await Promise.all(
    pack.modules.map(async (m) => {
      const shortId = shortPackIdFromModuleId(m.id);
      if (!m.prepareQuery) return [shortId, {}] as const;
      // Pass through the per-module options bag — Chainalysis needs
      // `options.address`, RedStone needs `options.symbol/rpcUrl/onchainOracle`,
      // Blockaid needs transaction fields, etc. Modules with no per-call
      // options shape ignore the second arg.
      const result = await m.prepareQuery(args, options[shortId]);
      return [shortId, result.wasmArgs] as const;
    })
  );
  return { wasmArgs: Object.fromEntries(results) };
};
```

Symmetric with how `data.wasm.<shortId>` is composed AVS-side via the merge. Each module's `prepareQuery` runs in parallel; the result is keyed by short pack id.

### Per-module options shape

The composite's `prepareQuery(args, options)` second-arg shape:

```ts
type CompositePrepareQueryOptions = {
  // Keyed by SHORT pack id. Each value is the corresponding module's
  // per-call options, untyped at this layer (each module's PolicyPack
  // narrows its own options shape via its hand-written prepareQuery).
  readonly [shortPackId: string]: unknown;
};
```

Curators construct it module-by-module:

```ts
const compositePack = await defineComposite({ modules, chainId, env, publicClient, policyAddress });
const result = await compositePack.prepareQuery!(
  { publicClient, vault },
  {
    chainalysis: { address: depositorAddress },
    redstone: { symbol: "ETH", rpcUrl, onchainOracle: oracleAddr },
    blockaid: { from, to, value, data },
    // balancer, persona, sumsub, etc. — modules without per-call options omit their key
  },
);
```

The Shield SDK's composite-aware `createShield(...)` will likely wrap this so curators don't construct the options bag manually — but the underlying composite `prepareQuery` accepts it generically.

### Failure semantics: fail-fast

If any module's `prepareQuery` rejects, the aggregated `prepareQuery` rejects with that module's error wrapped in a `CompositePrepareQueryError`:

```ts
class CompositePrepareQueryError extends Error {
  readonly moduleId: string;       // full OracleModule.id
  readonly shortPackId: string;    // for cross-referencing options key
  readonly cause: unknown;         // the original error from module.prepareQuery
}
```

`Promise.all` semantics: the first rejection settles the aggregated promise with that error, but the other modules' promises continue (their results are discarded). Partial `wasmArgs` would let Rego evaluate against missing namespaces, which is worse than failing the whole intent — fail-fast is the right default.

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

- If `isCompositeManifest(bytes)` → return `{ kind: "composite", manifest: decodeManifest(bytes) }`. `decodeManifest` throws the existing Phase 1.5 typed errors (`BadManifestMagicError`, `UnsupportedManifestVersionError`, `MalformedManifestError`) on a blob that *looks* like a composite (has `_manifest`) but is structurally invalid; `getPolicyManifest` propagates these without wrapping.
- Otherwise — try `JSON.parse(utf8Decode(bytes))`. If that throws, surface `NotJsonError` (the existing Phase 1.5 class). If JSON parses, return `{ kind: "single-pack", params: <parsed value, optionally validated via singlePackPack.paramsSchema> }`. If `singlePackPack.paramsSchema.safeParse(...)` fails, surface a `SinglePackParamsValidationError` carrying the zod issues.

The dispatcher does NOT silently coerce corrupt bytes into a "single-pack" verdict — every recoverable failure mode has a typed error so depositor UIs can render the right "this Shield's policy is malformed" message.

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
- **Type-narrowing CompositePolicyPack with a typed modules tuple.** `CompositePolicyPack<TModules extends ReadonlyArray<PolicyPack<...>>>` could give Phase 2 callers a typed `params` shape. Trade-off: more complex types, harder error messages. **Recommendation:** Skip for v1 — the params validation already happens at runtime via each module's `paramsSchema`.

## Implementation plan

Single PR — Phase 2 implementation:

1. `packages/policy-pack-shared/src/known-pack-ids.ts` — `KNOWN_PACK_IDS` constant + `KnownPackId` type
2. `packages/policy-pack-shared/src/known-pack-ids.test.ts` — unit tests + cross-check that every existing `<name>OracleModule.id` (Phase 1 export) derives a short id present in `KNOWN_PACK_IDS`
3. `packages/policy-pack-shared/src/composite-pack.ts` — `defineComposite`, `CompositePolicyPack`, error classes (`CompositeBuilderError`, `UnknownPackIdError`, `PolicyDataLengthMismatchError`, `PolicyDataOrderingMismatchError`, `ChainMismatchError`, `CompositePrepareQueryError`), the aggregated `prepareQuery` builder, the `expectedPolicyDataAddresses` historical-pinning path
4. `packages/policy-pack-shared/src/composite-pack.test.ts` — fake `PublicClient`-driven tests covering every invariant check (zero-address, chain mismatch, duplicate short ids, unknown short ids, length mismatch, ordering mismatch with and without historical pinning), prepareQuery aggregation (per-module options threading, fail-fast on rejection, modules without `prepareQuery`), registry-rejection
5. `packages/policy-pack-shared/src/get-policy-manifest.ts` — `getPolicyManifest` discriminated dispatch + `SinglePackParamsValidationError` + tests covering single-pack happy path, composite happy path, NotJsonError surfacing, BadManifestMagicError / UnsupportedManifestVersionError / MalformedManifestError surfacing, single-pack params schema validation failure
6. `scripts/generate-bindings.ts` — cross-check `KNOWN_PACK_IDS` against discovered packs at regen time; fail on missing or extra entries
7. Re-exports from `packages/policy-pack-shared/src/index.ts`

After this lands, `composite-policies.md` Phase 2 status moves from "in progress" to done, and the four-phase composite-policy rollout closes.

## See also

- [`composite-policies.md`](./composite-policies.md) — the curator-facing rollout doc that motivates this builder
- [`composite-manifest-spec.md`](./composite-manifest-spec.md) — Phase 1.5 byte-format spec; `defineComposite` produces inputs `encodeCompositeParams` consumes
- [`packages/policy-pack-shared/src/oracle-module.ts`](../packages/policy-pack-shared/src/oracle-module.ts) — Phase 1's `OracleModule` type
- [`packages/policy-pack-shared/src/composite-manifest.ts`](../packages/policy-pack-shared/src/composite-manifest.ts) — Phase 1.5's `MinimalCompositePack`, `encodeCompositeParams`, `shortPackIdFromModuleId`
