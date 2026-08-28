package pharos_safe_mode_wrapping_test

import data.pharos_safe_mode
import future.keywords

# Phase 0 § Stream B Rego shape test for pharos_safe_mode.
#
# Locks the namespacing contract: the policy reads from
# `data.wasm.pharos_safe_mode.<field>`, NOT `data.wasm.<field>`. Mirrors
# `policy.js`'s `wrapOutput("pharos_safe_mode", ...)` envelope.
#
# Unlike every other pack's wrapping test, each case here must also mock
# `input`. This is the one pack that reads the attested intent, and its
# `unclassified_function` rule fires on an absent intent by design — so an
# unmocked `input` would mask what these tests are actually checking.

default_params := {
	"safe_mode_stress_threshold": 60,
	"deny_on_active_depeg": true,
	"exposure_increasing_functions": ["deposit", "mint", "supply"],
	"exposure_reducing_functions": ["withdraw", "redeem", "repay"],
	"swap_functions": ["swap"],
	"swap_destination_arg_index": 1,
	"approved_safe_assets": ["0xdac17f958d2ee523a2206206994597c13d831ec7"],
	"max_data_age_seconds": 900,
}

clean_inner := {
	"stablecoin_id": "usdc-circle",
	"symbol": "USDC",
	"stress_score": 8,
	"stress_band": "calm",
	"active_indicators": [],
	"depeg_active": false,
	"depeg_severity": null,
	"peg_deviation_bps": 2,
	"net_flow_usd": 12000000,
	"mint_volume_usd": 40000000,
	"burn_volume_usd": 28000000,
	"flow_anomaly": false,
	"data_age_seconds": 45,
}

namespaced(overrides) := {"pharos_safe_mode": object.union(clean_inner, overrides)}

deposit_intent := {
	"from": "0x8d84b1344cb6375694f5862c868ba2c78240c076",
	"to": "0xae7ab96520de3a18e5e111b5eaab095312d7fe84",
	"value": "0",
	"chain_id": "1",
	"function": {"name": "deposit", "type": "function"},
	"decoded_function_signature": "function deposit(uint256)",
	"decoded_function_arguments": ["1000"],
}

withdraw_intent := {
	"from": "0x8d84b1344cb6375694f5862c868ba2c78240c076",
	"to": "0xae7ab96520de3a18e5e111b5eaab095312d7fe84",
	"value": "0",
	"chain_id": "1",
	"function": {"name": "withdraw", "type": "function"},
	"decoded_function_signature": "function withdraw(uint256)",
	"decoded_function_arguments": ["1000"],
}

test_namespaced_allow_when_calm if {
	pharos_safe_mode.allow
		with data.params as default_params
		with data.wasm as namespaced({})
		with input as deposit_intent

	count(pharos_safe_mode.deny) == 0
		with data.params as default_params
		with data.wasm as namespaced({})
		with input as deposit_intent
}

test_namespaced_deny_safe_mode_blocks_exposure_increase if {
	"safe_mode_blocks_exposure_increase" in pharos_safe_mode.deny
		with data.params as default_params
		with data.wasm as namespaced({"stress_score": 95})
		with input as deposit_intent
}

test_namespaced_deny_on_depeg if {
	"safe_mode_blocks_exposure_increase" in pharos_safe_mode.deny
		with data.params as default_params
		with data.wasm as namespaced({"depeg_active": true})
		with input as deposit_intent
}

test_namespaced_deny_stale_data if {
	"stale_data" in pharos_safe_mode.deny
		with data.params as default_params
		with data.wasm as namespaced({"data_age_seconds": 99999})
		with input as withdraw_intent
}

# Negative shape test: with a classified intent supplied, a flat
# (un-namespaced) `data.wasm` must trigger no oracle-driven deny — every
# such rule reads `.pharos_safe_mode.<field>`.
test_flat_input_does_not_trigger_namespaced_rules if {
	flat_with_violations := object.union(clean_inner, {
		"stress_score": 99,
		"depeg_active": true,
		"data_age_seconds": 99999,
	})
	count(pharos_safe_mode.deny) == 0
		with data.params as default_params
		with data.wasm as flat_with_violations
		with input as deposit_intent
}

# ...and must not allow either: `is_boolean(v.depeg_active)` is undefined
# against a flat payload, so the policy fails closed.
test_flat_input_does_not_allow if {
	not pharos_safe_mode.allow
		with data.params as default_params
		with data.wasm as clean_inner
		with input as withdraw_intent
}

test_namespaced_error_does_not_allow if {
	not pharos_safe_mode.allow
		with data.params as default_params
		with data.wasm as {"pharos_safe_mode": {"error": "oracle failed"}}
		with input as withdraw_intent
}

test_namespaced_empty_pack_slot_does_not_allow if {
	not pharos_safe_mode.allow
		with data.params as default_params
		with data.wasm as {"pharos_safe_mode": {}}
		with input as withdraw_intent
}

# Cross-pack composition: a sibling pharos pack reporting a raging depeg
# under its own key must not engage THIS pack's safe mode.
test_other_pack_keys_do_not_interfere if {
	composite := {
		"pharos_safe_mode": clean_inner,
		"pharos_treasury": {
			"depeg_active": true,
			"stress_score": 99,
			"data_age_seconds": 99999,
		},
		"pharos_redemption": {"redemption_available": false, "confidence": 0},
	}
	pharos_safe_mode.allow
		with data.params as default_params
		with data.wasm as composite
		with input as deposit_intent

	count(pharos_safe_mode.deny) == 0
		with data.params as default_params
		with data.wasm as composite
		with input as deposit_intent
}
