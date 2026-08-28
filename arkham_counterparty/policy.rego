package arkham_counterparty_activity

import future.keywords

default allow := false

t := data.params

# Phase 0 § Stream B namespacing — see wrapping_test.rego. Sibling arkham
# packs emit overlapping field names, so this must stay namespaced.
v := data.wasm.arkham_counterparty

# Caller-supplied via wasm_args and echoed by the oracle, so NOT attested.
# See README.md.
amount := v.transaction_amount_usd

# --- deny rules ------------------------------------------------------------

deny contains "unknown_counterparty" if {
	t.require_known_counterparty
	v.is_known_counterparty == false
}

deny contains "new_counterparty_over_limit" if {
	v.is_known_counterparty == false
	amount > t.max_new_counterparty_usd
}

deny contains "counterparty_too_new" if {
	v.is_known_counterparty == true
	v.counterparty_transaction_count < t.min_counterparty_transactions
}

deny contains "stale_relationship" if {
	v.counterparty_last_seen_days != null
	v.counterparty_last_seen_days > t.max_counterparty_last_seen_days
}

# An established counterparty is no excuse for a payment wildly out of
# scale with the relationship's history.
deny contains "amount_anomaly" if {
	v.counterparty_avg_usd != null
	v.counterparty_avg_usd > 0
	amount > v.counterparty_avg_usd * t.max_amount_vs_avg_multiple
}

deny contains "concentration_spike" if {
	v.counterparty_concentration_pct != null
	v.counterparty_concentration_pct > t.max_counterparty_concentration_pct
}

deny contains "outflow_above_baseline" if {
	v.outflow_ratio != null
	v.outflow_ratio > t.max_outflow_vs_baseline_multiple
}

deny contains "stale_data" if {
	v.data_age_seconds != null
	v.data_age_seconds > t.max_data_age_seconds
}

# --- allow -----------------------------------------------------------------

# Explicit positive conjunction, not `count(deny) == 0` — every deny rule
# silent-skips on undefined fields, so an error envelope would produce an
# empty deny set and fail OPEN. The `is_*` checks ground the payload.
allow if {
	is_boolean(v.is_known_counterparty)
	is_number(amount)
	counterparty_ok
	recency_ok
	amount_ok
	concentration_ok
	outflow_ok
	fresh_ok
}

# Established relationship: known, and with enough history behind it.
counterparty_ok if {
	v.is_known_counterparty == true
	v.counterparty_transaction_count >= t.min_counterparty_transactions
}

# New relationship: permitted only below the introductory cap, and only
# when the curator has not demanded a known counterparty outright.
counterparty_ok if {
	v.is_known_counterparty == false
	not t.require_known_counterparty
	amount <= t.max_new_counterparty_usd
}

# `null` is the oracle's "Arkham did not report this", distinct from 0.
recency_ok if v.counterparty_last_seen_days == null

recency_ok if v.counterparty_last_seen_days <= t.max_counterparty_last_seen_days

amount_ok if v.counterparty_avg_usd == null

amount_ok if v.counterparty_avg_usd <= 0

amount_ok if amount <= v.counterparty_avg_usd * t.max_amount_vs_avg_multiple

concentration_ok if v.counterparty_concentration_pct == null

concentration_ok if v.counterparty_concentration_pct <= t.max_counterparty_concentration_pct

outflow_ok if v.outflow_ratio == null

outflow_ok if v.outflow_ratio <= t.max_outflow_vs_baseline_multiple

fresh_ok if v.data_age_seconds == null

fresh_ok if v.data_age_seconds <= t.max_data_age_seconds
