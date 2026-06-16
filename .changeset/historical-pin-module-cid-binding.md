---
"@newton-xyz/policy-pack-shared": patch
---

Bind the historical-pin `wasmCid` check to module identity

`defineComposite`'s historical-pin path now runs two checks per module: (a) the
pinned address serves the claimed cid (unchanged), and (b) the claimed cid is
one the module actually produced — `{wasmCid} ∪ priorWasmCids` from the pack's
deployment record. Together they bind a pinned `(address, cid)` to the module's
identity, closing a gap where a curator could pair a module's id with a foreign
oracle's self-consistent address+cid.

Adds an optional `priorWasmCids` field to `Deployment` (recorded by
`sync-deployments.sh` on each redeploy, passed through by the bindings codegen)
and a new `PinnedWasmCidNotInModuleHistoryError`. Check (b) is opt-in — a cell
with no recorded `priorWasmCids` history falls back to curator-asserted trust,
so this is non-breaking for existing pins.
