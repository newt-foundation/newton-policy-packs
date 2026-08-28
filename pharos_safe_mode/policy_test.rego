package pharos_safe_mode_test

import data.pharos_safe_mode
import future.keywords

USDT := "0xdac17f958d2ee523a2206206994597c13d831ec7"

default_params := {
	"safe_mode_stress_threshold": 60,
	"deny_on_active_depeg": true,
	"exposure_increasing_functions": ["deposit", "mint", "supply"],
	"exposure_reducing_functions": ["withdraw", "redeem", "repay"],
	"swap_functions": ["swap"],
	"swap_destination_arg_index": 1,
	"approved_safe_assets": ["0xDAC17F958D2ee523a2206206994597C13D831ec7"],
	"max_data_age_seconds": 7200,
}

# Calm market: low stress, no depeg, flows normal.
calm_data := {
	"stablecoin_id": "usdc-circle",
	"symbol": "USDC",
	"stress_score": 13,
	"stress_band": "calm",
	"stress_signals": {"supply": 0.22, "pool": 32.4, "liq": 34.4, "price": 0, "flow": 22.8, "yield": 30},
	"active_indicators": [],
	"age_classification": "fresh",
	"depeg_active": false,
	"depeg_severity": null,
	"depeg_pending_count": 0,
	"peg_deviation_bps": 0,
	"net_flow_usd": 337500204,
	"mint_volume_usd": 1415801595,
	"burn_volume_usd": 1078301390,
	"flow_stress_score": 22.8,
	"burn_surge": 2.42,
	"flow_anomaly": false,
	"data_age_seconds": 2316,
}

stressed := object.union(calm_data, {
	"stress_score": 82,
	"stress_band": "elevated",
	"active_indicators": ["peg_pressure", "liquidity_drain"],
	"flow_anomaly": true,
})

depegged := object.union(calm_data, {
	"depeg_active": true,
	"depeg_severity": "severe",
	"peg_deviation_bps": -420,
})

wrap(inner) := {"pharos_safe_mode": inner}

# The intent shape verified against newton-cli 0.5.2 — `function.name` is
# the bare name and `decoded_function_arguments` are strings.
intent(name, args) := {
	"from": "0x8d84b1344cb6375694f5862c868ba2c78240c076",
	"to": "0xae7ab96520de3a18e5e111b5eaab095312d7fe84",
	"value": "0",
	"chain_id": "1",
	"function": {"name": name, "type": "function"},
	"decoded_function_signature": sprintf("function %v(...)", [name]),
	"decoded_function_arguments": args,
}

# --- calm market: everything classified proceeds ---------------------------

test_allow_deposit_when_calm if {
	pharos_safe_mode.allow
		with data.params as default_params
		with data.wasm as wrap(calm_data)
		with input as intent("deposit", ["1000"])
}

test_allow_withdraw_when_calm if {
	pharos_safe_mode.allow
		with data.params as default_params
		with data.wasm as wrap(calm_data)
		with input as intent("withdraw", ["1000"])
}

# --- safe mode via stress --------------------------------------------------

test_deny_deposit_when_stressed if {
	"safe_mode_blocks_exposure_increase" in pharos_safe_mode.deny
		with data.params as default_params
		with data.wasm as wrap(stressed)
		with input as intent("deposit", ["1000"])

	not pharos_safe_mode.allow
		with data.params as default_params
		with data.wasm as wrap(stressed)
		with input as intent("deposit", ["1000"])
}

# The whole point of the graduated response: exits stay open under stress.
test_allow_withdraw_when_stressed if {
	pharos_safe_mode.allow
		with data.params as default_params
		with data.wasm as wrap(stressed)
		with input as intent("withdraw", ["1000"])

	count(pharos_safe_mode.deny) == 0
		with data.params as default_params
		with data.wasm as wrap(stressed)
		with input as intent("withdraw", ["1000"])
}

test_allow_redeem_when_stressed if {
	pharos_safe_mode.allow
		with data.params as default_params
		with data.wasm as wrap(stressed)
		with input as intent("redeem", ["1000"])
}

# --- safe mode via depeg ---------------------------------------------------

test_deny_deposit_when_depegged if {
	"safe_mode_blocks_exposure_increase" in pharos_safe_mode.deny
		with data.params as default_params
		with data.wasm as wrap(depegged)
		with input as intent("mint", ["1000"])
}

test_allow_withdraw_when_depegged if {
	pharos_safe_mode.allow
		with data.params as default_params
		with data.wasm as wrap(depegged)
		with input as intent("withdraw", ["1000"])
}

test_depeg_does_not_engage_safe_mode_when_configured_off if {
	p := object.union(default_params, {"deny_on_active_depeg": false})
	pharos_safe_mode.allow
		with data.params as p
		with data.wasm as wrap(depegged)
		with input as intent("deposit", ["1000"])
}

# --- swaps into safer assets ----------------------------------------------

test_allow_swap_to_approved_asset_when_stressed if {
	pharos_safe_mode.allow
		with data.params as default_params
		with data.wasm as wrap(stressed)
		with input as intent("swap", ["1000", USDT])
}

# Case-insensitive: the intent lowercases addresses, the curator's param
# is checksummed. These must still match.
test_swap_destination_match_is_case_insensitive if {
	pharos_safe_mode.allow
		with data.params as default_params
		with data.wasm as wrap(stressed)
		with input as intent("swap", ["1000", "0xDAC17F958D2EE523A2206206994597C13D831EC7"])
}

test_deny_swap_to_unapproved_asset_when_stressed if {
	"unapproved_swap_destination" in pharos_safe_mode.deny
		with data.params as default_params
		with data.wasm as wrap(stressed)
		with input as intent("swap", ["1000", "0x0000000000000000000000000000000000000bad"])

	not pharos_safe_mode.allow
		with data.params as default_params
		with data.wasm as wrap(stressed)
		with input as intent("swap", ["1000", "0x0000000000000000000000000000000000000bad"])
}

# Outside safe mode the destination allowlist does not apply at all.
test_allow_swap_to_any_asset_when_calm if {
	pharos_safe_mode.allow
		with data.params as default_params
		with data.wasm as wrap(calm_data)
		with input as intent("swap", ["1000", "0x0000000000000000000000000000000000000bad"])
}

# An out-of-range destination index must fail closed, not read as approved.
test_deny_swap_when_destination_index_out_of_range if {
	not pharos_safe_mode.allow
		with data.params as default_params
		with data.wasm as wrap(stressed)
		with input as intent("swap", ["1000"])
}

# --- fail-closed surfaces --------------------------------------------------

test_deny_unclassified_function if {
	"unclassified_function" in pharos_safe_mode.deny
		with data.params as default_params
		with data.wasm as wrap(calm_data)
		with input as intent("selfDestruct", [])

	not pharos_safe_mode.allow
		with data.params as default_params
		with data.wasm as wrap(calm_data)
		with input as intent("selfDestruct", [])
}

# Unclassified denies even in a calm market — the classification lists are
# an allowlist, not a safe-mode-only concern.
test_unclassified_denies_even_when_calm if {
	not pharos_safe_mode.allow
		with data.params as default_params
		with data.wasm as wrap(calm_data)
		with input as intent("rebalance", ["1"])
}

test_deny_stale_data if {
	"stale_data" in pharos_safe_mode.deny
		with data.params as default_params
		with data.wasm as wrap(object.union(calm_data, {"data_age_seconds": 99999}))
		with input as intent("withdraw", ["1000"])
}

test_boundary_stress_exactly_at_threshold_engages_safe_mode if {
	at_threshold := object.union(calm_data, {"stress_score": 60})
	"safe_mode_blocks_exposure_increase" in pharos_safe_mode.deny
		with data.params as default_params
		with data.wasm as wrap(at_threshold)
		with input as intent("deposit", ["1000"])
}

test_boundary_stress_just_below_threshold_stays_open if {
	below := object.union(calm_data, {"stress_score": 59})
	pharos_safe_mode.allow
		with data.params as default_params
		with data.wasm as wrap(below)
		with input as intent("deposit", ["1000"])
}

test_deny_on_oracle_error if {
	not pharos_safe_mode.allow
		with data.params as default_params
		with data.wasm as wrap({"error": "oracle failed"})
		with input as intent("withdraw", ["1000"])
}

test_deny_on_empty_payload if {
	not pharos_safe_mode.allow
		with data.params as default_params
		with data.wasm as wrap({})
		with input as intent("withdraw", ["1000"])
}

# A missing intent must fail closed — this policy is meaningless without it.
test_missing_intent_does_not_allow if {
	not pharos_safe_mode.allow
		with data.params as default_params
		with data.wasm as wrap(calm_data)
		with input as {}
}

test_missing_depeg_field_does_not_allow if {
	d := wrap(object.remove(calm_data, {"depeg_active"}))
	not pharos_safe_mode.allow
		with data.params as default_params
		with data.wasm as d
		with input as intent("withdraw", ["1000"])
}

# Observed lag on the live stress + flow feeds is ~40 minutes. Pins that the
# shipped default tolerates it rather than denying every healthy asset.
test_real_world_age_passes_default_ceiling if {
	fresh := object.union(calm_data, {"data_age_seconds": 2316})
	not "stale_data" in pharos_safe_mode.deny
		with data.params as default_params
		with data.wasm as wrap(fresh)
		with input as intent("withdraw", ["1000"])
}
