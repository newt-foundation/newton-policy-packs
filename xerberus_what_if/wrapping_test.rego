package xerberus_portfolio_what_if_wrapping_test

import data.xerberus_portfolio_what_if
import future.keywords

# Phase 0 § Stream B Rego shape test for xerberus_what_if.
#
# Locks the namespacing contract: the policy reads from
# `data.wasm.xerberus_what_if.<field>`, NOT `data.wasm.<field>`. Mirrors
# `policy.js`'s `wrapOutput("xerberus_what_if", ...)` envelope.
#
# Coverage limit: Rego side only. It does NOT execute `policy.js`.

default_params := {
	"max_post_token_share_pct": 50,
	"max_hhi_delta": 0.01,
	"min_ladder_30d_delta_pp": -3,
	"max_slowest_exit_delta_days": 3,
	"deny_on_issues": true,
	"deny_on_stale": true,
	"max_data_age_seconds": 86400,
	"require_intent_party_in_wallets": false,
	"allow_stale_when_risk_reducing": false,
}

clean_inner := {
	"wallets": ["0xac0168b4fd7427bfd616e3a47fc05dd8175d5b64"],
	"is_risk_reducing": false,
	"post_largest_token_pct": 41.2,
	"pre_largest_token_pct": 40.9,
	"hhi_delta": 0.002,
	"ladder_30d_delta_pp": -0.27,
	"slowest_exit_delta_days": 0.31,
	"issues_count": 0,
	"window_honored": true,
	"is_stale": false,
	"data_age_seconds": 3600,
}

namespaced(overrides) := {"xerberus_what_if": object.union(clean_inner, overrides)}

test_namespaced_allow_when_clean if {
	xerberus_portfolio_what_if.allow with data.params as default_params with data.wasm as namespaced({})
}

test_namespaced_deny_hhi_delta_limit if {
	"hhi_delta_limit" in xerberus_portfolio_what_if.deny
		with data.params as default_params
		with data.wasm as namespaced({"hhi_delta": 0.5})
}

test_flat_input_does_not_trigger_business_rules if {
	flat := object.union(clean_inner, {"hhi_delta": 0.5, "is_stale": true})
	xerberus_portfolio_what_if.deny == {"malformed_oracle_output"} with data.params as default_params with data.wasm as flat
}

test_flat_input_does_not_allow if {
	not xerberus_portfolio_what_if.allow with data.params as default_params with data.wasm as clean_inner
}

test_namespaced_empty_pack_slot_does_not_allow if {
	not xerberus_portfolio_what_if.allow with data.params as default_params with data.wasm as {"xerberus_what_if": {}}
}

test_other_pack_keys_do_not_interfere if {
	composite := {
		"xerberus_what_if": clean_inner,
		"xerberus_liquidity_exit": {"hhi_delta": 0.9, "is_stale": true},
		"xerberus_common_cause": {"error": "boom"},
	}
	xerberus_portfolio_what_if.allow with data.params as default_params with data.wasm as composite
}
