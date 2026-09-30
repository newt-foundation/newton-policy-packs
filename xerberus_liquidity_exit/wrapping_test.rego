package xerberus_liquidity_exit_wrapping_test

import data.xerberus_liquidity_exit
import future.keywords

# Phase 0 § Stream B Rego shape test for xerberus_liquidity_exit.
#
# Locks the namespacing contract: the policy reads from
# `data.wasm.xerberus_liquidity_exit.<field>`, NOT `data.wasm.<field>`. Mirrors
# `policy.js`'s `wrapOutput("xerberus_liquidity_exit", ...)` envelope.
#
# Coverage limit: Rego side only. It does NOT execute `policy.js`.

default_params := {
	"max_days_to_exit": 7,
	"max_impact_band_pct": 1,
	"deny_on_stale": true,
	"max_data_age_seconds": 86400,
	"require_token_in_intent": false,
}

clean_inner := {
	"token": "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0",
	"impact_band_pct": 1,
	"max_sale_per_day_usd": 190110.72,
	"days_to_exit": 5.2601,
	"window_honored": true,
	"is_stale": false,
	"data_age_seconds": 3600,
}

namespaced(overrides) := {"xerberus_liquidity_exit": object.union(clean_inner, overrides)}

test_namespaced_allow_when_clean if {
	xerberus_liquidity_exit.allow with data.params as default_params with data.wasm as namespaced({})
}

test_namespaced_deny_exit_too_slow if {
	"exit_too_slow" in xerberus_liquidity_exit.deny
		with data.params as default_params
		with data.wasm as namespaced({"days_to_exit": 30})
}

# Flat (un-namespaced) `data.wasm` must fire none of the business rules and
# must not allow.
test_flat_input_does_not_trigger_business_rules if {
	flat := object.union(clean_inner, {"days_to_exit": 30, "is_stale": true})
	xerberus_liquidity_exit.deny == {"malformed_oracle_output"} with data.params as default_params with data.wasm as flat
}

test_flat_input_does_not_allow if {
	not xerberus_liquidity_exit.allow with data.params as default_params with data.wasm as clean_inner
}

test_namespaced_empty_pack_slot_does_not_allow if {
	not xerberus_liquidity_exit.allow with data.params as default_params with data.wasm as {"xerberus_liquidity_exit": {}}
}

# A sibling xerberus pack carrying a slow exit under its own key must not leak
# into this pack.
test_other_pack_keys_do_not_interfere if {
	composite := {
		"xerberus_liquidity_exit": clean_inner,
		"xerberus_what_if": {"days_to_exit": 99, "is_stale": true},
		"xerberus_common_cause": {"error": "boom"},
	}
	xerberus_liquidity_exit.allow with data.params as default_params with data.wasm as composite
}
