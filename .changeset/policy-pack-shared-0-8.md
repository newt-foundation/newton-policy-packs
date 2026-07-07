---
"@newton-xyz/policy-pack-shared": minor
---

Add `definePolicyPack`, the one pack factory: first-party packs and custom
oracles are now authored identically, with construction-time validation and
`paramsJsonSchema` derived zod-first (via `zod-to-json-schema`) and gated
through the regorus keyword allowlist. Drop the composition id-gate
(`allowUnknownPackIds` / `UnknownPackIdError` removed; an unknown short id is
normal). Repurpose `KNOWN_PACK_IDS` into a provenance registry and add
`classifyProvenance` + a generated `AUDITED_POLICY_DATA` map so a first-party
name can be distinguished from a lookalike by verified address. Remove
`defineCustomModule`, `oracleModuleFromPack`, and the `OracleModule` projection.
