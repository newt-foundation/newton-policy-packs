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

deny contains "route_status_not_approved" if {
	v.route_status != null
	v.route_status != t.required_route_status
}

# A position below the route's redemption minimum cannot be redeemed at
# all, which defeats the point of a redemption-backed policy.
deny contains "below_min_redeem" if {
	v.min_redeem_usd != null
	v.transaction_amount_usd != null
	v.transaction_amount_usd > 0
	v.transaction_amount_usd < v.min_redeem_usd
}

deny contains "position_exceeds_daily_limit" if {
	v.daily_limit_multiple != null
	v.daily_limit_multiple < t.min_daily_limit_multiple
}

deny contains "low_confidence" if {
	v.confidence != null
	v.confidence < t.min_confidence
}

deny contains "stale_data" if {
	v.data_age_seconds != null
	v.data_age_seconds > t.max_data_age_seconds
}

# --- allow -----------------------------------------------------------------

# Explicit positive conjunction, not `count(deny) == 0` — every deny rule
# silent-skips on undefined fields, so an error envelope would yield an
# empty deny set and fail OPEN.
allow if {
	is_boolean(v.redemption_available)
	availability_ok
	route_family_ok
	access_model_ok
	settlement_model_ok
	route_status_ok
	min_redeem_ok
	daily_limit_ok
	confidence_ok
	fresh_ok
}

availability_ok if v.redemption_available == true

availability_ok if {
	v.redemption_available == false
	not t.require_redemption_available
}

# `null` is the oracle's "Pharos did not report this". Each of these
# fail-softs on null but denies on a reported-but-unapproved value.
route_family_ok if v.route_family == null

route_family_ok if v.route_family in t.approved_route_families

access_model_ok if v.access_model == null

access_model_ok if v.access_model in t.approved_access_models

settlement_model_ok if v.settlement_model == null

settlement_model_ok if v.settlement_model in t.approved_settlement_models

route_status_ok if v.route_status == null

route_status_ok if v.route_status == t.required_route_status

min_redeem_ok if v.min_redeem_usd == null

min_redeem_ok if v.transaction_amount_usd == null

min_redeem_ok if v.transaction_amount_usd == 0

min_redeem_ok if v.transaction_amount_usd >= v.min_redeem_usd

daily_limit_ok if v.daily_limit_multiple == null

daily_limit_ok if v.daily_limit_multiple >= t.min_daily_limit_multiple

confidence_ok if v.confidence == null

confidence_ok if v.confidence >= t.min_confidence

fresh_ok if v.data_age_seconds == null

fresh_ok if v.data_age_seconds <= t.max_data_age_seconds
