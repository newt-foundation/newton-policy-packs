package pharos_treasury_risk_test

import data.pharos_treasury_risk
import future.keywords

default_params := {
	"deny_on_active_depeg": true,
	"max_peg_deviation_bps": 50,
	"max_stress_score": 40,
	"require_redemption": true,
	"approved_redemption_route_families": ["offchain-issuer", "authorised-participant"],
	"approved_access_models": ["issuer-api", "permissionless"],
	"required_route_status": "open",
	"min_exit_capacity_multiple": 3,
	"min_liquidity_score": 60,
	"max_data_age_seconds": 21600,
}

# A healthy, deeply liquid, directly redeemable stablecoin — $1M position
# against $50M of exit capacity.
clean_data := {
	"stablecoin_id": "usdc-circle",
	"symbol": "USDC",
	"issuer": "circle",
	"contract_address": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
	"price": 1,
	"peg_target": 1,
	"peg_deviation_bps": 0,
	"depeg_active": false,
	"depeg_severity": null,
	"depeg_direction": null,
	"depeg_pending_count": 0,
	"supply": 73905912414,
	"market_cap_usd": 73902401514,
	"chain_count": 26,
	"stress_score": 13,
	"stress_band": "calm",
	"stress_signals": {"supply": 0.22, "pool": 32.4, "liq": 34.4, "flow": 22.8, "yield": 30},
	"active_stress_indicators": [],
	"liquidity_score": 76,
	"effective_tvl_usd": 1080490286,
	"exit_capacity_usd": 25000000,
	"pool_count": 2362,
	"liquidity_concentration": 0.0171,
	"durability_score": 81,
	"redemption_available": true,
	"redemption_route_family": "offchain-issuer",
	"redemption_access_model": "issuer-api",
	"redemption_route_status": "open",
	"redemption_score": 63,
	"immediate_capacity_usd": 5152335530,
	"transaction_amount_usd": 1000000,
	"exit_capacity_multiple": 25,
	"data_age_seconds": 8346,
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
	d := with_data({"stress_score": 78, "stress_band": "elevated", "active_stress_indicators": ["liq", "pool"]})
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
	"route_status_not_approved" in pharos_treasury_risk.deny with data.params as default_params with data.wasm as d
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
	d := with_data({"data_age_seconds": 200000})
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
	"route_status_not_approved" in deny
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

# The redemption feed lags by hours; a sub-hour ceiling would deny healthy
# assets constantly. Pins that the shipped default tolerates real-world lag.
test_real_world_age_passes_default_ceiling if {
	d := with_data({"data_age_seconds": 8346})
	not "stale_data" in pharos_treasury_risk.deny with data.params as default_params with data.wasm as d
	pharos_treasury_risk.allow with data.params as default_params with data.wasm as d
}

# Pharos reports "open", not "active". A curator guessing "active" denies
# every healthy asset — pin the trap so it is visible.
test_active_status_guess_denies_everything if {
	wrong := object.union(default_params, {"required_route_status": "active"})
	"route_status_not_approved" in pharos_treasury_risk.deny with data.params as wrong with data.wasm as wrap(clean_data)
}
