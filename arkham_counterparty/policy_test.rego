package arkham_counterparty_activity_test

import data.arkham_counterparty_activity
import future.keywords

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

# An established supplier: 40 prior payments averaging $10k, seen last week,
# a quarter of recent activity, and today's wallet outflow at its usual level.
clean_data := {
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

wrap(inner) := {"arkham_counterparty": inner}

with_data(overrides) := wrap(object.union(clean_data, overrides))

new_counterparty(overrides) := with_data(object.union(
	{
		"is_known_counterparty": false,
		"counterparty_transaction_count": 0,
		"counterparty_total_usd": 0,
		"counterparty_avg_usd": null,
		"counterparty_last_seen_days": null,
		"counterparty_concentration_pct": null,
	},
	overrides,
))

test_allow_routine_payment_to_established_counterparty if {
	d := wrap(clean_data)
	arkham_counterparty_activity.allow with data.params as default_params with data.wasm as d
	count(arkham_counterparty_activity.deny) == 0 with data.params as default_params with data.wasm as d
}

test_deny_unknown_counterparty_when_required if {
	p := object.union(default_params, {"require_known_counterparty": true})
	d := new_counterparty({"transaction_amount_usd": 10})
	"unknown_counterparty" in arkham_counterparty_activity.deny with data.params as p with data.wasm as d
	not arkham_counterparty_activity.allow with data.params as p with data.wasm as d
}

test_deny_new_counterparty_over_intro_cap if {
	d := new_counterparty({"transaction_amount_usd": 5000})
	"new_counterparty_over_limit" in arkham_counterparty_activity.deny with data.params as default_params with data.wasm as d
	not arkham_counterparty_activity.allow with data.params as default_params with data.wasm as d
}

# The graduated path: a brand-new recipient is still usable for small sums.
test_allow_new_counterparty_under_intro_cap if {
	d := new_counterparty({"transaction_amount_usd": 500})
	arkham_counterparty_activity.allow with data.params as default_params with data.wasm as d
	count(arkham_counterparty_activity.deny) == 0 with data.params as default_params with data.wasm as d
}

test_deny_counterparty_too_new if {
	d := with_data({"counterparty_transaction_count": 1, "counterparty_avg_usd": 12000})
	"counterparty_too_new" in arkham_counterparty_activity.deny with data.params as default_params with data.wasm as d
	not arkham_counterparty_activity.allow with data.params as default_params with data.wasm as d
}

test_deny_stale_relationship if {
	d := with_data({"counterparty_last_seen_days": 400})
	"stale_relationship" in arkham_counterparty_activity.deny with data.params as default_params with data.wasm as d
	not arkham_counterparty_activity.allow with data.params as default_params with data.wasm as d
}

# $50k against a $10k average at a 3x multiple.
test_deny_amount_anomaly if {
	d := with_data({"transaction_amount_usd": 50000})
	"amount_anomaly" in arkham_counterparty_activity.deny with data.params as default_params with data.wasm as d
	not arkham_counterparty_activity.allow with data.params as default_params with data.wasm as d
}

test_deny_concentration_spike if {
	d := with_data({"counterparty_concentration_pct": 85})
	"concentration_spike" in arkham_counterparty_activity.deny with data.params as default_params with data.wasm as d
	not arkham_counterparty_activity.allow with data.params as default_params with data.wasm as d
}

test_deny_outflow_above_baseline if {
	d := with_data({"outflow_ratio": 5.5, "recent_daily_outflow_usd": 275000})
	"outflow_above_baseline" in arkham_counterparty_activity.deny with data.params as default_params with data.wasm as d
	not arkham_counterparty_activity.allow with data.params as default_params with data.wasm as d
}

test_deny_stale_data if {
	d := with_data({"data_age_seconds": 86400})
	"stale_data" in arkham_counterparty_activity.deny with data.params as default_params with data.wasm as d
	not arkham_counterparty_activity.allow with data.params as default_params with data.wasm as d
}

test_boundary_amount_exactly_at_avg_multiple_allows if {
	d := with_data({"transaction_amount_usd": 30000})
	arkham_counterparty_activity.allow with data.params as default_params with data.wasm as d
}

test_boundary_transaction_count_exactly_at_min_allows if {
	d := with_data({"counterparty_transaction_count": 3})
	arkham_counterparty_activity.allow with data.params as default_params with data.wasm as d
}

# A zero or null historical average must not make the anomaly rule divide
# its way into a spurious allow — or a spurious deny.
test_zero_average_fails_soft_on_anomaly if {
	d := with_data({"counterparty_avg_usd": 0, "transaction_amount_usd": 999999})
	not "amount_anomaly" in arkham_counterparty_activity.deny with data.params as default_params with data.wasm as d
}

test_null_optional_fields_fail_soft if {
	d := with_data({
		"counterparty_avg_usd": null,
		"counterparty_last_seen_days": null,
		"counterparty_concentration_pct": null,
		"outflow_ratio": null,
		"data_age_seconds": null,
	})
	arkham_counterparty_activity.allow with data.params as default_params with data.wasm as d
	count(arkham_counterparty_activity.deny) == 0 with data.params as default_params with data.wasm as d
}

test_multiple_denies_do_not_fail_open if {
	d := with_data({
		"counterparty_last_seen_days": 400,
		"counterparty_concentration_pct": 95,
		"outflow_ratio": 9,
		"transaction_amount_usd": 500000,
	})
	deny := arkham_counterparty_activity.deny with data.params as default_params with data.wasm as d
	"stale_relationship" in deny
	"concentration_spike" in deny
	"outflow_above_baseline" in deny
	"amount_anomaly" in deny
	count(deny) >= 4
	not arkham_counterparty_activity.allow with data.params as default_params with data.wasm as d
}

test_deny_on_oracle_error if {
	not arkham_counterparty_activity.allow with data.params as default_params with data.wasm as wrap({"error": "oracle failed"})
}

test_deny_on_empty_payload if {
	not arkham_counterparty_activity.allow with data.params as default_params with data.wasm as wrap({})
}

test_missing_groundedness_field_does_not_allow if {
	d := wrap(object.remove(clean_data, {"is_known_counterparty"}))
	not arkham_counterparty_activity.allow with data.params as default_params with data.wasm as d
	count(arkham_counterparty_activity.deny) == 0 with data.params as default_params with data.wasm as d
}
