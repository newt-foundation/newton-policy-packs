package arkham_counterparty_activity_wrapping_test

import data.arkham_counterparty_activity
import future.keywords

# Phase 0 § Stream B Rego shape test for arkham_counterparty.
#
# Locks the namespacing contract: the policy reads from
# `data.wasm.arkham_counterparty.<field>`, NOT `data.wasm.<field>`. Mirrors
# `policy.js`'s `wrapOutput("arkham_counterparty", ...)` envelope.
#
# Coverage limit: Rego side only. It does NOT execute `policy.js` — runtime
# output shape is locked by the Stream C AST-lint guard plus live
# `newton-cli policy simulate` runs.

default_params := {
	"require_known_counterparty": false,
	"max_new_counterparty_usd": 1000,
	"min_counterparty_transactions": 3,
	"max_counterparty_last_seen_days": 90,
	"max_amount_vs_avg_multiple": 3,
	"max_counterparty_concentration_pct": 50,
	"max_outflow_vs_baseline_multiple": 2,
	"max_data_age_seconds": 3600,
}

clean_inner := {
	"sender_address": "0x8d84b1344cb6375694f5862c868ba2c78240c076",
	"destination_address": "0x71660c4005ba85c37ccec55d0c4493e66fe775d3",
	"chains": "ethereum",
	"is_known_counterparty": true,
	"counterparty_transaction_count": 40,
	"counterparty_total_usd": 400000,
	"counterparty_avg_usd": 10000,
	"counterparty_last_seen_days": 7,
	"counterparty_concentration_pct": 25,
	"normal_daily_outflow_usd": 50000,
	"recent_daily_outflow_usd": 55000,
	"outflow_ratio": 1.1,
	"transaction_amount_usd": 12000,
	"data_age_seconds": 60,
}

namespaced(overrides) := {"arkham_counterparty": object.union(clean_inner, overrides)}

test_namespaced_allow_when_clean if {
	arkham_counterparty_activity.allow with data.params as default_params with data.wasm as namespaced({})
	count(arkham_counterparty_activity.deny) == 0 with data.params as default_params with data.wasm as namespaced({})
}

test_namespaced_deny_amount_anomaly if {
	"amount_anomaly" in arkham_counterparty_activity.deny
		with data.params as default_params
		with data.wasm as namespaced({"transaction_amount_usd": 500000})
}

test_namespaced_deny_concentration_spike if {
	"concentration_spike" in arkham_counterparty_activity.deny
		with data.params as default_params
		with data.wasm as namespaced({"counterparty_concentration_pct": 99})
}

test_namespaced_deny_outflow_above_baseline if {
	"outflow_above_baseline" in arkham_counterparty_activity.deny
		with data.params as default_params
		with data.wasm as namespaced({"outflow_ratio": 9})
}

test_namespaced_deny_stale_relationship if {
	"stale_relationship" in arkham_counterparty_activity.deny
		with data.params as default_params
		with data.wasm as namespaced({"counterparty_last_seen_days": 999})
}

# Negative shape test: flat (un-namespaced) `data.wasm` must trigger nothing.
test_flat_input_does_not_trigger_namespaced_rules if {
	flat_with_violations := object.union(clean_inner, {
		"is_known_counterparty": false,
		"counterparty_last_seen_days": 999,
		"counterparty_concentration_pct": 99,
		"outflow_ratio": 99,
		"transaction_amount_usd": 999999999,
		"data_age_seconds": 99999,
	})
	count(arkham_counterparty_activity.deny) == 0
		with data.params as default_params
		with data.wasm as flat_with_violations
}

# ...and must not allow either — fail closed, not through an empty deny set.
test_flat_input_does_not_allow if {
	not arkham_counterparty_activity.allow
		with data.params as default_params
		with data.wasm as clean_inner
}

test_namespaced_error_does_not_allow if {
	not arkham_counterparty_activity.allow
		with data.params as default_params
		with data.wasm as {"arkham_counterparty": {"error": "oracle failed"}}
}

test_namespaced_empty_pack_slot_does_not_allow if {
	not arkham_counterparty_activity.allow
		with data.params as default_params
		with data.wasm as {"arkham_counterparty": {}}
}

# Cross-pack composition: sibling arkham packs carry the SAME field names
# with hostile values and must not bleed into this pack's decision.
test_other_pack_keys_do_not_interfere if {
	composite := {
		"arkham_counterparty": clean_inner,
		"arkham_entity": {
			"transaction_amount_usd": 999999999,
			"data_age_seconds": 99999,
			"has_attribution": false,
		},
		"arkham_risk": {
			"max_risk_score": 100,
			"data_age_seconds": 99999,
		},
	}
	arkham_counterparty_activity.allow with data.params as default_params with data.wasm as composite
	count(arkham_counterparty_activity.deny) == 0 with data.params as default_params with data.wasm as composite
}
