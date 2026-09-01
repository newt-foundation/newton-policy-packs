package pharos_redemption_backing_wrapping_test

import data.pharos_redemption_backing
import future.keywords

# Phase 0 § Stream B Rego shape test for pharos_redemption.
#
# Locks the namespacing contract: the policy reads from
# `data.wasm.pharos_redemption.<field>`, NOT `data.wasm.<field>`. Mirrors
# `policy.js`'s `wrapOutput("pharos_redemption", ...)` envelope.

default_params := {
	"require_redemption_available": true,
	"approved_route_families": ["offchain-issuer", "authorised-participant"],
	"approved_access_models": ["issuer-api", "permissionless"],
	"approved_settlement_models": ["same-day", "t-plus-one"],
	"required_route_status": "open",
	"min_route_score": 50,
	"approved_capacity_confidence": ["documented-bound", "measured"],
	"min_capacity_multiple": 2,
	"max_reserve_elevated_risk_pct": 25,
	"max_data_age_seconds": 21600,
}

clean_inner := {
	"stablecoin_id": "usdc-circle",
	"symbol": "USDC",
	"issuer": "circle",
	"redemption_available": true,
	"route_family": "offchain-issuer",
	"access_model": "issuer-api",
	"settlement_model": "same-day",
	"execution_model": "rules-based-nav",
	"route_status": "open",
	"holder_eligibility": "verified-customer",
	"provider": "supply-ratio-model",
	"source_mode": "estimated",
	"immediate_capacity_usd": 5152335530,
	"modeled_exit_size_usd": 25000000,
	"capacity_confidence": "documented-bound",
	"route_score": 63,
	"access_score": 40,
	"settlement_score": 65,
	"capacity_score": 69,
	"fee_bps": null,
	"queue_enabled": false,
	"reserve_composition": {"<3-Month U.S. Treasuries": 67.1, "Other Bank Deposits": 14.6},
	"reserve_elevated_risk_pct": 0,
	"reserve_mode": "live-stale",
	"reserve_source": "circle-transparency",
	"reserve_sync_status": "ok",
	"reserve_stale": true,
	"transaction_amount_usd": 1000000,
	"capacity_multiple": 5152,
	"data_age_seconds": 8833,
}

namespaced(overrides) := {"pharos_redemption": object.union(clean_inner, overrides)}

test_namespaced_allow_when_clean if {
	pharos_redemption_backing.allow with data.params as default_params with data.wasm as namespaced({})
	count(pharos_redemption_backing.deny) == 0 with data.params as default_params with data.wasm as namespaced({})
}

test_namespaced_deny_redemption_unavailable if {
	"redemption_unavailable" in pharos_redemption_backing.deny
		with data.params as default_params
		with data.wasm as namespaced({"redemption_available": false})
}

test_namespaced_deny_route_status_not_approved if {
	"route_status_not_approved" in pharos_redemption_backing.deny
		with data.params as default_params
		with data.wasm as namespaced({"route_status": "impaired"})
}

test_namespaced_deny_low_confidence if {
	"low_route_score" in pharos_redemption_backing.deny
		with data.params as default_params
		with data.wasm as namespaced({"route_score": 5})
}

test_namespaced_deny_stale_data if {
	"stale_data" in pharos_redemption_backing.deny
		with data.params as default_params
		with data.wasm as namespaced({"data_age_seconds": 99999})
}

test_flat_input_does_not_trigger_namespaced_rules if {
	flat_with_violations := object.union(clean_inner, {
		"redemption_available": false,
		"route_family": "amm-only",
		"route_status": "suspended",
		"route_score": 0,
		"capacity_multiple": 0.1,
		"data_age_seconds": 99999,
	})
	count(pharos_redemption_backing.deny) == 0
		with data.params as default_params
		with data.wasm as flat_with_violations
}

test_flat_input_does_not_allow if {
	not pharos_redemption_backing.allow
		with data.params as default_params
		with data.wasm as clean_inner
}

test_namespaced_error_does_not_allow if {
	not pharos_redemption_backing.allow
		with data.params as default_params
		with data.wasm as {"pharos_redemption": {"error": "oracle failed"}}
}

test_namespaced_empty_pack_slot_does_not_allow if {
	not pharos_redemption_backing.allow
		with data.params as default_params
		with data.wasm as {"pharos_redemption": {}}
}

test_other_pack_keys_do_not_interfere if {
	composite := {
		"pharos_redemption": clean_inner,
		"pharos_treasury": {
			"redemption_available": false,
			"redemption_route_status": "impaired",
			"data_age_seconds": 99999,
		},
		"pharos_safe_mode": {"depeg_active": true, "stress_score": 99},
	}
	pharos_redemption_backing.allow with data.params as default_params with data.wasm as composite
	count(pharos_redemption_backing.deny) == 0 with data.params as default_params with data.wasm as composite
}
