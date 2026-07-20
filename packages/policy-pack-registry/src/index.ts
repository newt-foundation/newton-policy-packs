/**
 * `@newton-xyz/policy-pack-registry` - provider-owned trust data for Newton's
 * first-party policy packs. Two datasets, nothing else:
 *
 * - `KNOWN_PACK_IDS` / `KnownPackId` / `isKnownPackId` - the first-party pack-id
 *   registry (hand-curated to preserve the literal-union type).
 * - `AUDITED_POLICY_DATA` - the generated `shortId -> chain -> env -> policyData`
 *   audited-address map (written by `scripts/generate-bindings.ts`).
 *
 * These are the two arguments `@newton-xyz/policy-core`'s `classifyProvenance`
 * needs (`knownIds` + `auditedRegistry`). The classification MECHANISM lives in
 * policy-core; the DATA lives here, on the provider side that owns the trust. A
 * consumer (e.g. a curator dashboard) installs core + this registry and injects
 * both into `classifyProvenance`.
 */

export type { KnownPackId } from "./known-pack-ids";
export { isKnownPackId, KNOWN_PACK_IDS } from "./known-pack-ids";
export { AUDITED_POLICY_DATA } from "./known-pack-provenance.generated";
