package balancer_pool_risk_test

import data.balancer_pool_risk

default_params := {
    "max_token_weight_pct": 80,
    "deny_on_underlying_risk": true,
    "min_tvl_usd": 100000,
    "tvl_drawdown_24h_max_pct": 25,
    "tvl_drawdown_7d_max_pct": 50,
}

clean_data := {
    "pool_id": "0x1535d7ca00323aa32bd62aeddf7ca651e4b95966",
    "chain": "MAINNET",
    "pool_type": "WEIGHTED",
    "tvl_usd": 500000,
    "tvl_drawdown_24h_pct": 1,
    "tvl_drawdown_7d_pct": 3,
    "token_count": 2,
    "max_token_weight_pct": 80,
    "non_allowlisted_tokens": [],
    "has_boosted_tokens": false,
    "underlying_protocols": [],
}

with_data(overrides) := object.union(clean_data, overrides)

test_allow_when_all_clean if {
    balancer_pool_risk.allow with data.params as default_params with data.wasm as clean_data
    count(balancer_pool_risk.deny) == 0 with data.params as default_params with data.wasm as clean_data
}

test_deny_token_weight_drift if {
    d := with_data({"max_token_weight_pct": 95})
    "token_weight_drift" in balancer_pool_risk.deny with data.params as default_params with data.wasm as d
    not balancer_pool_risk.allow with data.params as default_params with data.wasm as d
}

test_deny_non_allowlisted_token_in_pool if {
    d := with_data({"non_allowlisted_tokens": ["0xdbdb4d16eda451d0503b854cf79d55697f90c8df"]})
    "non_allowlisted_token_in_pool" in balancer_pool_risk.deny with data.params as default_params with data.wasm as d
    not balancer_pool_risk.allow with data.params as default_params with data.wasm as d
}

test_deny_underlying_protocol_risk if {
    d := with_data({"has_boosted_tokens": true})
    "underlying_protocol_risk" in balancer_pool_risk.deny with data.params as default_params with data.wasm as d
    not balancer_pool_risk.allow with data.params as default_params with data.wasm as d
}

test_underlying_risk_disabled_param if {
    p := object.union(default_params, {"deny_on_underlying_risk": false})
    d := with_data({"has_boosted_tokens": true})
    not "underlying_protocol_risk" in balancer_pool_risk.deny with data.params as p with data.wasm as d
    balancer_pool_risk.allow with data.params as p with data.wasm as d
}

test_deny_tvl_below_floor if {
    d := with_data({"tvl_usd": 50000})
    "tvl_below_floor" in balancer_pool_risk.deny with data.params as default_params with data.wasm as d
    not balancer_pool_risk.allow with data.params as default_params with data.wasm as d
}

test_deny_tvl_drawdown_24h if {
    d := with_data({"tvl_drawdown_24h_pct": 30})
    "tvl_drawdown_24h" in balancer_pool_risk.deny with data.params as default_params with data.wasm as d
    not balancer_pool_risk.allow with data.params as default_params with data.wasm as d
}

test_deny_tvl_drawdown_7d if {
    d := with_data({"tvl_drawdown_7d_pct": 60})
    "tvl_drawdown_7d" in balancer_pool_risk.deny with data.params as default_params with data.wasm as d
    not balancer_pool_risk.allow with data.params as default_params with data.wasm as d
}

test_tvl_drawdown_null_does_not_deny if {
    d := with_data({"tvl_drawdown_24h_pct": null, "tvl_drawdown_7d_pct": null})
    not "tvl_drawdown_24h" in balancer_pool_risk.deny with data.params as default_params with data.wasm as d
    not "tvl_drawdown_7d" in balancer_pool_risk.deny with data.params as default_params with data.wasm as d
    balancer_pool_risk.allow with data.params as default_params with data.wasm as d
}

test_empty_non_allowlisted_array_does_not_deny if {
    d := with_data({"non_allowlisted_tokens": []})
    not "non_allowlisted_token_in_pool" in balancer_pool_risk.deny with data.params as default_params with data.wasm as d
    balancer_pool_risk.allow with data.params as default_params with data.wasm as d
}

test_multiple_denies_do_not_fail_open if {
    d := with_data({
        "max_token_weight_pct": 95,
        "tvl_usd": 50000,
        "tvl_drawdown_24h_pct": 99,
        "has_boosted_tokens": true,
    })
    deny := balancer_pool_risk.deny with data.params as default_params with data.wasm as d
    "token_weight_drift" in deny
    "tvl_below_floor" in deny
    "tvl_drawdown_24h" in deny
    "underlying_protocol_risk" in deny
    count(deny) >= 3
    not balancer_pool_risk.allow with data.params as default_params with data.wasm as d
}
