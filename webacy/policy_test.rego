package webacy_depositor_reputation_test

import data.webacy_depositor_reputation

default_params := {
    "deny_on_sanctioned": true,
    "deny_on_high_risk": true,
    "exploit_exposure_hits_max": 1,
    "medium_risk_max_deposit_usd": 10000,
}

clean_data := {
    "bucket": "low",
    "dd_score": 5,
    "sanctions_hits": 0,
    "exploit_exposure_hits": 0,
}

clean_intent := {"deposit_amount_usd": 1000}

with_data(overrides) := object.union(clean_data, overrides)
with_intent(overrides) := object.union(clean_intent, overrides)

test_allow_when_all_clean if {
    webacy_depositor_reputation.allow with data.params as default_params with data.wasm as clean_data with input as clean_intent
    count(webacy_depositor_reputation.deny) == 0 with data.params as default_params with data.wasm as clean_data with input as clean_intent
}

test_deny_sanctioned if {
    d := with_data({"bucket": "sanctioned", "sanctions_hits": 1})
    "sanctioned" in webacy_depositor_reputation.deny with data.params as default_params with data.wasm as d with input as clean_intent
    not webacy_depositor_reputation.allow with data.params as default_params with data.wasm as d with input as clean_intent
}

test_sanctioned_disabled_param if {
    p := object.union(default_params, {"deny_on_sanctioned": false})
    d := with_data({"bucket": "sanctioned", "sanctions_hits": 1})
    not "sanctioned" in webacy_depositor_reputation.deny with data.params as p with data.wasm as d with input as clean_intent
    webacy_depositor_reputation.allow with data.params as p with data.wasm as d with input as clean_intent
}

test_deny_high_risk if {
    d := with_data({"bucket": "high", "dd_score": 75})
    "high_risk" in webacy_depositor_reputation.deny with data.params as default_params with data.wasm as d with input as clean_intent
    not webacy_depositor_reputation.allow with data.params as default_params with data.wasm as d with input as clean_intent
}

test_high_risk_disabled_param if {
    p := object.union(default_params, {"deny_on_high_risk": false})
    d := with_data({"bucket": "high", "dd_score": 75})
    not "high_risk" in webacy_depositor_reputation.deny with data.params as p with data.wasm as d with input as clean_intent
    webacy_depositor_reputation.allow with data.params as p with data.wasm as d with input as clean_intent
}

test_deny_exploit_exposure if {
    d := with_data({"exploit_exposure_hits": 2})
    "exploit_exposure" in webacy_depositor_reputation.deny with data.params as default_params with data.wasm as d with input as clean_intent
    not webacy_depositor_reputation.allow with data.params as default_params with data.wasm as d with input as clean_intent
}

test_deny_medium_risk_over_cap if {
    d := with_data({"bucket": "medium", "dd_score": 30})
    i := with_intent({"deposit_amount_usd": 50000})
    "medium_risk_over_cap" in webacy_depositor_reputation.deny with data.params as default_params with data.wasm as d with input as i
    not webacy_depositor_reputation.allow with data.params as default_params with data.wasm as d with input as i
}

test_medium_risk_under_cap_allowed if {
    d := with_data({"bucket": "medium", "dd_score": 30})
    i := with_intent({"deposit_amount_usd": 5000})
    not "medium_risk_over_cap" in webacy_depositor_reputation.deny with data.params as default_params with data.wasm as d with input as i
    webacy_depositor_reputation.allow with data.params as default_params with data.wasm as d with input as i
}

test_multiple_denies_do_not_fail_open if {
    d := with_data({
        "bucket": "sanctioned",
        "sanctions_hits": 1,
        "exploit_exposure_hits": 5,
    })
    deny := webacy_depositor_reputation.deny with data.params as default_params with data.wasm as d with input as clean_intent
    "sanctioned" in deny
    "exploit_exposure" in deny
    count(deny) >= 2
    not webacy_depositor_reputation.allow with data.params as default_params with data.wasm as d with input as clean_intent
}

test_deny_on_oracle_error if {
    not webacy_depositor_reputation.allow with data.params as default_params with data.wasm as {"error": "oracle failed"} with input as clean_intent
}

test_deny_on_empty_payload if {
    not webacy_depositor_reputation.allow with data.params as default_params with data.wasm as {} with input as clean_intent
}
