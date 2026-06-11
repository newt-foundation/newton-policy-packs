package blockaid_tx_safety

import future.keywords

default allow := false

t := data.params
v := data.wasm

deny contains "blockaid_malicious" if v.classification == "Malicious"

deny contains "simulation_failed" if not v.simulation_succeeded

deny contains sprintf("blockaid_feature:%s", [f]) if {
    v.classification == "Warning"
    some f in v.features
    f in t.deny_features
}

deny contains "no_shares_received" if {
    t.require_received_shares
    not v.received_shares
}

deny contains "value_skim" if {
    v.outbound_inbound_ratio != null
    v.outbound_inbound_ratio > t.max_outbound_inbound_ratio
}

allow if {
    v.classification != "Malicious"
    v.simulation_succeeded
    not warning_with_blocked_feature
    not shares_required_but_missing
    ratio_ok
}

warning_with_blocked_feature if {
    v.classification == "Warning"
    some f in v.features
    f in t.deny_features
}

shares_required_but_missing if {
    t.require_received_shares
    not v.received_shares
}

ratio_ok if v.outbound_inbound_ratio == null
ratio_ok if v.outbound_inbound_ratio <= t.max_outbound_inbound_ratio
