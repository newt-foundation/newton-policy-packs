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

# Fields the oracle reports as `null` when Arkham has nothing to say. `null` is
# deliberately distinct from `0`: a null age means "not reported", a zero age
# would mean "observed just now". Under `deny_on_missing_data` the curator has
# asked for the former to block rather than fail soft.
nullable_fields := {
	"counterparty_last_seen_days": v.counterparty_last_seen_days,
	"counterparty_avg_usd": v.counterparty_avg_usd,
	"counterparty_concentration_pct": v.counterparty_concentration_pct,
	"outflow_ratio": v.outflow_ratio,
	"data_age_seconds": v.data_age_seconds,
}

# --- deny rules ------------------------------------------------------------
#
# `deny` is the single source of truth for every rule in this policy. `allow`
# below consumes it; there is no parallel set of positive helper rules to drift
# out of sync with these.

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
#
# A zero-or-null historical average skips this rule: multiplying by zero would
# make every payment infinitely anomalous. That leaves a genuine gap — a
# counterparty whose average is a true 0 admits any amount here, gated only by
# the other rules. Deliberately out of scope for this policy; a curator who
# wants it closed should set `deny_on_missing_data` and lean on
# `max_new_counterparty_usd`.
deny contains "amount_anomaly" if {
	v.counterparty_avg_usd != null
	v.counterparty_avg_usd > 0
	amount > v.counterparty_avg_usd * t.max_amount_vs_avg_multiple
}

# Fail closed on a misconfigured multiplier. A `0` here would silently disable
# the anomaly rule rather than tightening it.
#
# The check has to route through a helper: OPA hoists `t.max_amount_vs_avg_multiple`
# out of a `not ... > 0` into its own conjunct, so an ABSENT param would make the
# whole rule body undefined instead of negating to true. Negating a named rule
# catches the absent case as well as the zero one.
deny contains "misconfigured_max_amount_vs_avg_multiple" if not valid_avg_multiple

valid_avg_multiple if t.max_amount_vs_avg_multiple > 0

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

# A threshold the curator configured is worth nothing if the oracle never
# reports the value it applies to. See README for which fields Arkham does not
# populate today.
deny contains sprintf("missing_%v", [name]) if {
	t.deny_on_missing_data
	some name, value in nullable_fields
	value == null
}

# --- allow -----------------------------------------------------------------

# `allow` is the ONLY on-chain entrypoint — scripts/upload.sh derives
# `<package>.allow` and nothing else is evaluated.
#
# The groundedness probes are load-bearing, not decoration: every deny rule
# silent-skips on an undefined field, so an error envelope or a partial payload
# yields an EMPTY deny set and a bare `count(deny) == 0` would fail OPEN on
# exactly the input that most needs to fail closed. The probes below are what
# make it fail CLOSED.
allow if {
	not v.error
	is_boolean(v.is_known_counterparty)
	is_number(amount)
	count(deny) == 0
}
