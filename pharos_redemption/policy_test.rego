package pharos_redemption_backing_test

import data.pharos_redemption_backing
import future.keywords

default_params := {
	"require_redemption_available": true,
	"approved_route_families": ["issuer-direct", "authorised-participant"],
	"approved_access_models": ["permissionless", "kyc-gated"],
	"approved_settlement_models": ["same-day", "t-plus-one"],
	"required_route_status": "active",
	"min_confidence": 0.7,
	"min_daily_limit_multiple": 2,
	"max_data_age_seconds": 900,
}

# A $1M position against a $1B daily limit, redeemed direct from the issuer.
clean_data := {
	"stablecoin_id": "usdc-circle",
	"symbol": "USDC",
	"redemption_available": true,
	"route_family": "issuer-direct",
	"access_model": "kyc-gated",
	"settlement_model": "same-day",
	"route_status": "active",
	"holder_eligibility": "verified-institutions",
	"immediate_capacity_usd": 250000000,
	"daily_limit_usd": 1000000000,
	"min_redeem_usd": 100000,
	"fees_bps": 0,
	"confidence": 0.96,
	"reserve_composition": {"cash": 0.2, "treasuries": 0.8},
	"reserve_source_mode": "live",
	"reserve_sync_status": "synced",
	"transaction_amount_usd": 1000000,
	"daily_limit_multiple": 1000,
	"data_age_seconds": 45,
}

wrap(inner) := {"pharos_redemption": inner}

with_data(overrides) := wrap(object.union(clean_data, overrides))

test_allow_when_redemption_healthy if {
	d := wrap(clean_data)
	pharos_redemption_backing.allow with data.params as default_params with data.wasm as d
	count(pharos_redemption_backing.deny) == 0 with data.params as default_params with data.wasm as d
}

test_deny_redemption_unavailable if {
	d := with_data({
		"redemption_available": false,
		"route_family": null,
		"access_model": null,
		"settlement_model": null,
		"route_status": null,
	})
	"redemption_unavailable" in pharos_redemption_backing.deny with data.params as default_params with data.wasm as d
	not pharos_redemption_backing.allow with data.params as default_params with data.wasm as d
}

test_allow_no_redemption_when_not_required if {
	p := object.union(default_params, {"require_redemption_available": false})
	d := with_data({
		"redemption_available": false,
		"route_family": null,
		"access_model": null,
		"settlement_model": null,
		"route_status": null,
	})
	pharos_redemption_backing.allow with data.params as p with data.wasm as d
}

test_deny_unapproved_route_family if {
	d := with_data({"route_family": "amm-only"})
	"unapproved_route_family" in pharos_redemption_backing.deny with data.params as default_params with data.wasm as d
	not pharos_redemption_backing.allow with data.params as default_params with data.wasm as d
}

test_deny_unapproved_access_model if {
	d := with_data({"access_model": "whitelist-only"})
	"unapproved_access_model" in pharos_redemption_backing.deny with data.params as default_params with data.wasm as d
	not pharos_redemption_backing.allow with data.params as default_params with data.wasm as d
}

test_deny_unapproved_settlement_model if {
	d := with_data({"settlement_model": "t-plus-five"})
	"unapproved_settlement_model" in pharos_redemption_backing.deny with data.params as default_params with data.wasm as d
	not pharos_redemption_backing.allow with data.params as default_params with data.wasm as d
}

test_deny_route_status_not_approved if {
	d := with_data({"route_status": "impaired"})
	"route_status_not_approved" in pharos_redemption_backing.deny with data.params as default_params with data.wasm as d
	not pharos_redemption_backing.allow with data.params as default_params with data.wasm as d
}

# A position under the route's minimum cannot be redeemed at all.
test_deny_below_min_redeem if {
	d := with_data({"transaction_amount_usd": 5000, "daily_limit_multiple": 200000})
	"below_min_redeem" in pharos_redemption_backing.deny with data.params as default_params with data.wasm as d
	not pharos_redemption_backing.allow with data.params as default_params with data.wasm as d
}

test_boundary_amount_exactly_at_min_redeem_allows if {
	d := with_data({"transaction_amount_usd": 100000, "daily_limit_multiple": 10000})
	pharos_redemption_backing.allow with data.params as default_params with data.wasm as d
}

test_deny_position_exceeds_daily_limit if {
	d := with_data({"transaction_amount_usd": 800000000, "daily_limit_multiple": 1.25})
	"position_exceeds_daily_limit" in pharos_redemption_backing.deny with data.params as default_params with data.wasm as d
	not pharos_redemption_backing.allow with data.params as default_params with data.wasm as d
}

test_boundary_daily_limit_exactly_at_min_allows if {
	d := with_data({"daily_limit_multiple": 2})
	pharos_redemption_backing.allow with data.params as default_params with data.wasm as d
}

test_deny_low_confidence if {
	d := with_data({"confidence": 0.3})
	"low_confidence" in pharos_redemption_backing.deny with data.params as default_params with data.wasm as d
	not pharos_redemption_backing.allow with data.params as default_params with data.wasm as d
}

test_deny_stale_data if {
	d := with_data({"data_age_seconds": 7200})
	"stale_data" in pharos_redemption_backing.deny with data.params as default_params with data.wasm as d
	not pharos_redemption_backing.allow with data.params as default_params with data.wasm as d
}

# A zero amount leaves both size ratios undefined; that must fail-soft
# rather than reading as "below the minimum".
test_zero_amount_fails_soft_on_size_rules if {
	d := with_data({"transaction_amount_usd": 0, "daily_limit_multiple": null})
	not "below_min_redeem" in pharos_redemption_backing.deny with data.params as default_params with data.wasm as d
	not "position_exceeds_daily_limit" in pharos_redemption_backing.deny with data.params as default_params with data.wasm as d
	pharos_redemption_backing.allow with data.params as default_params with data.wasm as d
}

test_null_optional_fields_fail_soft if {
	d := with_data({
		"route_family": null,
		"access_model": null,
		"settlement_model": null,
		"route_status": null,
		"min_redeem_usd": null,
		"daily_limit_multiple": null,
		"confidence": null,
		"data_age_seconds": null,
	})
	pharos_redemption_backing.allow with data.params as default_params with data.wasm as d
	count(pharos_redemption_backing.deny) == 0 with data.params as default_params with data.wasm as d
}

test_multiple_denies_do_not_fail_open if {
	d := with_data({
		"route_family": "amm-only",
		"access_model": "whitelist-only",
		"route_status": "suspended",
		"confidence": 0.1,
		"daily_limit_multiple": 0.2,
	})
	deny := pharos_redemption_backing.deny with data.params as default_params with data.wasm as d
	"unapproved_route_family" in deny
	"unapproved_access_model" in deny
	"route_status_not_approved" in deny
	"low_confidence" in deny
	"position_exceeds_daily_limit" in deny
	count(deny) >= 5
	not pharos_redemption_backing.allow with data.params as default_params with data.wasm as d
}

test_deny_on_oracle_error if {
	not pharos_redemption_backing.allow with data.params as default_params with data.wasm as wrap({"error": "oracle failed"})
}

test_deny_on_empty_payload if {
	not pharos_redemption_backing.allow with data.params as default_params with data.wasm as wrap({})
}

test_missing_groundedness_field_does_not_allow if {
	d := wrap(object.remove(clean_data, {"redemption_available"}))
	not pharos_redemption_backing.allow with data.params as default_params with data.wasm as d
	count(pharos_redemption_backing.deny) == 0 with data.params as default_params with data.wasm as d
}
