# `@newton-xyz/policy-pack-registry`

Provider-owned trust data for Newton's first-party policy packs.

This package ships two datasets and nothing else:

| Export | Purpose |
|---|---|
| `KNOWN_PACK_IDS`, `KnownPackId`, `isKnownPackId` | The first-party pack-id registry. Hand-curated (kept as a literal union so consumers can narrow/dispatch on a specific pack). |
| `AUDITED_POLICY_DATA` | Generated `shortId -> chainId -> env -> policyData` audited-address map (prod env only). Written by `scripts/generate-bindings.ts` from this repo's AVS deployment records. |

## Why a separate package

Provenance classification is split by ownership:

- The **mechanism** (`classifyProvenance`) lives in [`@newton-xyz/policy-core`](https://www.npmjs.com/package/@newton-xyz/policy-core) - pure compare logic, fully injective.
- The **trust data** (who is first-party, which address is audited) lives here, on the provider side that owns the trust.

A consumer - e.g. a curator dashboard - installs both and injects this package's data into core's classifier:

```ts
import { classifyProvenance } from "@newton-xyz/policy-core";
import { AUDITED_POLICY_DATA, KNOWN_PACK_IDS } from "@newton-xyz/policy-pack-registry";

const provenance = classifyProvenance({
  shortId,
  resolvedPolicyData,
  chainId,
  env,
  auditedRegistry: AUDITED_POLICY_DATA,
  knownIds: KNOWN_PACK_IDS,
});
```

## Regeneration

`known-pack-provenance.generated.ts` is generated - edit the upstream deployment records and run `pnpm gen:bindings` from the repo root. `known-pack-ids.ts` is hand-curated: add a new pack's short id in the same PR that adds the pack.
