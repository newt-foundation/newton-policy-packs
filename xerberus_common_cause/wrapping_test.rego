package xerberus_common_cause_wrapping_test

import data.xerberus_common_cause
import future.keywords

# Phase 0 § Stream B Rego shape test for xerberus_common_cause.
#
# Locks the namespacing contract: the policy reads from
# `data.wasm.xerberus_common_cause.<field>`, NOT `data.wasm.<field>`. Mirrors
# `policy.js`'s `wrapOutput("xerberus_common_cause", ...)` envelope.
#
# Coverage limit: Rego side only. It does NOT execute `policy.js`.

default_params := {
	"min_venues_for_shared_node": 2,
	"shared_node_types": [],
	"max_shared_exposure_usd": 5000000,
	"max_shared_exposure_pct_of_book": 40,
	"max_shared_expected_loss_share": 0.05,
	"forbidden_shared_nodes": [],
	"material_venue_usd": 100000,
	"deny_on_unresolved": true,
	"deny_on_truncated": true,
	"min_venues_compared": 2,
	"deny_on_stale": true,
	"max_data_age_seconds": 86400,
	"require_intent_party_in_wallets": false,
}

clean_inner := {
	"wallets": ["0xac0168b4fd7427bfd616e3a47fc05dd8175d5b64"],
	"venues_compared_count": 11,
	"book_usd": 16444692.56,
	"unresolved_venues": [],
	"shared_nodes": [],
	"shared_nodes_truncated": false,
	"window_honored": null,
	"is_stale": false,
	"data_age_seconds": 3600,
}

hostile_node := {
	"node": "token:0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0",
	"node_type": "token",
	"label": "wstETH",
	"venue_count": 7,
	"exposure_usd": 9000000,
	"expected_loss_share": 0.03,
}

namespaced(overrides) := {"xerberus_common_cause": object.union(clean_inner, overrides)}

test_namespaced_allow_when_clean if {
	xerberus_common_cause.allow with data.params as default_params with data.wasm as namespaced({})
}

test_namespaced_deny_shared_exposure_limit if {
	"shared_exposure_limit" in xerberus_common_cause.deny
		with data.params as default_params
		with data.wasm as namespaced({"shared_nodes": [hostile_node]})
}

test_flat_input_does_not_trigger_business_rules if {
	flat := object.union(clean_inner, {"shared_nodes": [hostile_node], "is_stale": true})
	xerberus_common_cause.deny == {"malformed_oracle_output"} with data.params as default_params with data.wasm as flat
}

test_flat_input_does_not_allow if {
	not xerberus_common_cause.allow with data.params as default_params with data.wasm as clean_inner
}

test_namespaced_empty_pack_slot_does_not_allow if {
	not xerberus_common_cause.allow with data.params as default_params with data.wasm as {"xerberus_common_cause": {}}
}

test_other_pack_keys_do_not_interfere if {
	composite := {
		"xerberus_common_cause": clean_inner,
		"xerberus_what_if": {"shared_nodes": [hostile_node], "is_stale": true},
		"xerberus_liquidity_exit": {"error": "boom"},
	}
	xerberus_common_cause.allow with data.params as default_params with data.wasm as composite
}
