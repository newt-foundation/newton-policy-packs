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

allow if count(deny) == 0
