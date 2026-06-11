package blockaid_tx_safety_test

import data.blockaid_tx_safety

default_params := {
    "deny_features": ["unbounded_approval", "honeypot", "phishing"],
    "max_outbound_inbound_ratio": 1.05,
    "require_received_shares": true,
}

clean_data := {
    "classification": "Benign",
    "features": [],
    "expected_inbound_value_usd": 1000,
    "expected_outbound_value_usd": 1000,
    "outbound_inbound_ratio": 1.0,
    "received_shares": true,
    "simulation_succeeded": true,
}

with_data(overrides) := object.union(clean_data, overrides)

test_allow_when_all_clean if {
    blockaid_tx_safety.allow with data.params as default_params with data.wasm as clean_data
    count(blockaid_tx_safety.deny) == 0 with data.params as default_params with data.wasm as clean_data
}

test_deny_blockaid_malicious if {
    d := with_data({"classification": "Malicious"})
    "blockaid_malicious" in blockaid_tx_safety.deny with data.params as default_params with data.wasm as d
    not blockaid_tx_safety.allow with data.params as default_params with data.wasm as d
}

test_deny_simulation_failed if {
    d := with_data({"simulation_succeeded": false})
    "simulation_failed" in blockaid_tx_safety.deny with data.params as default_params with data.wasm as d
    not blockaid_tx_safety.allow with data.params as default_params with data.wasm as d
}

test_deny_warning_with_blocked_feature if {
    d := with_data({"classification": "Warning", "features": ["unbounded_approval", "verified_contract"]})
    "blockaid_feature:unbounded_approval" in blockaid_tx_safety.deny with data.params as default_params with data.wasm as d
    not blockaid_tx_safety.allow with data.params as default_params with data.wasm as d
}

test_warning_with_only_safe_features_allowed if {
    d := with_data({"classification": "Warning", "features": ["verified_contract"]})
    blockaid_tx_safety.allow with data.params as default_params with data.wasm as d
}

test_deny_no_shares_received if {
    d := with_data({"received_shares": false})
    "no_shares_received" in blockaid_tx_safety.deny with data.params as default_params with data.wasm as d
    not blockaid_tx_safety.allow with data.params as default_params with data.wasm as d
}

test_no_shares_required_disabled_param if {
    p := object.union(default_params, {"require_received_shares": false})
    d := with_data({"received_shares": false})
    not "no_shares_received" in blockaid_tx_safety.deny with data.params as p with data.wasm as d
    blockaid_tx_safety.allow with data.params as p with data.wasm as d
}

test_deny_value_skim if {
    d := with_data({"outbound_inbound_ratio": 1.5, "expected_outbound_value_usd": 1500})
    "value_skim" in blockaid_tx_safety.deny with data.params as default_params with data.wasm as d
    not blockaid_tx_safety.allow with data.params as default_params with data.wasm as d
}

test_value_skim_null_ratio_does_not_deny if {
    d := with_data({"outbound_inbound_ratio": null, "expected_inbound_value_usd": 0})
    not "value_skim" in blockaid_tx_safety.deny with data.params as default_params with data.wasm as d
}

test_multiple_denies_do_not_fail_open if {
    d := with_data({
        "classification": "Malicious",
        "simulation_succeeded": false,
        "received_shares": false,
        "outbound_inbound_ratio": 2.0,
    })
    deny := blockaid_tx_safety.deny with data.params as default_params with data.wasm as d
    "blockaid_malicious" in deny
    "simulation_failed" in deny
    "no_shares_received" in deny
    "value_skim" in deny
    count(deny) >= 4
    not blockaid_tx_safety.allow with data.params as default_params with data.wasm as d
}

test_deny_on_oracle_error if {
    not blockaid_tx_safety.allow with data.params as default_params with data.wasm as {"error": "oracle failed"}
}

test_deny_on_empty_payload if {
    not blockaid_tx_safety.allow with data.params as default_params with data.wasm as {}
}
