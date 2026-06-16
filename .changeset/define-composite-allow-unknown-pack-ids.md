---
"@newton-xyz/policy-pack-shared": patch
---

Add `allowUnknownPackIds` opt-out to `defineComposite`

`defineComposite` rejects any module whose short id isn't in `KNOWN_PACK_IDS`
(`UnknownPackIdError`), which locks out curators composing a bespoke or
unpublished pack. The new optional `allowUnknownPackIds?: boolean` (default
`false`) on `DefineCompositeArgs` skips that membership gate when `true`.

The flag relaxes ONLY the registry gate — the duplicate-short-id guard and every
on-chain check (`getPolicyData()` set-match, `getWasmCid()` identity) still run.
Additive and default-off, so existing callers are unaffected and typo/desync
detection stays on for the published packs.
