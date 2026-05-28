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

allow if count(deny) == 0
