package vault_risk_rating_test

import data.vault_risk_rating

default_params := {
    "apy_z_max": 4,
    "tvl_drawdown_24h_max_pct": 25,
    "tvl_drawdown_7d_max_pct": 50,
    "risk_score_floor": 60,
    "deny_on_allocation_change": true,
    "deny_on_critical_flag": true,
    "deny_on_corrupted": true,
}

clean_data := {
    "apy_z_score": 0.5,
    "tvl_drawdown_24h_pct": 1,
    "tvl_drawdown_7d_pct": 2,
    "risk_score": 90,
    "has_critical_flag": false,
    "is_corrupted": false,
    "allocation_changed_since_last": false,
}

with_data(overrides) := object.union(clean_data, overrides)

test_allow_when_all_clean if {
    vault_risk_rating.allow with data.params as default_params with data.wasm as clean_data
    count(vault_risk_rating.deny) == 0 with data.params as default_params with data.wasm as clean_data
}

test_deny_apy_spike if {
    d := with_data({"apy_z_score": 5})
    "apy_spike" in vault_risk_rating.deny with data.params as default_params with data.wasm as d
    not vault_risk_rating.allow with data.params as default_params with data.wasm as d
}

test_deny_tvl_drawdown_24h if {
    d := with_data({"tvl_drawdown_24h_pct": 30})
    "tvl_drawdown_24h" in vault_risk_rating.deny with data.params as default_params with data.wasm as d
    not vault_risk_rating.allow with data.params as default_params with data.wasm as d
}

test_deny_tvl_drawdown_7d if {
    d := with_data({"tvl_drawdown_7d_pct": 60})
    "tvl_drawdown_7d" in vault_risk_rating.deny with data.params as default_params with data.wasm as d
    not vault_risk_rating.allow with data.params as default_params with data.wasm as d
}

test_deny_risk_score_below_floor if {
    d := with_data({"risk_score": 30})
    "risk_score_below_floor" in vault_risk_rating.deny with data.params as default_params with data.wasm as d
    not vault_risk_rating.allow with data.params as default_params with data.wasm as d
}

test_risk_score_null_does_not_deny if {
    d := with_data({"risk_score": null})
    not "risk_score_below_floor" in vault_risk_rating.deny with data.params as default_params with data.wasm as d
    vault_risk_rating.allow with data.params as default_params with data.wasm as d
}

test_deny_critical_flag if {
    d := with_data({"has_critical_flag": true})
    "critical_flag" in vault_risk_rating.deny with data.params as default_params with data.wasm as d
    not vault_risk_rating.allow with data.params as default_params with data.wasm as d
}

test_critical_flag_disabled_param if {
    p := object.union(default_params, {"deny_on_critical_flag": false})
    d := with_data({"has_critical_flag": true})
    not "critical_flag" in vault_risk_rating.deny with data.params as p with data.wasm as d
    vault_risk_rating.allow with data.params as p with data.wasm as d
}

test_deny_corrupted if {
    d := with_data({"is_corrupted": true})
    "vault_corrupted" in vault_risk_rating.deny with data.params as default_params with data.wasm as d
    not vault_risk_rating.allow with data.params as default_params with data.wasm as d
}

test_corrupted_disabled_param if {
    p := object.union(default_params, {"deny_on_corrupted": false})
    d := with_data({"is_corrupted": true})
    not "vault_corrupted" in vault_risk_rating.deny with data.params as p with data.wasm as d
    vault_risk_rating.allow with data.params as p with data.wasm as d
}

test_deny_allocation_changed if {
    d := with_data({"allocation_changed_since_last": true})
    "allocation_changed" in vault_risk_rating.deny with data.params as default_params with data.wasm as d
    not vault_risk_rating.allow with data.params as default_params with data.wasm as d
}

test_allocation_changed_disabled_param if {
    p := object.union(default_params, {"deny_on_allocation_change": false})
    d := with_data({"allocation_changed_since_last": true})
    not "allocation_changed" in vault_risk_rating.deny with data.params as p with data.wasm as d
    vault_risk_rating.allow with data.params as p with data.wasm as d
}

# Regression test for the original bug: with single-value `:=` rules, two
# simultaneous denies caused a conflict, deny_reason went undefined, and
# `allow` flipped to true. With the set-based form, both reasons coexist.
test_multiple_denies_do_not_fail_open if {
    d := with_data({"is_corrupted": true, "apy_z_score": 99})
    deny := vault_risk_rating.deny with data.params as default_params with data.wasm as d
    "vault_corrupted" in deny
    "apy_spike" in deny
    count(deny) >= 2
    not vault_risk_rating.allow with data.params as default_params with data.wasm as d
}

# nrt_age_seconds was removed from the rego because policy.js never emitted it,
# so the rule was dead. Guard against accidental re-introduction without a
# matching policy.js change.
test_no_nrt_rule_present if {
    d := object.union(clean_data, {"nrt_age_seconds": 999999})
    p := object.union(default_params, {"nrt_max_age_seconds": 300})
    vault_risk_rating.allow with data.params as p with data.wasm as d
}

test_deny_on_oracle_error if {
    not vault_risk_rating.allow with data.params as default_params with data.wasm as {"error": "oracle failed"}
}

test_deny_on_empty_payload if {
    not vault_risk_rating.allow with data.params as default_params with data.wasm as {}
}
