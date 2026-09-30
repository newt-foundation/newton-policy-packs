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
	"max_shared_gap_exposure_usd": 5000000,
	"gap_failure_classes": [],
	"forbidden_shared_dependencies": ["protocol:chainlink"],
	"min_venues_for_shared_dependency": 2,
	"max_shared_collateral_pct_of_book": 25,
	"material_subject_usd": 100000,
	"deny_on_unscored": true,
	"min_subjects_compared": 2,
	"deny_on_stale": true,
	"max_data_age_seconds": 86400,
	"require_intent_party_in_wallets": false,
}

clean_inner := {
	"wallets": ["0xac0168b4fd7427bfd616e3a47fc05dd8175d5b64"],
	"subjects_compared_count": 3,
	"total_exposure_usd": 9308230.82,
	"unscored_subjects": [],
	"shared_gaps": [],
	"shared_dependencies": [],
	"shared_collateral": [],
	"window_honored": true,
	"is_stale": false,
	"data_age_seconds": 3600,
}

hostile_gap := {"tag": "x", "failure_class": "oracle_integrity", "subject_count": 3, "combined_exposure_usd": 9000000}

namespaced(overrides) := {"xerberus_common_cause": object.union(clean_inner, overrides)}

test_namespaced_allow_when_clean if {
	xerberus_common_cause.allow with data.params as default_params with data.wasm as namespaced({})
}

test_namespaced_deny_shared_gap_limit if {
	"shared_gap_limit" in xerberus_common_cause.deny
		with data.params as default_params
		with data.wasm as namespaced({"shared_gaps": [hostile_gap]})
}

test_flat_input_does_not_trigger_business_rules if {
	flat := object.union(clean_inner, {"shared_gaps": [hostile_gap], "is_stale": true})
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
		"xerberus_what_if": {"shared_gaps": [hostile_gap], "is_stale": true},
		"xerberus_liquidity_exit": {"error": "boom"},
	}
	xerberus_common_cause.allow with data.params as default_params with data.wasm as composite
}
