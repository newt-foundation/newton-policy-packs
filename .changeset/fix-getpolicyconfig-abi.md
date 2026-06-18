---
"@newton-xyz/policy-pack-shared": patch
---

Fix `getPolicyConfig` ABI: the on-chain read declared a phantom four-field
return tuple `(bytes32 policyId, bytes policyParams, uint32 expireAfter,
uint8 expireUnit)`, but the canonical AVS `INewtonPolicy.PolicyConfig` is the
two-field struct `(bytes policyParams, uint32 expireAfter)` — neither
`policyId` nor `expireUnit` exists on it. The wrong ABI made viem misread the
return data (`expireAfter` landed where a dynamic-bytes offset was expected),
throwing `IntegerOutOfRangeError` against every correctly-deployed policy. This
broke `introspectComposite` and `getPolicyManifest` (and any attach-time
binding check that walks the same read path). Corrected the ABI in both
`composite-introspect.ts` and `get-policy-manifest.ts` to the two-field tuple.
No API change — `policyId` is already sourced from the separate
`getPolicyId(client)` call, and the removed fields were never read.
