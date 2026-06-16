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

Implement composite-policy manifest format (Phase 1.5, NEWT-1541). Implements the spec from PR #69.

New exports from `@newton-xyz/policy-pack-shared`:

- `decodeManifest(bytes): CompositeManifest` — pure decoder, no on-chain calls
- `isCompositeManifest(bytes): boolean` — cheap pre-check (returns false on invalid bytes, never throws)
- `encodeCompositeParams(pack, params): Hex` — sorted-key canonical-form encoder, validates per-module params against each module's `paramsSchema` before emitting
- `introspectComposite({ publicClient, shieldAddress }): Promise<IntrospectedComposite>` — depositor verification helper. Walks `getPolicyAddress` → `getPolicyId` → `getPolicyConfig` → `decodeManifest` → on-chain `getPolicyData()` and `getWasmCid()` checks. Uses multicall when `client.chain.contracts.multicall3` is configured; falls back to N+1 sequential `readContract` calls otherwise.
- `MANIFEST_MAGIC = "NPM1"` and `MANIFEST_MAX_SUPPORTED_VERSION = 1` constants
- Typed error hierarchy: `NotJsonError`, `NotAManifestError`, `BadManifestMagicError`, `UnsupportedManifestVersionError`, `MalformedManifestError`, `CompositeParamsValidationError`, `ManifestDeploymentMissingError`
- `CompositeManifest` and `MinimalCompositePack` types
- `IntrospectCompositeArgs` and `IntrospectedComposite` types

Codegen (`scripts/generate-bindings.ts`) now rejects packs that declare a top-level `_manifest` property in `params_schema.json` — the `_manifest` key is reserved as the composite-manifest discriminator, and a collision would break depositor verification.

33 new tests (27 manifest + 6 introspect) cover both happy paths, error semantics, the multicall vs sequential-fallback branch split, EIP-55 vs lowercase address normalization, and positional-vs-set ordering checks.

Patch-bumped across the cascade so dependent packs stay inside the existing `^0.4.x` peer range on `@newton-xyz/policy-pack-shared` (avoids the pre-1.0 caret-rule cascade).
