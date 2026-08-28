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
	"approved_route_families": ["issuer-direct", "authorised-participant"],
	"approved_access_models": ["permissionless", "kyc-gated"],
	"approved_settlement_models": ["same-day", "t-plus-one"],
	"required_route_status": "active",
	"min_confidence": 0.7,
	"min_daily_limit_multiple": 2,
	"max_data_age_seconds": 900,
}

clean_inner := {
	"stablecoin_id": "usdc-circle",
	"symbol": "USDC",
	"redemption_available": true,
	"route_family": "issuer-direct",
	"access_model": "kyc-gated",
	"settlement_model": "same-day",
	"route_status": "active",
	"holder_eligibility": "verified-institutions",
	"immediate_capacity_usd": 250000000,
	"daily_limit_usd": 1000000000,
	"min_redeem_usd": 100000,
	"fees_bps": 0,
	"confidence": 0.96,
	"reserve_composition": {"cash": 0.2, "treasuries": 0.8},
	"reserve_source_mode": "live",
	"reserve_sync_status": "synced",
	"transaction_amount_usd": 1000000,
	"daily_limit_multiple": 1000,
	"data_age_seconds": 45,
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
	"low_confidence" in pharos_redemption_backing.deny
		with data.params as default_params
		with data.wasm as namespaced({"confidence": 0.1})
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
		"confidence": 0,
		"daily_limit_multiple": 0.1,
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
