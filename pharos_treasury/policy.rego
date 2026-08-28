package pharos_treasury_risk

import future.keywords

default allow := false

t := data.params

# Phase 0 § Stream B namespacing — see wrapping_test.rego. The three pharos
# packs all emit `stress_score`, `depeg_active` and `data_age_seconds`, so
# reading bare `data.wasm.*` would cross-wire a composite.
v := data.wasm.pharos_treasury

# --- deny rules ------------------------------------------------------------

deny contains "active_depeg" if {
	t.deny_on_active_depeg
	v.depeg_active == true
}

# Deviation is signed by the oracle (negative = below peg) because the
# direction matters to a reader; the threshold is symmetric.
deny contains "peg_deviation_above_max" if abs(v.peg_deviation_bps) > t.max_peg_deviation_bps

deny contains "stress_above_max" if {
	v.stress_score != null
	v.stress_score > t.max_stress_score
}

deny contains "redemption_unavailable" if {
	t.require_redemption
	v.redemption_available == false
}

deny contains "unapproved_redemption_route" if {
	v.redemption_route_family != null
	not v.redemption_route_family in t.approved_redemption_route_families
}

deny contains "unapproved_access_model" if {
	v.redemption_access_model != null
	not v.redemption_access_model in t.approved_access_models
}

deny contains "route_status_impaired" if {
	v.redemption_route_status != null
	v.redemption_route_status != "active"
}

# The differentiated Pharos signal: can this position actually be exited?
deny contains "insufficient_exit_capacity" if {
	v.exit_capacity_multiple != null
	v.exit_capacity_multiple < t.min_exit_capacity_multiple
}

deny contains "liquidity_score_below_min" if {
	v.liquidity_score != null
	v.liquidity_score < t.min_liquidity_score
}

deny contains "stale_data" if {
	v.data_age_seconds != null
	v.data_age_seconds > t.max_data_age_seconds
}

# --- allow -----------------------------------------------------------------

# Explicit positive conjunction, not `count(deny) == 0` — every deny rule
# silent-skips on undefined fields, so an error envelope would yield an
# empty deny set and fail OPEN. The `is_*` checks ground the payload.
allow if {
	is_boolean(v.depeg_active)
	is_boolean(v.redemption_available)
	is_number(v.peg_deviation_bps)
	not depeg_blocks
	abs(v.peg_deviation_bps) <= t.max_peg_deviation_bps
	stress_ok
	redemption_ok
	route_family_ok
	access_model_ok
	route_status_ok
	exit_capacity_ok
	liquidity_ok
	fresh_ok
}

depeg_blocks if {
	t.deny_on_active_depeg
	v.depeg_active == true
}

# `null` is the oracle's "Pharos did not report this", distinct from 0 —
# which for a stress score or liquidity score would be a very different claim.
stress_ok if v.stress_score == null

stress_ok if v.stress_score <= t.max_stress_score

redemption_ok if v.redemption_available == true

redemption_ok if {
	v.redemption_available == false
	not t.require_redemption
}

route_family_ok if v.redemption_route_family == null

route_family_ok if v.redemption_route_family in t.approved_redemption_route_families

access_model_ok if v.redemption_access_model == null

access_model_ok if v.redemption_access_model in t.approved_access_models

route_status_ok if v.redemption_route_status == null

route_status_ok if v.redemption_route_status == "active"

# Undefined when the caller passed no amount (division by zero), which
# fail-softs rather than fabricating a ratio.
exit_capacity_ok if v.exit_capacity_multiple == null

exit_capacity_ok if v.exit_capacity_multiple >= t.min_exit_capacity_multiple

liquidity_ok if v.liquidity_score == null

liquidity_ok if v.liquidity_score >= t.min_liquidity_score

fresh_ok if v.data_age_seconds == null

fresh_ok if v.data_age_seconds <= t.max_data_age_seconds
