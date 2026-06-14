---
"@newton-xyz/policy-pack-shared": minor
---

feat(shared): add `wrapOutput(packId, valueOrError)` helper for pack-side namespacing

Phase 0 Stream A of [NEWT-1539](https://linear.app/magiclabs/issue/NEWT-1539)
composite policy packs rework. Adds the canonical helper every pack's
`policy.js` must call on every return path (success AND error) so the AVS-side
shallow `merge_jsons` composes cleanly across packs without top-level key
collisions.

Pure additive; no breaking changes.
