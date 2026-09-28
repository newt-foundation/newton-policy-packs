package xerberus_portfolio_what_if_test

import data.xerberus_portfolio_what_if
import future.keywords

treasury := "0xac0168b4fd7427bfd616e3a47fc05dd8175d5b64"

wsteth := "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0"

default_params := {
	"max_post_token_share_pct": 50,
	"max_hhi_delta": 0.01,
	"min_ladder_30d_delta_pp": -3,
	"max_slowest_exit_delta_days": 3,
	"deny_on_issues": true,
	"deny_on_stale": true,
	"max_data_age_seconds": 86400,
	"require_intent_party_in_wallets": false,
	"allow_stale_when_risk_reducing": false,
}

# A small, diversifying acquisition that passes every limit.
clean_data := {
	"wallets": [treasury],
	"chain": "ethereum",
	"add": [{"token": wsteth, "usd": 100000}],
	"remove": [],
	"is_risk_reducing": false,
	"book_usd_before": 17770000,
	"book_usd_after": 17870000,
	"post_largest_token": "wstETH",
	"post_largest_token_pct": 41.2,
	"pre_largest_token_pct": 40.9,
	"hhi_before": 0.3,
	"hhi_after": 0.302,
	"hhi_delta": 0.002,
	"ladder_30d_before_pct": 81.17,
	"ladder_30d_after_pct": 80.9,
	"ladder_30d_delta_pp": -0.27,
	"slowest_exit_days_before": 47.59,
	"slowest_exit_days_after": 47.9,
	"slowest_exit_delta_days": 0.31,
	"issues": [],
	"issues_count": 0,
	"requested_window": "2026-09-20T12:00:00+00:00",
	"data_window": "2026-09-20T12:00:00+00:00",
	"window_honored": true,
	"is_stale": false,
	"data_age_seconds": 3600,
}

# The design's live $1M wstETH what-if result.
design_live_result := object.union(clean_data, {
	"add": [{"token": wsteth, "usd": 1000000}],
	"book_usd_after": 18770000,
	"post_largest_token_pct": 53.5,
	"pre_largest_token_pct": 50.9,
	"hhi_before": 0.3988,
	"hhi_after": 0.4116,
	"hhi_delta": 0.0128,
	"ladder_30d_after_pct": 76.85,
	"ladder_30d_delta_pp": -4.32,
	"slowest_exit_days_after": 52.85,
	"slowest_exit_delta_days": 5.26,
	"is_stale": true,
})

default_intent := {
	"from": "0x00000000000000000000000000000000000000a1",
	"to": treasury,
	"value": "0",
	"chain_id": "11155111",
	"function": {"name": "swap"},
	"decoded_function_arguments": [],
}

wrap(inner) := {"xerberus_what_if": inner}

with_data(overrides) := wrap(object.union(clean_data, overrides))

denies(d) := ds if {
	ds := xerberus_portfolio_what_if.deny with data.params as default_params with data.wasm as d with input as default_intent
}

allows(d, p) if {
	xerberus_portfolio_what_if.allow with data.params as p with data.wasm as d with input as default_intent
}

test_allow_when_clean if {
	d := wrap(clean_data)
	allows(d, default_params)
	count(denies(d)) == 0
}

test_design_live_result_denies_on_every_portfolio_limit if {
	denies(wrap(design_live_result)) == {
		"stale_data",
		"concentration_limit",
		"hhi_delta_limit",
		"liquidity_30d_deterioration",
		"slowest_exit_limit",
	}
}

test_deny_concentration_limit if {
	"concentration_limit" in denies(with_data({"post_largest_token_pct": 53.5, "pre_largest_token_pct": 50.9}))
}

test_concentration_reduction_is_not_blocked if {
	d := with_data({"post_largest_token_pct": 55, "pre_largest_token_pct": 58})
	not "concentration_limit" in denies(d)
}

test_deny_hhi_delta_limit if {
	"hhi_delta_limit" in denies(with_data({"hhi_delta": 0.0128}))
}

test_deny_liquidity_30d_deterioration if {
	"liquidity_30d_deterioration" in denies(with_data({"ladder_30d_delta_pp": -4.32}))
}

test_liquidity_at_limit_allows if {
	not "liquidity_30d_deterioration" in denies(with_data({"ladder_30d_delta_pp": -3}))
}

test_deny_slowest_exit_limit if {
	"slowest_exit_limit" in denies(with_data({"slowest_exit_delta_days": 5.26}))
}

test_deny_simulation_issues if {
	"simulation_issues" in denies(with_data({"issues": ["unpriced token: FOO"], "issues_count": 1}))
}

test_issues_tolerated_when_configured_off if {
	p := object.union(default_params, {"deny_on_issues": false})
	allows(with_data({"issues": ["unpriced token: FOO"], "issues_count": 1}), p)
}

test_deny_stale_data if {
	"stale_data" in denies(with_data({"is_stale": true}))
}

test_deny_data_too_old if {
	"data_too_old" in denies(with_data({"data_age_seconds": 172800}))
}

test_deny_window_not_honored if {
	"window_not_honored" in denies(with_data({"window_honored": false}))
}

# --- risk-reducing path --------------------------------------------------------

risk_reducing := {
	"add": [],
	"remove": [{"token": wsteth, "usd": 1000000}],
	"is_risk_reducing": true,
	"post_largest_token_pct": 48.2,
	"pre_largest_token_pct": 50.9,
	"hhi_delta": -0.011,
	"ladder_30d_delta_pp": 2.1,
	"slowest_exit_delta_days": -1.5,
	"is_stale": true,
	"data_age_seconds": 172800,
}

test_stale_risk_reducing_allowed_when_opted_in if {
	p := object.union(default_params, {"allow_stale_when_risk_reducing": true})
	allows(with_data(risk_reducing), p)
}

test_stale_risk_reducing_denied_by_default if {
	d := with_data(risk_reducing)
	denies(d) == {"stale_data", "data_too_old"}
}

test_stale_exemption_never_covers_additions if {
	p := object.union(default_params, {"allow_stale_when_risk_reducing": true})
	d := with_data({"is_stale": true})
	"stale_data" in xerberus_portfolio_what_if.deny with data.params as p with data.wasm as d with input as default_intent
}

test_risk_reducing_still_checks_deltas if {
	p := object.union(default_params, {"allow_stale_when_risk_reducing": true})
	d := with_data(object.union(risk_reducing, {"slowest_exit_delta_days": 9}))
	xerberus_portfolio_what_if.deny == {"slowest_exit_limit"} with data.params as p with data.wasm as d with input as default_intent
}

# --- intent binding ------------------------------------------------------------

test_wallets_bound_via_target if {
	p := object.union(default_params, {"require_intent_party_in_wallets": true})
	allows(wrap(clean_data), p)
}

test_wallets_bound_via_mixed_case_sender if {
	p := object.union(default_params, {"require_intent_party_in_wallets": true})
	i := object.union(default_intent, {"from": upper(treasury), "to": "0x00000000000000000000000000000000000000b2"})
	xerberus_portfolio_what_if.allow with data.params as p with data.wasm as wrap(clean_data) with input as i
}

test_deny_wallets_not_bound_to_intent if {
	p := object.union(default_params, {"require_intent_party_in_wallets": true})
	i := object.union(default_intent, {"to": "0x00000000000000000000000000000000000000b2"})
	"wallets_not_bound_to_intent" in xerberus_portfolio_what_if.deny with data.params as p with data.wasm as wrap(clean_data) with input as i
}

# --- fail closed ---------------------------------------------------------------

test_error_payload_does_not_allow if {
	d := wrap({"error": "xerberus what_if http 429: rate limited"})
	denies(d) == {"oracle_error"}
	not allows(d, default_params)
}

test_missing_delta_does_not_allow if {
	d := with_data({"hhi_delta": null})
	"malformed_oracle_output" in denies(d)
	not allows(d, default_params)
}

test_missing_freshness_does_not_allow if {
	not allows(with_data({"data_age_seconds": null}), default_params)
}
