# Composite policy manifest format — design spec

**Status:** Proposed. This is the byte-level spec for the composite-policy on-chain manifest written via `Shield.setPolicy(policyParams, expireAfter)`. Phase 1.5 of the composite rollout (NEWT-1541) — see [`composite-policies.md`](./composite-policies.md) for the surrounding rollout context.

This spec answers: what bytes does `encodeCompositeParams(pack, params)` produce, and what does `decodeManifest(bytes)` reverse? It is the contract between three audiences:

- **Curators** building composites via `defineComposite(...)` in Phase 2 — they shouldn't need to know byte details, but the format must be encodeable from the typed inputs they hand the builder.
- **Depositors** verifying a composite policy on-chain — they call `decodeManifest(bytes)` on `INewtonPolicy.policyParams()` and validate `modules[*].policy_data_address` against `INewtonPolicy.getPolicyData()` and `modules[*].wasm_cid` against `INewtonPolicyData.getWasmCid()`.
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
    "<module-id>": { /* params for that module */ },
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
| `id` | string | `OracleModule.id` (e.g. `"vaultsfyi/risk-envelope/v1"`). Used for namespace lookups in `params`, e.g. `params[id]`. |
| `policyDataAddress` | EIP-55-checksummed address | `getDeployment(module, chainId, env).policyData`. Lowercased + EIP-55 to enable byte-equality comparison against `INewtonPolicy.getPolicyData()` returns. |
| `wasmCid` | string (CIDv1, base32-lower) | `getDeployment(module, chainId, env).wasmCid`. Used by depositors against `INewtonPolicyData.getWasmCid()`. |

**Ordering invariant.** `modules[i].policyDataAddress` MUST equal `INewtonPolicy.getPolicyData()[i]` for every `i`. `PolicyValidationLib.sol:51-57` enforces this on-chain — submitting a composite execution with a re-ordered `policyData` array reverts. `defineComposite(...)` in Phase 2 reads `getPolicyData()` at construction time and validates the curator's modules array against it before encoding.

`decodeManifest(bytes)` does NOT make on-chain calls; it returns the modules array as-is. `introspectComposite(bytes, { publicClient, policyAddress })` is the on-chain-validating helper — see below.

## `params`

Object keyed by module `id`:

```json
{
  "vaultsfyi/risk-envelope/v1": { "risk_score_floor": 80, /* ... */ },
  "chainalysis/screening/v1": { "deny_on_sanctioned": true, /* ... */ }
}
```

Each value is the params object the AVS host forwards to that module's WASM. The AVS-side merge is shallow per [NEWT-1516](https://linear.app/magiclabs/issue/NEWT-1516); the Rego sees `data.params.<module-id>.<field>` after evaluation.

**Note on namespacing.** Earlier versions of this spec considered hoisting per-module params under their `<pack-id>` namespace at the manifest top level (alongside `_manifest` / `modules`). Rejected: `params` as a single nested object keeps the manifest's three top-level "metadata" keys (`_manifest`, `modules`, `params`) clearly separated from any future fields, and matches the [`composite-policies.md` Rego authoring guide](./composite-policies.md#authoring-a-composite--five-concrete-steps) where `data.params.<id>.<field>` is the documented access path.

`encodeCompositeParams` validates each `params[id]` against the corresponding module's `paramsSchema` (zod) before emitting bytes. Schema mismatch throws `CompositeParamsValidationError` with the offending module + zod issue list.

## Canonical-form encoding

The exact byte form `encodeCompositeParams` produces:

1. Build the JS object `{ _manifest, modules, params }`.
2. `JSON.stringify` with **recursively sorted keys** at every level — same canonicalizer as `encodePolicyParams` for single-pack params.
3. UTF-8 encode → `bytes`.

This guarantees `encodeCompositeParams(pack, p1)` and `encodeCompositeParams(pack, p2)` produce byte-identical output iff `p1` and `p2` are deeply equal. `decodeManifest(encodeCompositeParams(x))` round-trips structurally.

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

- `NotAManifestError` — bytes don't parse as JSON, or `_manifest` key absent (the blob is probably a single-pack flat-JSON params blob, not a composite manifest)
- `BadManifestMagicError` — `_manifest.magic !== "NPM1"`
- `UnsupportedManifestVersionError` — `_manifest.version` is past the SDK's max
- `MalformedManifestError` — required fields missing or wrong type after the magic/version checks pass

`decodeManifest` does NOT call any zod schemas — it has no `pack` reference and would have to look up each module's schema from a registry. That's `introspectComposite`'s job.

### `isCompositeManifest(bytes): boolean`

Cheap pre-check. Returns `true` iff the bytes parse as JSON with a `_manifest.magic === "NPM1"` field. Useful for tools dispatching between single-pack and composite paths without throwing.

### `introspectComposite(bytes, ctx): Promise<IntrospectedComposite>`

On-chain-validating helper for depositors. Decodes the manifest AND verifies it against on-chain state:

```ts
interface IntrospectComposite {
  publicClient: PublicClient;
  policyAddress: Address;
}

interface IntrospectedComposite {
  manifest: CompositeManifest;
  verification: {
    onChainPolicyDataMatches: boolean; // modules[i].policyDataAddress === getPolicyData()[i]
    wasmCidsMatch: ReadonlyArray<{ moduleIndex: number; matches: boolean; reason?: string }>;
  };
}
```

The helper:

1. Calls `decodeManifest(bytes)`.
2. Reads `INewtonPolicy(policyAddress).getPolicyData()` and verifies positional equality of `policyDataAddress` values.
3. For each module, reads `INewtonPolicyData(modules[i].policyDataAddress).getWasmCid()` and verifies it equals `modules[i].wasmCid`.
4. Returns the full report — does NOT throw on mismatch. Depositor UIs decide how to surface failures.

Network calls are batched via viem's multicall when supported.

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

All errors thrown by `decodeManifest` and `introspectComposite` are typed and namespaced:

| Error | When | Recovery |
|---|---|---|
| `NotAManifestError` | bytes lack `_manifest` key | Probably a single-pack params blob — call `pack.paramsSchema.parse(JSON.parse(bytes))` instead |
| `BadManifestMagicError` | `_manifest.magic !== "NPM1"` | Bytes were written by an unrelated tool — surface to user; don't auto-recover |
| `UnsupportedManifestVersionError` | `_manifest.version > MAX_SUPPORTED` | Upgrade the SDK; older SDKs cannot read newer manifests |
| `MalformedManifestError` | post-magic structural validation failed | Fix the writer — usually a `defineComposite` bug |

## Implementation plan

The actual code lands in a follow-up PR (Phase 1.5 implementation):

1. `packages/policy-pack-shared/src/composite-manifest.ts` — type + `decodeManifest` + `isCompositeManifest` + error classes
2. `packages/policy-pack-shared/src/composite-manifest.test.ts` — round-trip + version mismatch + magic mismatch + malformed cases
3. `packages/policy-pack-shared/src/composite-introspect.ts` — `introspectComposite` (depends on `viem` peer-dep for `PublicClient`)
4. `packages/policy-pack-shared/src/composite-introspect.test.ts` — uses a mock `PublicClient` to exercise the on-chain verification paths
5. Re-exports from `packages/policy-pack-shared/src/index.ts`

`encodeCompositeParams` is part of Phase 2's `defineComposite` work — it depends on the `OracleModule` array + the curator's typed params, which is the builder's surface. Phase 1.5 ships only the read path so depositors and tools can introspect manifests without waiting for Phase 2.

## Open questions

These are flagged for review on this design PR:

- **Magic-byte length / format.** 4-char ASCII (`"NPM1"`) is human-readable in JSON. Alternative: a 4-byte hex like `"0x4e504d31"`. ASCII wins on grep-ability and editor inspection; hex wins on a tiny serialization-size advantage. **Recommendation:** ASCII.
- **`policyDataAddress` casing.** EIP-55 checksummed (preserves bytewise comparison against viem-formatted addresses) vs all-lowercase (smaller, simpler equality). **Recommendation:** EIP-55, since most viem call returns are checksummed.
- **`wasmCid` form.** CIDv1 base32-lower (the form `policy_cids.json` writes today) vs CIDv0 base58. **Recommendation:** CIDv1 base32-lower — matches what the AVS-side `INewtonPolicyData.getWasmCid()` returns and what the upload pipeline pins to Pinata.
- **Should `_manifest` carry `chainId` and `env` fields?** Pro: depositors can sanity-check they're verifying against the right cell. Con: the cell is implied by the on-chain Shield they're querying. **Recommendation:** Skip for v1. Add in v2 if a real failure mode surfaces.
- **What happens if `params[id]` is missing for a module in `modules[]`?** Either the module's WASM gets `{}` as params (lenient) or `decodeManifest` throws `MalformedManifestError` (strict). **Recommendation:** Strict — every module declared in `modules[]` MUST have a corresponding `params[id]` entry, even if the entry is `{}`. Catches a class of partial-write bugs.

## See also

- [`composite-policies.md`](./composite-policies.md) — the curator-facing rollout doc that motivates this format
- [NEWT-1516](https://linear.app/magiclabs/issue/NEWT-1516) — the AVS-side `policyParams` decoder (UTF-8 JSON, sorted keys) this spec inherits from
- [`packages/policy-pack-shared/src/encoding.ts`](../packages/policy-pack-shared/src/encoding.ts) — `encodePolicyParams` / `decodePolicyParams` for single-pack params, the canonical-form ancestor of this spec
- [`packages/policy-pack-shared/src/oracle-module.ts`](../packages/policy-pack-shared/src/oracle-module.ts) — Phase 1's `OracleModule` type, what `defineComposite` (Phase 2) consumes when building manifests
