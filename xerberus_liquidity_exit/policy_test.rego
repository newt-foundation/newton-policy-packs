package xerberus_liquidity_exit_test

import data.xerberus_liquidity_exit
import future.keywords

wsteth := "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0"

default_params := {
	"max_days_to_exit": 7,
	"max_impact_band_pct": 1,
	"deny_on_stale": true,
	"max_data_age_seconds": 86400,
	"require_token_in_intent": false,
}

# The design's live wstETH quote, with the stale flag cleared so the clean
# baseline allows.
clean_data := {
	"token": wsteth,
	"symbol": "wstETH",
	"chain": "ethereum",
	"notional_usd": 1000000,
	"impact_band_pct": 1,
	"max_sale_per_day_usd": 190110.72,
	"days_to_exit": 5.2601,
	"classification": "moderate",
	"cex_status": "no_spot_market",
	"requested_window": "2026-09-20T12:00:00+00:00",
	"data_window": "2026-09-20T12:00:00+00:00",
	"window_honored": true,
	"is_stale": false,
	"data_age_seconds": 3600,
}

default_intent := {
	"from": "0x00000000000000000000000000000000000000a1",
	"to": "0x00000000000000000000000000000000000000b2",
	"value": "0",
	"chain_id": "11155111",
	"function": {"name": "swap"},
	"decoded_function_arguments": [wsteth, "1000000"],
}

wrap(inner) := {"xerberus_liquidity_exit": inner}

with_data(overrides) := wrap(object.union(clean_data, overrides))

denies(d) := ds if {
	ds := xerberus_liquidity_exit.deny with data.params as default_params with data.wasm as d with input as default_intent
}

test_allow_when_clean if {
	d := wrap(clean_data)
	xerberus_liquidity_exit.allow with data.params as default_params with data.wasm as d with input as default_intent
	count(denies(d)) == 0
}

test_deny_stale_data if {
	d := with_data({"is_stale": true})
	"stale_data" in denies(d)
	not xerberus_liquidity_exit.allow with data.params as default_params with data.wasm as d with input as default_intent
}

test_stale_tolerated_when_configured_off if {
	p := object.union(default_params, {"deny_on_stale": false})
	d := with_data({"is_stale": true})
	xerberus_liquidity_exit.allow with data.params as p with data.wasm as d with input as default_intent
}

test_deny_data_too_old if {
	"data_too_old" in denies(with_data({"data_age_seconds": 172800}))
}

test_deny_window_not_honored if {
	"window_not_honored" in denies(with_data({"window_honored": false, "data_window": "2026-09-19T12:00:00+00:00"}))
}

test_unpinned_window_is_not_a_mismatch if {
	d := with_data({"window_honored": null, "requested_window": null})
	not "window_not_honored" in denies(d)
	xerberus_liquidity_exit.allow with data.params as default_params with data.wasm as d with input as default_intent
}

test_deny_exit_too_slow if {
	"exit_too_slow" in denies(with_data({"days_to_exit": 12.5}))
}

test_exit_at_limit_allows if {
	not "exit_too_slow" in denies(with_data({"days_to_exit": 7}))
}

test_deny_impact_band_exceeded if {
	"impact_band_exceeded" in denies(with_data({"impact_band_pct": 2}))
}

test_deny_no_exit_liquidity if {
	"no_exit_liquidity" in denies(with_data({"max_sale_per_day_usd": 0}))
}

test_deny_token_not_in_intent if {
	p := object.union(default_params, {"require_token_in_intent": true})
	i := object.union(default_intent, {"decoded_function_arguments": ["0x00000000000000000000000000000000000000c3"]})
	d := wrap(clean_data)
	"token_not_in_intent" in xerberus_liquidity_exit.deny with data.params as p with data.wasm as d with input as i
}

test_token_bound_via_argument if {
	p := object.union(default_params, {"require_token_in_intent": true})
	d := wrap(clean_data)
	xerberus_liquidity_exit.allow with data.params as p with data.wasm as d with input as default_intent
}

test_token_bound_via_mixed_case_target if {
	p := object.union(default_params, {"require_token_in_intent": true})
	i := object.union(default_intent, {
		"to": "0x7F39C581F595B53C5CB19BD0B3F8DA6C935E2CA0",
		"decoded_function_arguments": [],
	})
	d := wrap(clean_data)
	xerberus_liquidity_exit.allow with data.params as p with data.wasm as d with input as i
}

test_token_bound_inside_tuple_argument if {
	p := object.union(default_params, {"require_token_in_intent": true})
	i := object.union(default_intent, {"decoded_function_arguments": [sprintf("(%v,1000000)", [upper(wsteth)])]})
	d := wrap(clean_data)
	xerberus_liquidity_exit.allow with data.params as p with data.wasm as d with input as i
}

# The design's live result: a fast-enough exit, but stale data.
test_design_live_result_denies_on_staleness_only if {
	d := with_data({"is_stale": true, "data_age_seconds": 3600})
	denies(d) == {"stale_data"}
}

test_multiple_denies_do_not_mask_each_other if {
	d := with_data({"is_stale": true, "days_to_exit": 30, "impact_band_pct": 5})
	denies(d) == {"stale_data", "exit_too_slow", "impact_band_exceeded"}
}

# --- fail closed ---------------------------------------------------------------

test_error_payload_does_not_allow if {
	d := wrap({"error": "xerberus liquidity_exit_quote http 503: unavailable"})
	denies(d) == {"oracle_error"}
	not xerberus_liquidity_exit.allow with data.params as default_params with data.wasm as d with input as default_intent
}

test_unpriced_quote_does_not_allow if {
	d := with_data({"days_to_exit": null})
	"malformed_oracle_output" in denies(d)
	not xerberus_liquidity_exit.allow with data.params as default_params with data.wasm as d with input as default_intent
}

test_missing_freshness_does_not_allow if {
	d := with_data({"data_age_seconds": null})
	not xerberus_liquidity_exit.allow with data.params as default_params with data.wasm as d with input as default_intent
}

test_missing_stale_flag_does_not_allow if {
	d := with_data({"is_stale": null})
	not xerberus_liquidity_exit.allow with data.params as default_params with data.wasm as d with input as default_intent
}
