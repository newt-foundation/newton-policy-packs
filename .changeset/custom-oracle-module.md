---
"@newton-xyz/policy-pack-shared": minor
---

Add `defineCustomModule` for composing a custom oracle alongside published packs.

Policy packs are an optional building block: a curator can gate a vault action with their own oracle mixed with published packs in one `defineComposite` call. `defineComposite` already accepts heterogeneous modules and has `allowUnknownPackIds` to let a non-`KNOWN_PACK_IDS` short id through, so the framework already supported the mix - what was missing was a safe way to construct the custom module.

`defineCustomModule({ id, paramsSchema, wasmArgsSchema, secretsSchema, paramsJsonSchema, deployments, metadata, prepareQuery? })` builds a valid `PolicyPack` and validates it up front, so a mistake throws at construction with an actionable message instead of failing deep in the composite build or fail-closed at attestation time. It requires `paramsJsonSchema` (optional on a plain `PolicyPack`, but a composited module can't pin its on-chain params envelope without it) and runs the same regorus-keyword check `generateCompositeParamsSchema` runs, rejects an `id` whose short form collides with a published pack, and rejects a malformed `deployments`/`metadata`. Exports the `CustomModuleError` and `DefineCustomModuleArgs` types alongside it.
