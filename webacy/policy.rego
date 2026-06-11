package webacy_depositor_reputation

import future.keywords

default allow := false

t := data.params
v := data.wasm

deny contains "sanctioned" if {
    t.deny_on_sanctioned
    v.bucket == "sanctioned"
}

deny contains "high_risk" if {
    t.deny_on_high_risk
    v.bucket == "high"
}

deny contains "exploit_exposure" if v.exploit_exposure_hits >= t.exploit_exposure_hits_max

deny contains "medium_risk_over_cap" if {
    v.bucket == "medium"
    input.deposit_amount_usd > t.medium_risk_max_deposit_usd
}

allow if {
    not sanctioned_blocks
    not high_risk_blocks
    v.exploit_exposure_hits < t.exploit_exposure_hits_max
    not medium_risk_over_cap_blocks
}

sanctioned_blocks if {
    t.deny_on_sanctioned
    v.bucket == "sanctioned"
}

high_risk_blocks if {
    t.deny_on_high_risk
    v.bucket == "high"
}

medium_risk_over_cap_blocks if {
    v.bucket == "medium"
    input.deposit_amount_usd > t.medium_risk_max_deposit_usd
}
