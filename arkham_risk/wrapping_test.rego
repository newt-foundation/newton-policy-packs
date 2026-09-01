package arkham_risk_exposure_wrapping_test

import data.arkham_risk_exposure
import future.keywords

# Phase 0 § Stream B Rego shape test for arkham_risk.
#
# Locks the namespacing contract: the policy reads from
# `data.wasm.arkham_risk.<field>`, NOT `data.wasm.<field>`. Mirrors
# `policy.js`'s `wrapOutput("arkham_risk", ...)` envelope.
#
# Coverage limit: Rego side only. It does NOT execute `policy.js`.

default_params := {
	"severe_categories": ["sanctions", "hacker", "ransomware", "mixer", "darkweb"],
	"max_severe_hop_distance": 1,
	"material_exposure_usd": 10000,
	"recent_exposure_days": 30,
	"dust_tolerance_usd": 100,
	"deny_on_seed": true,
	"max_risk_score": 40,
	"max_data_age_seconds": 3600,
}

clean_inner := {
	"address": "0x71660c4005ba85c37ccec55d0c4493e66fe775d3",
	"chain": "ethereum",
	"risk_level": "low",
	"max_score": 5,
	"category_scores": {"sanctions": 0, "hacker": 0, "gambling": 5},
	"top_risk_category": "gambling",
	"is_seed": false,
	"paths": [],
	"data_age_seconds": 60,
}

hostile_path := {
	"category": "sanctions",
	"direction": "received",
	"hop_distance": 0,
	"seed_address": "0x00000000000000000000000000000000000000ff",
	"score": 99,
	"contributed_usd": 500000,
	"contributed_pct": 90,
	"nodes": [],
	"first_seen_days": 5,
	"last_seen_days": 1,
}

namespaced(overrides) := {"arkham_risk": object.union(clean_inner, overrides)}

test_namespaced_allow_when_clean if {
	arkham_risk_exposure.allow with data.params as default_params with data.wasm as namespaced({})
	count(arkham_risk_exposure.deny) == 0 with data.params as default_params with data.wasm as namespaced({})
}

test_namespaced_deny_severe_exposure_within_hops if {
	"severe_exposure_within_hops" in arkham_risk_exposure.deny
		with data.params as default_params
		with data.wasm as namespaced({"paths": [hostile_path]})
}

test_namespaced_deny_seed_address if {
	"seed_address" in arkham_risk_exposure.deny
		with data.params as default_params
		with data.wasm as namespaced({"is_seed": true})
}

test_namespaced_deny_risk_score_above_max if {
	"risk_score_above_max" in arkham_risk_exposure.deny
		with data.params as default_params
		with data.wasm as namespaced({"max_score": 99})
}

test_namespaced_deny_stale_data if {
	"stale_data" in arkham_risk_exposure.deny
		with data.params as default_params
		with data.wasm as namespaced({"data_age_seconds": 99999})
}

# Negative shape test: flat (un-namespaced) `data.wasm` must trigger nothing.
test_flat_input_does_not_trigger_namespaced_rules if {
	flat_with_violations := object.union(clean_inner, {
		"is_seed": true,
		"max_score": 100,
		"paths": [hostile_path],
		"data_age_seconds": 99999,
	})
	count(arkham_risk_exposure.deny) == 0
		with data.params as default_params
		with data.wasm as flat_with_violations
}

# ...and must not allow either.
test_flat_input_does_not_allow if {
	not arkham_risk_exposure.allow
		with data.params as default_params
		with data.wasm as clean_inner
}

test_namespaced_error_does_not_allow if {
	not arkham_risk_exposure.allow
		with data.params as default_params
		with data.wasm as {"arkham_risk": {"error": "oracle failed"}}
}

test_namespaced_empty_pack_slot_does_not_allow if {
	not arkham_risk_exposure.allow
		with data.params as default_params
		with data.wasm as {"arkham_risk": {}}
}

# Cross-pack composition: a sibling arkham pack carrying a hostile `paths`
# array under its own key must not leak into this pack's path analysis.
test_other_pack_keys_do_not_interfere if {
	composite := {
		"arkham_risk": clean_inner,
		"arkham_entity": {
			"max_risk_score": 100,
			"is_seed": true,
			"paths": [hostile_path],
			"data_age_seconds": 99999,
		},
		"arkham_counterparty": {"paths": [hostile_path]},
	}
	arkham_risk_exposure.allow with data.params as default_params with data.wasm as composite
	count(arkham_risk_exposure.deny) == 0 with data.params as default_params with data.wasm as composite
	count(arkham_risk_exposure.risk_paths) == 0 with data.params as default_params with data.wasm as composite
}
