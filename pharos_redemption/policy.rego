package pharos_redemption_backing

import future.keywords

default allow := false

t := data.params

# Phase 0 § Stream B namespacing — see wrapping_test.rego.
v := data.wasm.pharos_redemption

# Fields the oracle reports as `null` when Pharos has nothing to say. `null` is
# deliberately distinct from `0`: a null route score means "not reported", a
# zero score would be a genuine bottom-of-the-range verdict. Under
# `deny_on_missing_data` the curator has asked for the former to block rather
# than fail soft.
nullable_fields := {
	"route_family": v.route_family,
	"access_model": v.access_model,
	"settlement_model": v.settlement_model,
	"route_status": v.route_status,
	"capacity_multiple": v.capacity_multiple,
	"route_score": v.route_score,
	"capacity_confidence": v.capacity_confidence,
	"reserve_elevated_risk_pct": v.reserve_elevated_risk_pct,
	"data_age_seconds": v.data_age_seconds,
}

# --- deny rules ------------------------------------------------------------
#
# `deny` is the single source of truth for every rule in this policy. `allow`
# below consumes it; there is no parallel set of positive helper rules to drift
# out of sync with these.

deny contains "redemption_unavailable" if {
	t.require_redemption_available
	v.redemption_available == false
}

deny contains "unapproved_route_family" if {
	v.route_family != null
	not v.route_family in t.approved_route_families
}

deny contains "unapproved_access_model" if {
	v.access_model != null
	not v.access_model in t.approved_access_models
}

deny contains "unapproved_settlement_model" if {
	v.settlement_model != null
	not v.settlement_model in t.approved_settlement_models
}

# Pharos reports `open` for a working route, not `active`.
deny contains "route_status_not_approved" if {
	v.route_status != null
	v.route_status != t.required_route_status
}

# Sizing is against IMMEDIATE capacity: Pharos publishes no daily limit and no
# redemption minimum on this endpoint.
deny contains "position_exceeds_capacity" if {
	v.capacity_multiple != null
	v.capacity_multiple < t.min_capacity_multiple
}

deny contains "low_route_score" if {
	v.route_score != null
	v.route_score < t.min_route_score
}

deny contains "unapproved_capacity_confidence" if {
	count(t.approved_capacity_confidence) > 0
	v.capacity_confidence != null
	not v.capacity_confidence in t.approved_capacity_confidence
}

deny contains "reserve_risk_above_max" if {
	v.reserve_elevated_risk_pct != null
	v.reserve_elevated_risk_pct > t.max_reserve_elevated_risk_pct
}

deny contains "stale_data" if {
	v.data_age_seconds != null
	v.data_age_seconds > t.max_data_age_seconds
}

# A threshold the curator configured is worth nothing if the oracle never
# reports the value it applies to.
deny contains sprintf("missing_%v", [name]) if {
	t.deny_on_missing_data
	some name, value in nullable_fields
	value == null
}

# --- allow -----------------------------------------------------------------

# `allow` is the ONLY on-chain entrypoint — scripts/upload.sh derives
# `<package>.allow` and nothing else is evaluated.
#
# The groundedness probe is load-bearing, not decoration: every deny rule
# silent-skips on an undefined field, so an error envelope yields an EMPTY deny
# set and a bare `count(deny) == 0` would fail OPEN on exactly the input that
# most needs to fail closed.
allow if {
	not v.error
	is_boolean(v.redemption_available)
	count(deny) == 0
}
