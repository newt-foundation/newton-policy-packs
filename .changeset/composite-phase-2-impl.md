---
"@newton-xyz/policy-pack-shared": patch
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

Composite-policy Phase 2: `defineComposite` builder + `KNOWN_PACK_IDS` registry + SDK consumption helpers (NEWT-1542). Implements the spec from PR #72.

New exports from `@newton-xyz/policy-pack-shared`:

- `defineComposite({ modules, chainId, env, publicClient, policyAddress, expectedPolicyDataAddresses?, expectedWasmCids? }): Promise<CompositePolicyPack>` — async curator-facing builder. Reads `INewtonPolicy.getPolicyData()` at construction time to enforce positional ordering against the modules array. Supports historical-pinning for composites deployed before a pack redeploy.
- `encodeCompositePolicyPack(pack, params): Hex` — convenience wrapper around `encodeCompositeParams` that threads the historical bindings carried on `CompositePolicyPack`. Curators using a fresh composite get the right bytes; curators using a historical-pin get the pinned addresses.
- `getPolicyManifest({ publicClient, shieldAddress, singlePackPack? }): Promise<PolicyManifest>` — discriminated dispatch returning `{ kind: "single-pack", params } | { kind: "composite", manifest }`. Surfaces Phase 1.5 typed errors (`NotJsonError`, `BadManifestMagicError`, `MalformedManifestError`, etc.) on corrupt input — no silent coercion.
- `KNOWN_PACK_IDS` (`as const` literal-union) + `KnownPackId` type + `isKnownPackId` guard.
- `HistoricalBinding` type + extended `encodeCompositeParams(pack, params, historicalBindings?)` signature.
- 8 new typed errors: `CompositeBuilderError`, `ChainMismatchError`, `UnknownPackIdError`, `PolicyDataLengthMismatchError`, `PolicyDataOrderingMismatchError`, `PinnedWasmCidMismatchError`, `CompositePrepareQueryError`, `SinglePackParamsValidationError`.

Composite `prepareQuery` aggregation: parallel calls to each module's `prepareQuery`, threading per-module options keyed by short pack id (e.g. `{ chainalysis: { address: ... }, redstone: { symbol, rpcUrl, onchainOracle } }`). Fail-fast on any module's rejection.

Codegen (`scripts/generate-bindings.ts`) cross-checks `KNOWN_PACK_IDS` against the discovered pack list at regen time — a pack PR that adds the directory but forgets the registry entry fails CI before merge.

After this lands, `docs/composite-policies.md` Phase 2 status moves from "in progress" to done — the four-phase composite-policy rollout closes.

Patch-bumped across the cascade so dependent packs stay inside the existing `^0.4.x` peer range on `@newton-xyz/policy-pack-shared` (per ADR 0001's pre-1.0 caret-rule rationale).
