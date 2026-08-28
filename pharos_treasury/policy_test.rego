package pharos_treasury_risk_test

import data.pharos_treasury_risk
import future.keywords

default_params := {
	"deny_on_active_depeg": true,
	"max_peg_deviation_bps": 50,
	"max_stress_score": 40,
	"require_redemption": true,
	"approved_redemption_route_families": ["issuer-direct", "authorised-participant"],
	"approved_access_models": ["permissionless", "kyc-gated"],
	"min_exit_capacity_multiple": 3,
	"min_liquidity_score": 60,
	"max_data_age_seconds": 900,
}

# A healthy, deeply liquid, directly redeemable stablecoin — $1M position
# against $50M of exit capacity.
clean_data := {
	"stablecoin_id": "usdc-circle",
	"symbol": "USDC",
	"issuer": "Circle",
	"price": 1.0002,
	"peg_target": 1,
	"peg_deviation_bps": 2,
	"depeg_active": false,
	"depeg_severity": null,
	"depeg_direction": null,
	"supply": 60000000000,
	"market_cap_usd": 60000000000,
	"chains": ["ethereum", "base", "arbitrum"],
	"stress_score": 8,
	"stress_band": "calm",
	"active_stress_indicators": [],
	"liquidity_score": 94,
	"effective_tvl_usd": 850000000,
	"exit_capacity_usd": 50000000,
	"pool_count": 142,
	"chain_count": 3,
	"liquidity_concentration": 0.18,
	"redemption_available": true,
	"redemption_route_family": "issuer-direct",
	"redemption_access_model": "kyc-gated",
	"redemption_route_status": "active",
	"daily_limit_usd": 1000000000,
	"immediate_capacity_usd": 250000000,
	"transaction_amount_usd": 1000000,
	"exit_capacity_multiple": 50,
	"data_age_seconds": 45,
}

wrap(inner) := {"pharos_treasury": inner}

with_data(overrides) := wrap(object.union(clean_data, overrides))

test_allow_when_healthy if {
	d := wrap(clean_data)
	pharos_treasury_risk.allow with data.params as default_params with data.wasm as d
	count(pharos_treasury_risk.deny) == 0 with data.params as default_params with data.wasm as d
}

test_deny_active_depeg if {
	d := with_data({"depeg_active": true, "depeg_severity": "severe", "depeg_direction": "below"})
	"active_depeg" in pharos_treasury_risk.deny with data.params as default_params with data.wasm as d
	not pharos_treasury_risk.allow with data.params as default_params with data.wasm as d
}

test_deny_peg_deviation_above_max if {
	d := with_data({"peg_deviation_bps": 180, "price": 1.018})
	"peg_deviation_above_max" in pharos_treasury_risk.deny with data.params as default_params with data.wasm as d
	not pharos_treasury_risk.allow with data.params as default_params with data.wasm as d
}

# Deviation is signed, so a drop below peg must trip the same threshold as
# a rise above it. This is the case a naive unsigned comparison misses.
test_deny_negative_peg_deviation_below_peg if {
	d := with_data({"peg_deviation_bps": -180, "price": 0.982})
	"peg_deviation_above_max" in pharos_treasury_risk.deny with data.params as default_params with data.wasm as d
	not pharos_treasury_risk.allow with data.params as default_params with data.wasm as d
}

test_small_negative_deviation_still_allows if {
	d := with_data({"peg_deviation_bps": -12})
	pharos_treasury_risk.allow with data.params as default_params with data.wasm as d
}

test_deny_stress_above_max if {
	d := with_data({"stress_score": 78, "stress_band": "elevated", "active_stress_indicators": ["liquidity_drain", "mint_burn_anomaly"]})
	"stress_above_max" in pharos_treasury_risk.deny with data.params as default_params with data.wasm as d
	not pharos_treasury_risk.allow with data.params as default_params with data.wasm as d
}

test_deny_redemption_unavailable if {
	d := with_data({
		"redemption_available": false,
		"redemption_route_family": null,
		"redemption_access_model": null,
		"redemption_route_status": null,
	})
	"redemption_unavailable" in pharos_treasury_risk.deny with data.params as default_params with data.wasm as d
	not pharos_treasury_risk.allow with data.params as default_params with data.wasm as d
}

test_allow_no_redemption_when_not_required if {
	p := object.union(default_params, {"require_redemption": false})
	d := with_data({
		"redemption_available": false,
		"redemption_route_family": null,
		"redemption_access_model": null,
		"redemption_route_status": null,
	})
	pharos_treasury_risk.allow with data.params as p with data.wasm as d
	count(pharos_treasury_risk.deny) == 0 with data.params as p with data.wasm as d
}

test_deny_unapproved_redemption_route if {
	d := with_data({"redemption_route_family": "amm-only"})
	"unapproved_redemption_route" in pharos_treasury_risk.deny with data.params as default_params with data.wasm as d
	not pharos_treasury_risk.allow with data.params as default_params with data.wasm as d
}

test_deny_unapproved_access_model if {
	d := with_data({"redemption_access_model": "whitelist-only"})
	"unapproved_access_model" in pharos_treasury_risk.deny with data.params as default_params with data.wasm as d
	not pharos_treasury_risk.allow with data.params as default_params with data.wasm as d
}

test_deny_route_status_impaired if {
	d := with_data({"redemption_route_status": "impaired"})
	"route_status_impaired" in pharos_treasury_risk.deny with data.params as default_params with data.wasm as d
	not pharos_treasury_risk.allow with data.params as default_params with data.wasm as d
}

# The differentiated Pharos check: price is fine, but the position cannot
# realistically be exited.
test_deny_insufficient_exit_capacity if {
	d := with_data({"exit_capacity_usd": 1500000, "transaction_amount_usd": 1000000, "exit_capacity_multiple": 1.5})
	"insufficient_exit_capacity" in pharos_treasury_risk.deny with data.params as default_params with data.wasm as d
	not pharos_treasury_risk.allow with data.params as default_params with data.wasm as d
}

test_boundary_exit_capacity_exactly_at_min_allows if {
	d := with_data({"exit_capacity_multiple": 3})
	pharos_treasury_risk.allow with data.params as default_params with data.wasm as d
}

test_deny_liquidity_score_below_min if {
	d := with_data({"liquidity_score": 22})
	"liquidity_score_below_min" in pharos_treasury_risk.deny with data.params as default_params with data.wasm as d
	not pharos_treasury_risk.allow with data.params as default_params with data.wasm as d
}

test_deny_stale_data if {
	d := with_data({"data_age_seconds": 7200})
	"stale_data" in pharos_treasury_risk.deny with data.params as default_params with data.wasm as d
	not pharos_treasury_risk.allow with data.params as default_params with data.wasm as d
}

# A caller who passes no amount leaves the ratio undefined; that must
# fail-soft rather than fabricating a passing or failing multiple.
test_null_exit_capacity_multiple_fails_soft if {
	d := with_data({"transaction_amount_usd": 0, "exit_capacity_multiple": null})
	pharos_treasury_risk.allow with data.params as default_params with data.wasm as d
	count(pharos_treasury_risk.deny) == 0 with data.params as default_params with data.wasm as d
}

test_null_optional_fields_fail_soft if {
	d := with_data({
		"stress_score": null,
		"stress_band": null,
		"liquidity_score": null,
		"exit_capacity_multiple": null,
		"data_age_seconds": null,
	})
	pharos_treasury_risk.allow with data.params as default_params with data.wasm as d
	count(pharos_treasury_risk.deny) == 0 with data.params as default_params with data.wasm as d
}

# A stressed asset typically trips several rules at once; none may fail open.
test_stressed_asset_multiple_denies if {
	d := with_data({
		"depeg_active": true,
		"peg_deviation_bps": -350,
		"stress_score": 91,
		"liquidity_score": 11,
		"exit_capacity_multiple": 0.4,
		"redemption_route_status": "impaired",
	})
	deny := pharos_treasury_risk.deny with data.params as default_params with data.wasm as d
	"active_depeg" in deny
	"peg_deviation_above_max" in deny
	"stress_above_max" in deny
	"liquidity_score_below_min" in deny
	"insufficient_exit_capacity" in deny
	"route_status_impaired" in deny
	count(deny) >= 6
	not pharos_treasury_risk.allow with data.params as default_params with data.wasm as d
}

test_deny_on_oracle_error if {
	not pharos_treasury_risk.allow with data.params as default_params with data.wasm as wrap({"error": "oracle failed"})
}

test_deny_on_empty_payload if {
	not pharos_treasury_risk.allow with data.params as default_params with data.wasm as wrap({})
}

test_missing_groundedness_field_does_not_allow if {
	d := wrap(object.remove(clean_data, {"depeg_active"}))
	not pharos_treasury_risk.allow with data.params as default_params with data.wasm as d
	count(pharos_treasury_risk.deny) == 0 with data.params as default_params with data.wasm as d
}
