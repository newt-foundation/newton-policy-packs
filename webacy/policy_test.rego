package webacy_depeg_risk_test

import data.webacy_depeg_risk

default_params := {
    "deny_on_collapsed": true,
    "max_recent_depeg_events": 0,
    "max_consecutive_days_below_peg": 1,
    "deny_on_stale_data": true,
    "max_abs_dev_pct": 0.005,
}

clean_data := {
    "address": "0x0000000000000000000000000000000000000001",
    "chain": "eth",
    "symbol": "USDT",
    "is_collapsed": false,
    "lookback_hours": 168,
    "recent_depeg_event_count": 0,
    "max_recent_deviation_pct": 0,
    "consecutive_days_below_peg": 0,
    "within_expected_range": true,
    "abs_dev_clean": 0.001,
    "stale": false,
}

with_data(overrides) := object.union(clean_data, overrides)

test_allow_when_all_clean if {
    webacy_depeg_risk.allow with data.params as default_params with data.wasm as clean_data
    count(webacy_depeg_risk.deny) == 0 with data.params as default_params with data.wasm as clean_data
}

test_deny_token_collapsed if {
    d := with_data({"is_collapsed": true})
    "token_collapsed" in webacy_depeg_risk.deny with data.params as default_params with data.wasm as d
    not webacy_depeg_risk.allow with data.params as default_params with data.wasm as d
}

test_collapsed_disabled_param if {
    p := object.union(default_params, {"deny_on_collapsed": false})
    d := with_data({"is_collapsed": true})
    not "token_collapsed" in webacy_depeg_risk.deny with data.params as p with data.wasm as d
    webacy_depeg_risk.allow with data.params as p with data.wasm as d
}

test_deny_recent_depeg_events if {
    d := with_data({"recent_depeg_event_count": 2})
    "recent_depeg_events" in webacy_depeg_risk.deny with data.params as default_params with data.wasm as d
    not webacy_depeg_risk.allow with data.params as default_params with data.wasm as d
}

test_recent_events_within_threshold_allowed if {
    p := object.union(default_params, {"max_recent_depeg_events": 3})
    d := with_data({"recent_depeg_event_count": 3})
    not "recent_depeg_events" in webacy_depeg_risk.deny with data.params as p with data.wasm as d
    webacy_depeg_risk.allow with data.params as p with data.wasm as d
}

test_deny_consecutive_days_below_peg if {
    d := with_data({"consecutive_days_below_peg": 5})
    "consecutive_days_below_peg" in webacy_depeg_risk.deny with data.params as default_params with data.wasm as d
    not webacy_depeg_risk.allow with data.params as default_params with data.wasm as d
}

test_streak_within_threshold_allowed if {
    d := with_data({"consecutive_days_below_peg": 1})
    not "consecutive_days_below_peg" in webacy_depeg_risk.deny with data.params as default_params with data.wasm as d
    webacy_depeg_risk.allow with data.params as default_params with data.wasm as d
}

test_deny_stale_oracle_data if {
    d := with_data({"stale": true})
    "stale_oracle_data" in webacy_depeg_risk.deny with data.params as default_params with data.wasm as d
    not webacy_depeg_risk.allow with data.params as default_params with data.wasm as d
}

test_stale_disabled_param if {
    p := object.union(default_params, {"deny_on_stale_data": false})
    d := with_data({"stale": true})
    not "stale_oracle_data" in webacy_depeg_risk.deny with data.params as p with data.wasm as d
    webacy_depeg_risk.allow with data.params as p with data.wasm as d
}

test_multiple_denies_do_not_fail_open if {
    d := with_data({
        "is_collapsed": true,
        "recent_depeg_event_count": 5,
        "consecutive_days_below_peg": 10,
        "stale": true,
        "within_expected_range": false,
        "abs_dev_clean": 0.05,
    })
    deny := webacy_depeg_risk.deny with data.params as default_params with data.wasm as d
    "token_collapsed" in deny
    "recent_depeg_events" in deny
    "consecutive_days_below_peg" in deny
    "stale_oracle_data" in deny
    "outside_expected_range" in deny
    "abs_dev_above_max" in deny
    count(deny) >= 6
    not webacy_depeg_risk.allow with data.params as default_params with data.wasm as d
}

test_deny_on_oracle_error if {
    not webacy_depeg_risk.allow with data.params as default_params with data.wasm as {"error": "oracle failed"}
}

test_deny_on_empty_payload if {
    not webacy_depeg_risk.allow with data.params as default_params with data.wasm as {}
}

test_deny_outside_expected_range if {
    d := with_data({"within_expected_range": false})
    "outside_expected_range" in webacy_depeg_risk.deny with data.params as default_params with data.wasm as d
    not webacy_depeg_risk.allow with data.params as default_params with data.wasm as d
}

test_deny_abs_dev_above_max if {
    d := with_data({"abs_dev_clean": 0.01})
    "abs_dev_above_max" in webacy_depeg_risk.deny with data.params as default_params with data.wasm as d
    not webacy_depeg_risk.allow with data.params as default_params with data.wasm as d
}

test_abs_dev_null_does_not_deny if {
    d := with_data({"abs_dev_clean": null})
    not "abs_dev_above_max" in webacy_depeg_risk.deny with data.params as default_params with data.wasm as d
    webacy_depeg_risk.allow with data.params as default_params with data.wasm as d
}
