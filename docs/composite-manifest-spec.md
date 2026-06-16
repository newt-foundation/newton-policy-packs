# Composite policy manifest format — design spec

**Status:** Phase 1.5 implementation merged. Full byte-level spec. This is the byte-level spec for the composite-policy on-chain manifest written via `Shield.setPolicy(policyParams, expireAfter)`. Phase 1.5 of the composite rollout (NEWT-1541) — see [`composite-policies.md`](./composite-policies.md) for the surrounding rollout context.

This spec answers: what bytes does `encodeCompositeParams(pack, params)` produce, and what does `decodeManifest(bytes)` reverse? It is the contract between three audiences:

- **Curators** building composites via `defineComposite(...)` in Phase 2 — they shouldn't need to know byte details, but the format must be encodeable from the typed inputs they hand the builder.
- **Depositors** verifying a composite policy on-chain — depositors hold the consuming Shield's address (the client). They derive the depositor read path in three steps: (1) `policyAddress = INewtonPolicyClient(shield).getPolicyAddress()` — the deployed `NewtonPolicy` contract bound to the Shield; (2) `policyId = INewtonPolicy(policyAddress).getPolicyId(shield)` — the keccak hash binding the Shield client to its policy slot; (3) `policyParams = INewtonPolicy(policyAddress).getPolicyConfig(policyId).policyParams` — the manifest bytes. Then `decodeManifest(policyParams)` and validate `modules[*].policyDataAddress` (ordered, position-significant) against `INewtonPolicy(policyAddress).getPolicyData()`, AND `modules[*].wasmCid` against `INewtonPolicyData(<each-policy-data-address>).getWasmCid()` (returns `string memory`). Verified against [`newton-prover-avs/contracts/src/interfaces/INewtonPolicy.sol`](https://github.com/newt-foundation/newton-prover-avs/blob/main/contracts/src/interfaces/INewtonPolicy.sol) (lines 70, 108) and `INewtonPolicyData.sol:37` — the spec uses the actual accessor names, not invented ones. `introspectComposite(...)` (defined below) wraps all three RPC reads + the byte-level validation.
- **The AVS host** evaluating policies — already reads `policyParams: bytes` as UTF-8 JSON per [NEWT-1516](https://linear.app/magiclabs/issue/NEWT-1516) (`newton-prover-avs/crates/core/src/common/task.rs:402-408` calls `String::from_utf8` → `serde_json::from_str` → `validate_schema`). The composite manifest must remain a valid JSON document that the AVS can parse and forward to the merged Rego evaluator without protocol-level changes.

## Goals

1. **Wire-compatible with the existing single-pack flat-JSON `policyParams`** so the AVS host doesn't need new decoder logic for composites — `decodeManifest` is a pure SDK-side concern.
2. **Versioned** — a magic-byte discriminator + version field so we can evolve the format without breaking depositors who pinned an old SDK.
3. **Canonical** — sorted-key UTF-8 JSON throughout, so `encodeCompositeParams` is deterministic byte-for-byte and `decodeManifest(encodeCompositeParams(x))` round-trips.
4. **Position-significant** — `modules[]` ordering matches the on-chain `INewtonPolicy.getPolicyData()` array order, enforced by `PolicyValidationLib.sol:51-57`.
5. **Cheap to validate** — depositors should be able to verify the manifest without re-running the policy: a few RPC reads (`getPolicyData()`, `getWasmCid()` per module) plus byte equality.

## Non-goals

- Encrypting the manifest. `policyParams` is public; depositor verification depends on it being readable.
- Supporting more than one composite layer. v1 manifests describe a flat list of modules; nested composites are not in scope (and are probably the wrong shape anyway — flatten at authoring time).
- Reusing the same bytes across `(chainId, env)` cells. A composite manifest is `(chainId, env)`-specific because `policy_data_address` and `wasm_cid` are sliced from per-cell deployments. One composite, many cells, many manifest blobs (one per cell, written via `Shield.setPolicy(...)` per Shield clone).

## Outer envelope

The on-chain `policyParams` blob for a composite is **a single UTF-8 JSON object** — not an ABI tuple. Same shape the AVS host already parses for single-pack params, with a magic-byte discriminator at a known key:

```json
{
  "_manifest": {
    "magic": "NPM1",
    "version": 1
  },
  "modules": [
    { "id": "...", "policyDataAddress": "0x...", "wasmCid": "bafy..." },
    ...
  ],
  "params": {
    "<short-pack-id>": { /* params for that module */ },
    ...
  }
}
```

### Why JSON, not an ABI tuple

Two reasons:

1. **AVS-host compatibility.** The AVS already calls `serde_json::from_str` on `policyParams: bytes` (NEWT-1516). Wrapping the JSON in an ABI tuple would force a host-side decoder change; embedding magic bytes inside the JSON keeps the host's existing path unchanged.
2. **Single-pack consistency.** Today's single-pack params are flat JSON objects (e.g. `{"floor":80,"deny_on_X":true}`). A composite manifest with `_manifest` / `modules` / `params` sibling keys at the top level is recognizable as a composite via key presence, no separate decoder branch needed at the AVS host.

### Why `_manifest` (with leading underscore)

The `_manifest` key namespace is reserved by the SDK side. Pack authors are forbidden from including a top-level `_manifest` key in their `params_schema.json` (enforced at codegen time when Phase 2 lands). Single-pack curators never write this key, so its presence is the unambiguous discriminator: `_manifest` present → composite; absent → flat single-pack params.

The leading underscore signals "this is metadata, not user-tunable params" — same convention as Python and JSON Schema.

## Magic + version

| Field | Type | Purpose |
|---|---|---|
| `_manifest.magic` | string, exactly `"NPM1"` | Newton Policy Manifest v1 discriminator. Distinguishes a composite manifest from any other JSON-shaped `policyParams` blob a future tool might write. |
| `_manifest.version` | integer, currently `1` | Manifest schema version. Future format breaks bump this. |

Decoders MUST reject any blob where `_manifest.magic !== "NPM1"` with a `BadManifestMagicError` carrying the offending value. Decoders MUST reject `_manifest.version` they don't understand with `UnsupportedManifestVersionError` carrying the version + the highest version the decoder supports.

`encodeCompositeParams` always emits `magic: "NPM1"` and the highest version the SDK build understands.

## `modules[]`

Ordered array — position-significant. Each entry:

```json
{
  "id": "<pack-id>",
  "policyDataAddress": "0x<address>",
  "wasmCid": "bafy<cid>"
}
```

| Field | Type | Source |
|---|---|---|
| `id` | string | `OracleModule.id` (e.g. `"vaultsfyi/risk-envelope/v1"`). Used for traceability in introspection. The `params` map is keyed by the SHORT pack id derived from this — see "params" section below. |
| `policyDataAddress` | EIP-55-checksummed address string | `getDeployment(module, chainId, env).policyData`. EIP-55 is the wire format we emit; equality comparisons MUST normalize both sides via `getAddress(...)` (or lowercase) before checking, since solidity returns 20-byte address values that any ABI decoder may format differently. The byte form in the JSON manifest stays EIP-55 for grep-ability. |
| `wasmCid` | string (CIDv1, base32-lower) | `getDeployment(module, chainId, env).wasmCid`. Used by depositors against `INewtonPolicyData(addr).getWasmCid()` (returns `string memory` per [`INewtonPolicyData.sol:37`](https://github.com/newt-foundation/newton-prover-avs/blob/main/contracts/src/interfaces/INewtonPolicyData.sol#L37)). |

**Ordering invariant.** `modules[i].policyDataAddress` MUST equal `INewtonPolicy.getPolicyData()[i]` (after normalization) for every `i`. [`PolicyValidationLib.sol:51-57`](https://github.com/newt-foundation/newton-prover-avs/blob/main/contracts/src/libraries/PolicyValidationLib.sol#L48) enforces this on-chain — submitting a composite execution with a re-ordered `policyData` array reverts. `defineComposite(...)` in Phase 2 reads `getPolicyData()` at construction time and validates the curator's modules array against it before encoding.

`decodeManifest(bytes)` does NOT make on-chain calls; it returns the modules array as-is. `introspectComposite({ publicClient, shieldAddress })` is the on-chain-validating helper that walks the depositor read path end-to-end — see below.

## `params`

Object keyed by **short pack id** (e.g. `"vaultsfyi"`, `"chainalysis"`) — the same identifier `wrapOutput("vaultsfyi", ...)` uses for `data.wasm.vaultsfyi` Phase 0 namespacing. Symmetric across the AVS-side namespaces:

```json
{
  "vaultsfyi": { "risk_score_floor": 80, /* ... */ },
  "chainalysis": { "deny_on_sanctioned": true, /* ... */ }
}
```

Each value is the params object the AVS host forwards to that module's WASM. The AVS-side merge is shallow per [NEWT-1516](https://linear.app/magiclabs/issue/NEWT-1516); the Rego sees `data.params.<short-pack-id>.<field>` after evaluation — plain dot notation, NOT bracket-on-slashes.

**Why short pack ids in `params` keys, but full module ids in `modules[].id`.** The two serve different purposes:

- `modules[].id` carries the full `OracleModule.id` (e.g. `"vaultsfyi/risk-envelope/v1"`) — unambiguous traceability that survives multiple versions or purposes of the same pack. Depositor introspection cross-references `OracleModule.id` directly against published artifacts.
- `params` keys use the short pack id derived via `shortPackIdFromModuleId(module.id)` (everything before the first `/`) — readable Rego access (`data.params.vaultsfyi.field`, matching `data.wasm.vaultsfyi.field`) and symmetric with the Phase 0 namespacing convention.

The encoder (`encodeCompositeParams`) rejects packs where two modules derive the same short id — that would make `data.params.<shortId>` ambiguous in Rego. `KNOWN_PACK_IDS` in Phase 2 will mechanically enforce uniqueness across the published-pack universe.

`encodeCompositeParams` validates each `params[shortId]` against the corresponding module's `paramsSchema` (zod) before emitting bytes. Schema mismatch throws `CompositeParamsValidationError` with the offending module + zod issue list.

## Canonical-form encoding

The exact byte form `encodeCompositeParams` produces:

1. Build the JS object `{ _manifest, modules, params }`.
2. `JSON.stringify` with **recursively sorted keys** at every level — same canonicalizer as `encodePolicyParams` for single-pack params.
3. UTF-8 encode → `bytes`.

This guarantees `encodeCompositeParams(pack, p1)` and `encodeCompositeParams(pack, p2)` produce byte-identical output **iff `p1` and `p2` are deeply equal as JS values** (i.e. `JSON.stringify` of canonical-key form is deterministic per JS-value identity).

**Numeric canonicalization caveat.** Sorted-key form does NOT solve floating-point equivalence. Two callers passing logically-equivalent thresholds via different arithmetic (`0.3` vs `0.1 + 0.2`) will produce byte-different manifests because the underlying `number` values differ. Pack `paramsSchema` definitions SHOULD use integer / fixed-point units (e.g. basis points) to dodge this — vaultsfyi already enforces basis-point precision on its fractional fields via a `superRefine` for exactly this reason. The spec's "canonical form" claim covers JS-value identity, not logical equivalence; pack authors carrying numeric tolerance shoulder the canonicalization themselves.

## Decoder API

### `decodeManifest(bytes): CompositeManifest`

Pure decoder. Validates magic + version, parses JSON, returns the typed manifest. No on-chain calls.

```ts
interface CompositeManifest {
  magic: "NPM1";
  version: number;
  modules: ReadonlyArray<{
    readonly id: string;
    readonly policyDataAddress: `0x${string}`;
    readonly wasmCid: string;
  }>;
  params: Readonly<Record<string, unknown>>;
}
```

Throws:

- `NotJsonError` — bytes don't parse as UTF-8 JSON at all
- `NotAManifestError` — JSON parses but the `_manifest` key is absent (the blob is probably a single-pack flat-JSON params blob); `err.parsedJson` carries the parsed value so the caller can pass it to `pack.paramsSchema.parse(err.parsedJson)` without re-parsing
- `BadManifestMagicError` — `_manifest.magic !== "NPM1"`
- `UnsupportedManifestVersionError` — `_manifest.version` is past the SDK's max
- `MalformedManifestError` — required fields missing or wrong type after the magic/version checks pass

`decodeManifest` does NOT call any zod schemas — it has no `pack` reference and would have to look up each module's schema from a registry. That's `introspectComposite`'s job.

### `isCompositeManifest(bytes): boolean`

Cheap pre-check. Returns `true` iff the bytes parse as JSON with a `_manifest.magic === "NPM1"` field. Useful for tools dispatching between single-pack and composite paths without throwing.

### `introspectComposite(ctx): Promise<IntrospectedComposite>`

On-chain-validating helper for depositors. Walks the full depositor read path AND verifies the manifest against on-chain state:

```ts
interface IntrospectCompositeArgs {
  publicClient: PublicClient;
  shieldAddress: Address;  // the consuming Shield (PolicyClient)
}

interface IntrospectedComposite {
  policyAddress: Address;       // resolved via shield.getPolicyAddress()
  policyId: `0x${string}`;      // resolved via getPolicyId(shieldAddress)
  manifest: CompositeManifest;  // decoded from getPolicyConfig(policyId).policyParams
  verification: {
    onChainPolicyDataMatches: boolean; // modules[i].policyDataAddress === getPolicyData()[i]
    wasmCidsMatch: ReadonlyArray<{ moduleIndex: number; matches: boolean; reason?: string }>;
  };
}
```

The helper:

1. Reads `policyAddress = INewtonPolicyClient(shieldAddress).getPolicyAddress()`.
2. Reads `policyId = INewtonPolicy(policyAddress).getPolicyId(shieldAddress)`.
3. Reads `policyParams = INewtonPolicy(policyAddress).getPolicyConfig(policyId).policyParams`.
4. Calls `decodeManifest(policyParams)`.
5. Reads `INewtonPolicy(policyAddress).getPolicyData()` and verifies positional equality of `policyDataAddress` values (after `getAddress(...)` normalization on both sides).
6. For each module, reads `INewtonPolicyData(modules[i].policyDataAddress).getWasmCid()` and verifies it equals `modules[i].wasmCid`.
7. Returns the full report — does NOT throw on mismatch. Depositor UIs decide how to surface failures.

**RPC batching.** When `client.chain.contracts.multicall3` is configured, the helper uses viem's `multicall` to fan out steps 2 and 3 in a single RPC. When multicall is unavailable (no `multicall3` address on the chain config), it falls back to N+1 sequential `readContract` calls (1 for `getPolicyData()`, N for each `getWasmCid()`). Both supported testnets (Sepolia chain `11155111`, Base Sepolia chain `84532`) have multicall3 deployed at the canonical address, so the fallback is rare in practice — but it's a hard requirement, not a "best-effort" path. Implementations MUST exercise both branches in tests.

## Single-pack manifests

**v1 does NOT promote single-pack policies into the manifest format.** Single-pack `policyParams` remains a flat JSON object `{"<field>": <value>, ...}` — what the AVS already reads. The `_manifest` key absence is the discriminator.

Tools dispatching between single-pack and composite paths use `isCompositeManifest(bytes)` for branchless detection. The Shield SDK's `getPolicyManifest(...)` helper (Phase 2) returns a discriminated union:

```ts
type PolicyManifest =
  | { kind: "single-pack"; params: unknown /* validated against pack.paramsSchema */ }
  | { kind: "composite"; manifest: CompositeManifest };
```

Future v2 of this spec MAY promote single-pack into the composite shape (`modules: [...]` with length 1) for uniformity. Out of scope for v1.

## Error semantics

All errors thrown by `decodeManifest`, `introspectComposite`, and `encodeCompositeParams` are typed and namespaced:

| Error | When | Recovery |
|---|---|---|
| `NotAManifestError` | bytes parse as JSON but lack `_manifest` key | Probably a single-pack params blob — call `pack.paramsSchema.parse(parsedJson)` (the parsed value is exposed on `err.parsedJson` so the recovery doesn't re-invoke `JSON.parse` on bytes that may already have failed). If the bytes weren't JSON in the first place, a different error is thrown — see below. |
| `NotJsonError` | bytes don't parse as UTF-8 JSON at all | Bytes were written by an unrelated tool (maybe ABI-encoded params from a pre-NEWT-1516 SDK, or random binary) — surface to user. Distinct from `NotAManifestError` so the "try single-pack" recovery hint doesn't crash on non-JSON input. |
| `BadManifestMagicError` | `_manifest.magic !== "NPM1"` | Bytes were written by an unrelated tool — surface to user; don't auto-recover |
| `UnsupportedManifestVersionError` | `_manifest.version > MAX_SUPPORTED` | Upgrade the SDK; older SDKs cannot read newer manifests |
| `MalformedManifestError` | post-magic structural validation failed | Fix the writer — usually a `defineComposite` bug |
| `CompositeParamsValidationError` | one of `params[shortId]` failed its module's `paramsSchema` (zod) — thrown by `encodeCompositeParams` before bytes are emitted | Fix the offending params; `err.moduleId` + `err.zodIssues` carry context |

## Implementation plan

The actual code lands in a follow-up PR (Phase 1.5 implementation). Two scope options to nail down before that PR opens:

### Option A — read path only, fixture-based tests

1. `packages/policy-pack-shared/src/composite-manifest.ts` — type + `decodeManifest` + `isCompositeManifest` + error classes (`NotAManifestError`, `NotJsonError`, `BadManifestMagicError`, `UnsupportedManifestVersionError`, `MalformedManifestError`)
2. `packages/policy-pack-shared/src/composite-manifest.test.ts` — fixture-decode tests (hand-rolled byte fixtures), version mismatch, magic mismatch, malformed cases. **No round-trip tests** — those require the encoder, which lands in Phase 2 with `defineComposite`.
3. `packages/policy-pack-shared/src/composite-introspect.ts` — `introspectComposite` (depends on `viem` peer-dep for `PublicClient`)
4. `packages/policy-pack-shared/src/composite-introspect.test.ts` — uses a mock `PublicClient` to exercise both the multicall path and the sequential-fallback path
5. Re-exports from `packages/policy-pack-shared/src/index.ts`

### Option B — read + write paired in Phase 1.5

Same as Option A plus `encodeCompositeParams(pack, params)` (the byte producer, no on-chain calls) so the test suite can exercise round-trip identity. Signature: `pack` is a `CompositePolicyPack` (the type Phase 2's `defineComposite` produces) carrying both the typed `modules` array AND each module's `paramsSchema` — needed because the encoder validates `params[shortId]` against `pack.modules[i].paramsSchema` before emitting bytes (`shortId = shortPackIdFromModuleId(module.id)`). The single-arg shape mirrors `encodePolicyParams(pack, params)` for single-pack params (see [`packages/policy-pack-shared/src/encoding.ts`](../packages/policy-pack-shared/src/encoding.ts)).

For Phase 1.5, the implementation defines a minimal `CompositePolicyPack` shape (just `modules: ReadonlyArray<OracleModule<...>>`) so `encodeCompositeParams` can run before Phase 2's `defineComposite` builder lands. Phase 2 fills in the rest of `CompositePolicyPack` (e.g. cached on-chain `getPolicyData()` snapshot for invariants, `prepareQuery` aggregation across modules) without changing the encoder's signature.

**Recommendation: Option B.** Putting encoder + decoder in the same module is the standard pattern (see `encoding.ts` for single-pack), tests are stronger, and `defineComposite` becomes a pure builder — no byte logic. The cost is one extra function in Phase 1.5, which is small.

### `_manifest` key reservation enforcement

Codegen-time check in `scripts/generate-bindings.ts`: when reading each pack's `params_schema.json`, fail if the schema declares a top-level `_manifest` property. This is mechanical enforcement of the spec's reservation — without it, a future pack author could accidentally collide with the discriminator. Lands as part of the Phase 1.5 implementation PR.

## Open questions

These are flagged for review on this design PR:

- **Magic-byte length / format.** 4-char ASCII (`"NPM1"`) is human-readable in JSON. Alternative: a 4-byte hex like `"0x4e504d31"`. ASCII wins on grep-ability and editor inspection; hex wins on a tiny serialization-size advantage. **Recommendation:** ASCII.
- **`policyDataAddress` casing.** EIP-55 checksummed (preserves bytewise comparison against viem-formatted addresses) vs all-lowercase (smaller, simpler equality). **Recommendation:** EIP-55, since most viem call returns are checksummed.
- **`wasmCid` form.** CIDv1 base32-lower (the form `policy_cids.json` writes today) vs CIDv0 base58. **Recommendation:** CIDv1 base32-lower — matches what the AVS-side `INewtonPolicyData.getWasmCid()` returns and what the upload pipeline pins to Pinata.
- **Should `_manifest` carry `chainId` and `env` fields?** Pro: depositors can sanity-check they're verifying against the right cell. Con: the cell is implied by the on-chain Shield they're querying. **Recommendation:** Skip for v1. Add in v2 if a real failure mode surfaces.
- **What happens if `params[shortId]` is missing for a module in `modules[]`?** Either the module's WASM gets `{}` as params (lenient) or `decodeManifest` throws `MalformedManifestError` (strict). **Recommendation:** Strict — every module declared in `modules[]` MUST have a corresponding `params[shortId]` entry, even if the entry is `{}`. Catches a class of partial-write bugs.

## See also

- [`composite-policies.md`](./composite-policies.md) — the curator-facing rollout doc that motivates this format
- [NEWT-1516](https://linear.app/magiclabs/issue/NEWT-1516) — the AVS-side `policyParams` decoder (UTF-8 JSON, sorted keys) this spec inherits from
- [`packages/policy-pack-shared/src/encoding.ts`](../packages/policy-pack-shared/src/encoding.ts) — `encodePolicyParams` / `decodePolicyParams` for single-pack params, the canonical-form ancestor of this spec
- [`packages/policy-pack-shared/src/oracle-module.ts`](../packages/policy-pack-shared/src/oracle-module.ts) — Phase 1's `OracleModule` type, what `defineComposite` (Phase 2) consumes when building manifests
