---
"@newton-xyz/policy-pack-shared": patch
---

Harden `generateCompositeParamsSchema` and relax the `paramsJsonSchema` interface requirement.

This is an additive change to the public interface (a required field becomes optional; new generator-internal guards), so it ships as a patch rather than cascading a major across every dependent pack (ADR 0001).

- `paramsJsonSchema` is now optional on `PolicyPack` and `OracleModule`. It's only read when a pack is stacked into a composite, so a custom pack that never composites no longer has to carry it. Every published `@newton-xyz/policy-pack-<name>` still ships one; `generateCompositeParamsSchema` throws a `MalformedManifestError` naming the offending module if a composited module omits it.
- The generator now closes every inlined object node with `additionalProperties: false`. The source `params_schema.json` files omit `additionalProperties`, and newton-rego fail-OPENs on its absence (an absent value defaults to "any extra key allowed"), so the on-chain pinned schema would have accepted module params the SDK's `.strict()` zod rejects. Closing each object keeps the two validation surfaces identical. An explicit `additionalProperties` is left untouched.
- The generator validates the assembled envelope against the JSON Schema keyword set newton-rego actually parses (`assertRegorusSupportedKeywords`) and throws on any unsupported keyword (`$ref`, `format`, `oneOf`, `patternProperties`, …). A pack regressing into a regorus-hostile keyword now fails at generation instead of fail-closing at attestation time.
