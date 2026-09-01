package pharos_redemption_backing_test

import data.pharos_redemption_backing
import future.keywords

# Fixtures mirror the REAL `/api/redemption-backstops` + `/api/stablecoin-reserves`
# payloads for usdc-circle, captured 2026-08-28. Note `route_status` is "open"
# (Pharos does not use "active"), capacity is an IMMEDIATE bound rather than a
# daily limit, and route quality is a 0-100 `route_score` rather than a 0-1
# confidence — none of those fields exist on this API.

default_params := {
	"require_redemption_available": true,
	"approved_route_families": ["offchain-issuer", "authorised-participant"],
	"approved_access_models": ["issuer-api", "permissionless"],
	"approved_settlement_models": ["same-day", "t-plus-one"],
	"required_route_status": "open",
	"min_route_score": 50,
	"approved_capacity_confidence": ["documented-bound", "measured"],
	"min_capacity_multiple": 2,
	"max_reserve_elevated_risk_pct": 25,
	"max_data_age_seconds": 21600,
	"deny_on_missing_fields": [],
}

clean_data := {
	"stablecoin_id": "usdc-circle",
	"symbol": "USDC",
	"issuer": "circle",
	"redemption_available": true,
	"route_family": "offchain-issuer",
	"access_model": "issuer-api",
	"settlement_model": "same-day",
	"execution_model": "rules-based-nav",
	"route_status": "open",
	"holder_eligibility": "verified-customer",
	"provider": "supply-ratio-model",
	"source_mode": "estimated",
	"immediate_capacity_usd": 5152335530,
	"modeled_exit_size_usd": 25000000,
	"capacity_confidence": "documented-bound",
	"route_score": 63,
	"access_score": 40,
	"settlement_score": 65,
	"capacity_score": 69,
	"fee_bps": null,
	"queue_enabled": false,
	"reserve_composition": {"<3-Month U.S. Treasuries": 67.1, "Other Bank Deposits": 14.6},
	"reserve_elevated_risk_pct": 0,
	"reserve_mode": "live-stale",
	"reserve_source": "circle-transparency",
	"reserve_sync_status": "ok",
	"reserve_stale": true,
	"transaction_amount_usd": 1000000,
	"capacity_multiple": 5152,
	"data_age_seconds": 8833,
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
		"redemption_available": false, "route_family": null, "access_model": null,
		"settlement_model": null, "route_status": null, "capacity_multiple": null,
		"route_score": null, "capacity_confidence": null,
	})
	"redemption_unavailable" in pharos_redemption_backing.deny with data.params as default_params with data.wasm as d
	not pharos_redemption_backing.allow with data.params as default_params with data.wasm as d
}

test_allow_no_redemption_when_not_required if {
	p := object.union(default_params, {"require_redemption_available": false})
	d := with_data({
		"redemption_available": false, "route_family": null, "access_model": null,
		"settlement_model": null, "route_status": null, "capacity_multiple": null,
		"route_score": null, "capacity_confidence": null,
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
}

test_deny_unapproved_settlement_model if {
	d := with_data({"settlement_model": "t-plus-five"})
	"unapproved_settlement_model" in pharos_redemption_backing.deny with data.params as default_params with data.wasm as d
}

# Pharos reports "open" for a working route. A curator who configures "active"
# — the intuitive guess — would deny every healthy asset, so this pins it.
test_deny_route_status_not_approved if {
	d := with_data({"route_status": "impaired"})
	"route_status_not_approved" in pharos_redemption_backing.deny with data.params as default_params with data.wasm as d
	not pharos_redemption_backing.allow with data.params as default_params with data.wasm as d
}

test_open_status_is_the_healthy_value if {
	wrong := object.union(default_params, {"required_route_status": "active"})
	"route_status_not_approved" in pharos_redemption_backing.deny with data.params as wrong with data.wasm as wrap(clean_data)
}

test_deny_position_exceeds_capacity if {
	d := with_data({"transaction_amount_usd": 4000000000, "capacity_multiple": 1.28})
	"position_exceeds_capacity" in pharos_redemption_backing.deny with data.params as default_params with data.wasm as d
	not pharos_redemption_backing.allow with data.params as default_params with data.wasm as d
}

test_boundary_capacity_exactly_at_min_allows if {
	d := with_data({"capacity_multiple": 2})
	pharos_redemption_backing.allow with data.params as default_params with data.wasm as d
}

test_deny_low_route_score if {
	d := with_data({"route_score": 20})
	"low_route_score" in pharos_redemption_backing.deny with data.params as default_params with data.wasm as d
	not pharos_redemption_backing.allow with data.params as default_params with data.wasm as d
}

test_deny_unapproved_capacity_confidence if {
	d := with_data({"capacity_confidence": "modelled-guess"})
	"unapproved_capacity_confidence" in pharos_redemption_backing.deny with data.params as default_params with data.wasm as d
}

test_empty_capacity_confidence_list_disables_check if {
	p := object.union(default_params, {"approved_capacity_confidence": []})
	d := with_data({"capacity_confidence": "anything-at-all"})
	pharos_redemption_backing.allow with data.params as p with data.wasm as d
}

test_deny_reserve_risk_above_max if {
	d := with_data({"reserve_elevated_risk_pct": 60})
	"reserve_risk_above_max" in pharos_redemption_backing.deny with data.params as default_params with data.wasm as d
	not pharos_redemption_backing.allow with data.params as default_params with data.wasm as d
}

test_deny_stale_data if {
	d := with_data({"data_age_seconds": 200000})
	"stale_data" in pharos_redemption_backing.deny with data.params as default_params with data.wasm as d
	not pharos_redemption_backing.allow with data.params as default_params with data.wasm as d
}

# The live redemption feed lags by hours; a sub-hour ceiling denies healthy
# assets constantly. Pins that the shipped default tolerates real-world lag.
test_real_world_age_passes_default_ceiling if {
	d := with_data({"data_age_seconds": 8833})
	not "stale_data" in pharos_redemption_backing.deny with data.params as default_params with data.wasm as d
}

# A zero position leaves the ratio undefined; it must fail-soft rather than
# reading as "no capacity".
test_zero_amount_fails_soft_on_sizing if {
	d := with_data({"transaction_amount_usd": 0, "capacity_multiple": null})
	not "position_exceeds_capacity" in pharos_redemption_backing.deny with data.params as default_params with data.wasm as d
	pharos_redemption_backing.allow with data.params as default_params with data.wasm as d
}

test_null_optional_fields_fail_soft if {
	d := with_data({
		"route_family": null, "access_model": null, "settlement_model": null,
		"route_status": null, "capacity_multiple": null, "route_score": null,
		"capacity_confidence": null, "reserve_elevated_risk_pct": null,
		"data_age_seconds": null,
	})
	pharos_redemption_backing.allow with data.params as default_params with data.wasm as d
	count(pharos_redemption_backing.deny) == 0 with data.params as default_params with data.wasm as d
}

test_multiple_denies_do_not_fail_open if {
	d := with_data({
		"route_family": "amm-only", "access_model": "whitelist-only",
		"route_status": "suspended", "route_score": 5, "capacity_multiple": 0.2,
	})
	deny := pharos_redemption_backing.deny with data.params as default_params with data.wasm as d
	"unapproved_route_family" in deny
	"unapproved_access_model" in deny
	"route_status_not_approved" in deny
	"low_route_score" in deny
	"position_exceeds_capacity" in deny
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

# --- deny_on_missing_fields --------------------------------------------------

test_missing_data_denies_when_strict if {
	p := object.union(default_params, {"deny_on_missing_fields": ["route_family", "access_model", "settlement_model", "route_status", "capacity_multiple", "route_score", "capacity_confidence", "reserve_elevated_risk_pct", "data_age_seconds"]})
	d := with_data({"capacity_multiple": null})
	"missing_capacity_multiple" in pharos_redemption_backing.deny with data.params as p with data.wasm as d
	not pharos_redemption_backing.allow with data.params as p with data.wasm as d
}

test_missing_data_names_every_null_field if {
	p := object.union(default_params, {"deny_on_missing_fields": ["route_family", "access_model", "settlement_model", "route_status", "capacity_multiple", "route_score", "capacity_confidence", "reserve_elevated_risk_pct", "data_age_seconds"]})
	d := with_data({
		"route_family": null,
		"access_model": null,
		"settlement_model": null,
		"route_status": null,
		"capacity_multiple": null,
		"route_score": null,
		"capacity_confidence": null,
		"reserve_elevated_risk_pct": null,
		"data_age_seconds": null,
	})
	deny := pharos_redemption_backing.deny with data.params as p with data.wasm as d
	"missing_route_family" in deny
	"missing_access_model" in deny
	"missing_settlement_model" in deny
	"missing_route_status" in deny
	"missing_capacity_multiple" in deny
	"missing_route_score" in deny
	"missing_capacity_confidence" in deny
	"missing_reserve_elevated_risk_pct" in deny
	"missing_data_age_seconds" in deny
}

test_populated_fields_are_not_reported_missing if {
	p := object.union(default_params, {"deny_on_missing_fields": ["route_family", "access_model", "settlement_model", "route_status", "capacity_multiple", "route_score", "capacity_confidence", "reserve_elevated_risk_pct", "data_age_seconds"]})
	pharos_redemption_backing.allow with data.params as p with data.wasm as wrap(clean_data)
}

# The regression test for the refactor: an error envelope produces NO denies at
# all, so the groundedness probe in `allow` — not `count(deny) == 0` — is what
# keeps it closed.
test_error_envelope_yields_empty_deny_set_and_no_allow if {
	d := wrap({"error": "oracle failed"})
	count(pharos_redemption_backing.deny) == 0 with data.params as default_params with data.wasm as d
	not pharos_redemption_backing.allow with data.params as default_params with data.wasm as d
}

# --- deny_on_missing_fields is per-field, not all-or-nothing ---------------

test_missing_fields_denies_only_what_was_listed if {
	p := object.union(default_params, {"deny_on_missing_fields": ["route_score"]})
	d := with_data({"route_score": null, "data_age_seconds": null})
	deny := pharos_redemption_backing.deny with data.params as p with data.wasm as d
	"missing_route_score" in deny
	not "missing_data_age_seconds" in deny
	not pharos_redemption_backing.allow with data.params as p with data.wasm as d
}

test_unlisted_null_field_still_passes if {
	p := object.union(default_params, {"deny_on_missing_fields": ["route_score"]})
	d := with_data({"data_age_seconds": null})
	pharos_redemption_backing.allow with data.params as p with data.wasm as d
}
