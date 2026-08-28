package pharos_treasury_risk_wrapping_test

import data.pharos_treasury_risk
import future.keywords

# Phase 0 § Stream B Rego shape test for pharos_treasury.
#
# Locks the namespacing contract: the policy reads from
# `data.wasm.pharos_treasury.<field>`, NOT `data.wasm.<field>`. Mirrors
# `policy.js`'s `wrapOutput("pharos_treasury", ...)` envelope.
#
# Load-bearing for this family: all three pharos packs emit `depeg_active`,
# `stress_score` and `data_age_seconds`, so an un-namespaced read would
# cross-wire any composite stacking two of them.

default_params := {
	"deny_on_active_depeg": true,
	"max_peg_deviation_bps": 50,
	"max_stress_score": 40,
	"require_redemption": true,
	"approved_redemption_route_families": ["issuer-direct", "authorised-participant"],
	"approved_access_models": ["permissionless", "kyc-gated"],
	"min_exit_capacity_multiple": 3,
	"min_liquidity_score": 60,
	"max_data_age_seconds": 900,
}

clean_inner := {
	"stablecoin_id": "usdc-circle",
	"symbol": "USDC",
	"issuer": "Circle",
	"price": 1.0002,
	"peg_target": 1,
	"peg_deviation_bps": 2,
	"depeg_active": false,
	"depeg_severity": null,
	"depeg_direction": null,
	"supply": 60000000000,
	"market_cap_usd": 60000000000,
	"chains": ["ethereum"],
	"stress_score": 8,
	"stress_band": "calm",
	"active_stress_indicators": [],
	"liquidity_score": 94,
	"effective_tvl_usd": 850000000,
	"exit_capacity_usd": 50000000,
	"pool_count": 142,
	"chain_count": 3,
	"liquidity_concentration": 0.18,
	"redemption_available": true,
	"redemption_route_family": "issuer-direct",
	"redemption_access_model": "kyc-gated",
	"redemption_route_status": "active",
	"daily_limit_usd": 1000000000,
	"immediate_capacity_usd": 250000000,
	"transaction_amount_usd": 1000000,
	"exit_capacity_multiple": 50,
	"data_age_seconds": 45,
}

namespaced(overrides) := {"pharos_treasury": object.union(clean_inner, overrides)}

test_namespaced_allow_when_clean if {
	pharos_treasury_risk.allow with data.params as default_params with data.wasm as namespaced({})
	count(pharos_treasury_risk.deny) == 0 with data.params as default_params with data.wasm as namespaced({})
}

test_namespaced_deny_active_depeg if {
	"active_depeg" in pharos_treasury_risk.deny
		with data.params as default_params
		with data.wasm as namespaced({"depeg_active": true})
}

test_namespaced_deny_stress_above_max if {
	"stress_above_max" in pharos_treasury_risk.deny
		with data.params as default_params
		with data.wasm as namespaced({"stress_score": 95})
}

test_namespaced_deny_insufficient_exit_capacity if {
	"insufficient_exit_capacity" in pharos_treasury_risk.deny
		with data.params as default_params
		with data.wasm as namespaced({"exit_capacity_multiple": 0.5})
}

test_namespaced_deny_stale_data if {
	"stale_data" in pharos_treasury_risk.deny
		with data.params as default_params
		with data.wasm as namespaced({"data_age_seconds": 99999})
}

test_flat_input_does_not_trigger_namespaced_rules if {
	flat_with_violations := object.union(clean_inner, {
		"depeg_active": true,
		"peg_deviation_bps": -900,
		"stress_score": 99,
		"liquidity_score": 1,
		"exit_capacity_multiple": 0.1,
		"data_age_seconds": 99999,
	})
	count(pharos_treasury_risk.deny) == 0
		with data.params as default_params
		with data.wasm as flat_with_violations
}

test_flat_input_does_not_allow if {
	not pharos_treasury_risk.allow
		with data.params as default_params
		with data.wasm as clean_inner
}

test_namespaced_error_does_not_allow if {
	not pharos_treasury_risk.allow
		with data.params as default_params
		with data.wasm as {"pharos_treasury": {"error": "oracle failed"}}
}

test_namespaced_empty_pack_slot_does_not_allow if {
	not pharos_treasury_risk.allow
		with data.params as default_params
		with data.wasm as {"pharos_treasury": {}}
}

# Cross-pack composition: the sibling pharos packs carry the SAME field
# names with hostile values and must not bleed into this decision.
test_other_pack_keys_do_not_interfere if {
	composite := {
		"pharos_treasury": clean_inner,
		"pharos_safe_mode": {
			"depeg_active": true,
			"stress_score": 99,
			"data_age_seconds": 99999,
		},
		"pharos_redemption": {
			"redemption_available": false,
			"route_status": "impaired",
			"confidence": 0,
		},
	}
	pharos_treasury_risk.allow with data.params as default_params with data.wasm as composite
	count(pharos_treasury_risk.deny) == 0 with data.params as default_params with data.wasm as composite
}
