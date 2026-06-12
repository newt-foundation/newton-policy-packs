package chainalysis_address_screening

import future.keywords

default allow := false

t := data.params
v := data.wasm

deny contains "chainalysis_sanctioned" if {
    t.deny_on_sanctioned
    v.sanctioned
}

deny contains "high_risk_address" if {
    t.deny_on_high_risk_category
    v.is_high_risk
}

deny contains "risk_category_blocklisted" if {
    some cat in v.risk_categories
    cat in t.risk_categories_blocklist
}

allow if {
    is_boolean(v.sanctioned)
    is_boolean(v.is_high_risk)
    is_array(v.risk_categories)
    not sanctioned_blocks
    not high_risk_blocks
    not blocklisted_category_present
}

sanctioned_blocks if {
    t.deny_on_sanctioned
    v.sanctioned
}

high_risk_blocks if {
    t.deny_on_high_risk_category
    v.is_high_risk
}

blocklisted_category_present if {
    some cat in v.risk_categories
    cat in t.risk_categories_blocklist
}
