package pharos_treasury_risk

import future.keywords

default allow := false

t := data.params

# Phase 0 § Stream B namespacing — see wrapping_test.rego. The three pharos
# packs all emit `stress_score`, `depeg_active` and `data_age_seconds`, so
# reading bare `data.wasm.*` would cross-wire a composite.
v := data.wasm.pharos_treasury

# Fields the oracle reports as `null` when Pharos has nothing to say. `null` is
# deliberately distinct from `0` — which for a stress score or a liquidity score
# would be a very different claim. Under `deny_on_missing_data` the curator has
# asked for the former to block rather than fail soft.
nullable_fields := {
	"stress_score": v.stress_score,
	"redemption_route_family": v.redemption_route_family,
	"redemption_access_model": v.redemption_access_model,
	"redemption_route_status": v.redemption_route_status,
	"exit_capacity_multiple": v.exit_capacity_multiple,
	"liquidity_score": v.liquidity_score,
	"data_age_seconds": v.data_age_seconds,
}

# --- deny rules ------------------------------------------------------------
#
# `deny` is the single source of truth for every rule in this policy. `allow`
# below consumes it; there is no parallel set of positive helper rules to drift
# out of sync with these.

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

# Pharos reports `open` for a working route, not `active` — a curator who
# guesses "active" denies every healthy asset, so the value is a param.
deny contains "route_status_not_approved" if {
	v.redemption_route_status != null
	v.redemption_route_status != t.required_route_status
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

# A threshold the curator configured is worth nothing if the oracle never
# reports the value it applies to. `exit_capacity_multiple` in particular is
# null whenever the caller passed no position size, which would otherwise let
# the pack's differentiated signal fail soft.
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
# silent-skips on an undefined field, so an error envelope yields an EMPTY deny
# set and a bare `count(deny) == 0` would fail OPEN on exactly the input that
# most needs to fail closed. `is_number(v.peg_deviation_bps)` also grounds the
# `abs()` in the peg rule, which is undefined rather than false on a non-number.
allow if {
	not v.error
	is_boolean(v.depeg_active)
	is_boolean(v.redemption_available)
	is_number(v.peg_deviation_bps)
	count(deny) == 0
}
