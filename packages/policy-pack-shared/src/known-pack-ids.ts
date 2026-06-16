/**
 * Canonical registry of every published `@newton-xyz/policy-pack-<name>`
 * package's short pack id. Order doesn't matter; presence does.
 *
 * `defineComposite(...)` (Phase 2 — see `docs/define-composite-spec.md`)
 * rejects modules whose short pack id isn't here. Catches typos,
 * abandoned-but-not-unpublished packs, and registry desync.
 *
 * **Adding a new pack**: add its short id here in the same PR that adds
 * the pack code. `scripts/generate-bindings.ts` cross-checks the discovered
 * pack list against this registry at regen time and fails on missing or
 * extra entries — a pack PR that forgets to update the registry fails CI
 * before merge.
 *
 * **Why hand-curated, not generated**: a generated string array would lose
 * the literal-union narrowing that `KnownPackId` provides. SDK consumers
 * dispatching on a specific pack (e.g. UI rendering Chainalysis-specific
 * verdict text) need the literal-union; an array typed as `string[]` can't
 * narrow.
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
