/**
 * Worked example — composing the vaultsfyi + chainalysis packs into one
 * composite Newton policy, end to end, using the published
 * `@newton-xyz/policy-pack-shared` composite API.
 *
 * This file typechecks against the real workspace packages — it is the
 * executable proof that the composite curator path in
 * `docs/writing-composite-policies.md` is real. It is illustrative (no live
 * RPC); fill in the addresses + a real `PublicClient`/`WalletClient` to run it.
 */

import {
	defineComposite,
	encodeCompositePolicyPack,
	getPolicyManifest,
	introspectComposite,
} from "@newton-xyz/policy-pack-shared";
import { chainalysis } from "@newton-xyz/policy-pack-chainalysis";
import { vaultsfyi } from "@newton-xyz/policy-pack-vaultsfyi";
import { type Address, createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";

// ---------------------------------------------------------------------------
// 0. Inputs the curator supplies. The composite NewtonPolicy address comes
//    from `newton-cli policy deploy` with one --policy-data-address flag per
//    module (see README § Deploy). You can list the modules below in ANY order
//    — defineComposite aligns them to the on-chain getPolicyData() order.
// ---------------------------------------------------------------------------

const COMPOSITE_POLICY_ADDRESS: Address = "0xYOUR_COMPOSITE_POLICY"; // from `newton-cli policy deploy`
const SHIELD_ADDRESS: Address = "0xYOUR_SHIELD_CLONE";
const DEPOSITOR_ADDRESS: Address = "0xDEPOSITOR";
const VAULT_ADDRESS: Address = "0xVAULT";

const publicClient = createPublicClient({ chain: sepolia, transport: http() });

// ---------------------------------------------------------------------------
// 1. Build the composite. defineComposite reads getPolicyData() on-chain and
//    reorders the modules array to match it — order-independent. A module whose
//    oracle isn't in the on-chain policy throws here (set mismatch), never
//    reaching setPolicy.
// ---------------------------------------------------------------------------

export async function buildComposite() {
	return defineComposite({
		modules: [vaultsfyi, chainalysis], // any order — aligned to on-chain getPolicyData()
		chainId: "11155111",
		env: "stagef",
		publicClient,
		policyAddress: COMPOSITE_POLICY_ADDRESS,
	});
}

// ---------------------------------------------------------------------------
// 2. Encode the curator's per-module params into the manifest bytes for
//    Shield.setPolicy(...). Params are keyed by SHORT pack id — the same
//    identifier the composite Rego reads via data.params.<short-id>.*.
//    encodeCompositePolicyPack validates each slice against that module's
//    paramsSchema before emitting bytes.
// ---------------------------------------------------------------------------

export async function encodeParams() {
	const composite = await buildComposite();
	return encodeCompositePolicyPack(composite, {
		vaultsfyi: {
			apy_z_max: 4,
			// drawdown caps are PERCENT POINTS (the vaultsfyi oracle emits
			// `((old - current) / old) * 100`), so 25 = 25%, NOT 0.25.
			tvl_drawdown_24h_max_pct: 25,
			tvl_drawdown_7d_max_pct: 50,
			risk_score_floor: 80,
			deny_on_allocation_change: true,
			deny_on_critical_flag: true,
			deny_on_corrupted: true,
		},
		chainalysis: {
			deny_on_sanctioned: true,
			deny_on_high_risk_category: true,
			risk_categories_blocklist: ["mixer", "stolen_funds", "ransomware"],
		},
	});
	// → Hex bytes. Submit with:
	//   await shield.setPolicyAddress(COMPOSITE_POLICY_ADDRESS);
	//   await shield.setPolicy(bytes, expireAfter);
}

// ---------------------------------------------------------------------------
// 3. Per intent: the aggregated prepareQuery runs every module's prepareQuery
//    in parallel, threading per-module options keyed by short pack id.
//    chainalysis needs the depositor address to screen; vaultsfyi reads its
//    own on-chain state. The result is one wasmArgs blob keyed by short id.
// ---------------------------------------------------------------------------

export async function buildWasmArgs() {
	const composite = await buildComposite();
	const { wasmArgs } = await composite.prepareQuery(
		{ publicClient, vault: VAULT_ADDRESS },
		{
			// keyed by short pack id; modules without per-call options omit their key
			chainalysis: { address: DEPOSITOR_ADDRESS },
		},
	);
	return wasmArgs; // { vaultsfyi: {...}, chainalysis: {...} }
}

// ---------------------------------------------------------------------------
// 4a. Depositor verification: introspectComposite walks the on-chain read
//     path and checks every module's policyData address + wasmCid against
//     what the manifest claims. Returns a report; never throws on mismatch.
// ---------------------------------------------------------------------------

export async function verifyAsDepositor() {
	const report = await introspectComposite({ publicClient, shieldAddress: SHIELD_ADDRESS });
	if (!report.verification.onChainPolicyDataMatches) {
		throw new Error("composite policyData ordering does not match the on-chain policy");
	}
	for (const m of report.verification.wasmCidsMatch) {
		if (!m.matches) throw new Error(`module ${m.moduleIndex} wasmCid mismatch: ${m.reason}`);
	}
	return report.manifest; // decoded CompositeManifest
}

// ---------------------------------------------------------------------------
// 4b. Generic dispatch: getPolicyManifest works whether the Shield is bound to
//     a single-pack or a composite policy — useful for dashboards that don't
//     know the shape ahead of time.
// ---------------------------------------------------------------------------

export async function inspectAnyShield() {
	const result = await getPolicyManifest({ publicClient, shieldAddress: SHIELD_ADDRESS });
	if (result.kind === "composite") {
		return `composite with ${result.manifest.modules.length} modules`;
	}
	return "single-pack policy";
}
