/**
 * Canonical registry of every published `@newton-xyz/policy-pack-<name>`
 * package's short pack id. Order doesn't matter; presence does.
 *
 * ROLE (v2): this is a PROVENANCE registry, NOT a composition gate. Composition
 * never blocks on membership - an unknown short id is a normal custom oracle
 * (see `defineOracle` in `@newton-xyz/policy-core`). Presence here means "this
 * short id is a first-party name", which `classifyProvenance` (in policy-core)
 * uses together with the generated audited-address map
 * (`known-pack-provenance.generated.ts`) to tell Newton's audited pack from a
 * curator lookalike. `isKnownPackId` narrows a `string` to `KnownPackId` at that
 * boundary.
 *
 * Adding a new pack: add its short id here in the same PR that adds the pack
 * code. `scripts/generate-bindings.ts` cross-checks the discovered pack list
 * against this registry at regen time and fails on drift.
 *
 * Why hand-curated, not generated: a generated `string[]` would lose the
 * literal-union narrowing `KnownPackId` provides; SDK consumers dispatching on a
 * specific pack need the literal union.
 */
export const KNOWN_PACK_IDS = [
	"balancer",
	"blockaid",
	"chainalysis",
	"guardrail",
	"persona",
	"redstone",
	"sumsub",
	"vaultsfyi",
	"webacy",
] as const satisfies ReadonlyArray<string>;

export type KnownPackId = (typeof KNOWN_PACK_IDS)[number];

/**
 * Type guard for `KnownPackId`. Useful at API boundaries where a `string`
 * comes in (e.g. from a manifest blob, from user input) and needs to narrow
 * before dispatching on it.
 */
export function isKnownPackId(value: string): value is KnownPackId {
	return (KNOWN_PACK_IDS as ReadonlyArray<string>).includes(value);
}
