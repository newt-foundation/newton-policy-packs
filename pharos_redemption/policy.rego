package pharos_redemption_backing

import future.keywords

default allow := false

t := data.params

# Phase 0 § Stream B namespacing — see wrapping_test.rego.
v := data.wasm.pharos_redemption

# --- deny rules ------------------------------------------------------------

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

# --- allow -----------------------------------------------------------------

# Explicit positive conjunction, not `count(deny) == 0` — every deny rule
# silent-skips on undefined fields, so an error envelope would yield an empty
# deny set and fail OPEN. `is_boolean(v.redemption_available)` grounds it.
allow if {
	is_boolean(v.redemption_available)
	availability_ok
	route_family_ok
	access_model_ok
	settlement_model_ok
	route_status_ok
	capacity_ok
	route_score_ok
	capacity_confidence_ok
	reserve_ok
	fresh_ok
}

availability_ok if v.redemption_available == true

availability_ok if {
	v.redemption_available == false
	not t.require_redemption_available
}

# `null` is the oracle's "Pharos did not report this". Each of these fail-softs
# on null but denies on a reported-but-unapproved value.
route_family_ok if v.route_family == null

route_family_ok if v.route_family in t.approved_route_families

access_model_ok if v.access_model == null

access_model_ok if v.access_model in t.approved_access_models

settlement_model_ok if v.settlement_model == null

settlement_model_ok if v.settlement_model in t.approved_settlement_models

route_status_ok if v.route_status == null

route_status_ok if v.route_status == t.required_route_status

capacity_ok if v.capacity_multiple == null

capacity_ok if v.capacity_multiple >= t.min_capacity_multiple

route_score_ok if v.route_score == null

route_score_ok if v.route_score >= t.min_route_score

capacity_confidence_ok if count(t.approved_capacity_confidence) == 0

capacity_confidence_ok if v.capacity_confidence == null

capacity_confidence_ok if v.capacity_confidence in t.approved_capacity_confidence

reserve_ok if v.reserve_elevated_risk_pct == null

reserve_ok if v.reserve_elevated_risk_pct <= t.max_reserve_elevated_risk_pct

fresh_ok if v.data_age_seconds == null

fresh_ok if v.data_age_seconds <= t.max_data_age_seconds
