import type { ChainId, GatewayEnv } from "./deployment";
import { isKnownPackId } from "./known-pack-ids";
import { AUDITED_POLICY_DATA } from "./known-pack-provenance.generated";

/**
 * Provenance of a resolved policy-data module, keyed on (verified address +
 * first-party-name registry), NEVER on the bare name:
 * - `audited`        - short id is a first-party pack name AND the resolved
 *                      on-chain policyData address equals the audited registry
 *                      address for that (name, chain, env).
 * - `custom`         - short id is not a first-party pack name (a normal
 *                      custom oracle).
 * - `impersonating`  - short id IS a first-party name but the resolved address
 *                      does NOT match the audited one (a lookalike), OR the
 *                      audited address is unknown on this cell so `audited`
 *                      cannot be proven. Never blocks composition (Q7); surfaced
 *                      so a dashboard renders it as custom/unverified, never as
 *                      the audited pack.
 */
export type Provenance = "audited" | "custom" | "impersonating";

type Registry = Readonly<
	Partial<
		Record<
			string,
			Readonly<Partial<Record<ChainId, Readonly<Partial<Record<GatewayEnv, string>>>>>>
		>
	>
>;

/**
 * Pure classification. No chain reads - the caller passes the already-resolved
 * on-chain `policyData` address (from createShield's getPolicyData alignment);
 * this only compares it to the audited registry. `registry` defaults to the
 * generated `AUDITED_POLICY_DATA` and is injectable for testing.
 */
export function classifyProvenance(args: {
	shortId: string;
	resolvedPolicyData: string;
	chainId: ChainId;
	env: GatewayEnv;
	registry?: Registry;
}): Provenance {
	const registry = args.registry ?? AUDITED_POLICY_DATA;
	if (!isKnownPackId(args.shortId)) {
		return "custom";
	}
	const audited = (
		registry as Record<
			string,
			Readonly<Partial<Record<ChainId, Readonly<Partial<Record<GatewayEnv, string>>>>>>
		>
	)[args.shortId]?.[args.chainId]?.[args.env];
	if (audited && audited.toLowerCase() === args.resolvedPolicyData.toLowerCase()) {
		return "audited";
	}
	// First-party name that we cannot prove is the audited deployment.
	return "impersonating";
}
