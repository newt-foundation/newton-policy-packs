---
"@newton-xyz/policy-pack-shared": minor
---

Add a reserved `_policy` params namespace for composite policies.

A composite's Rego often needs policy-level values that no oracle owns and that
the on-chain exact-tx attestation binding cannot express - a yield-source
allowlist, a fee-bps ceiling, a cap ceiling checked against decoded args.
Previously such values had no on-chain params slot (composite params were
strictly bijective with the oracle module set), so authors hardcoded them as
Rego constants and had to re-pin + redeploy the policy to retune one.

`defineComposite` now accepts an optional `policyParamsSchema` (a zod schema).
When supplied, `encodeCompositePolicyPack` validates a `_policy` slice against it
and emits it under `params._policy`; on-chain a gate reads it at
`data.params.params._policy.<field>`. `_policy` is the one sanctioned non-oracle
key - the oracle-short-id bijection otherwise holds, and its leading underscore
cannot collide with any oracle slice (short ids must start with a lowercase
letter).

The `_policy` JSON Schema is DERIVED from its zod at `defineComposite` (one
source of truth, exactly like an oracle module's `paramsJsonSchema`), so the
encode-time validation and the on-chain pinned schema cannot drift. Use the new
`generateCompositePinnedSchema(composite)` to produce the pinned envelope schema
a curator stores on the `NewtonPolicy` - it always includes `_policy` when the
composite declares one, so the pinned schema matches what the encoder writes.

New exports: `POLICY_PARAMS_KEY`, `generateCompositePinnedSchema`. Additive:
composites with no `_policy` slice are unaffected.
