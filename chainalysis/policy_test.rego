package chainalysis_address_screening_test

import data.chainalysis_address_screening

default_params := {
    "deny_on_sanctioned": true,
    "deny_on_high_risk_category": true,
    "risk_categories_blocklist": ["mixer", "stolen_funds", "ransomware"],
}

clean_data := {
    "sanctioned": false,
    "sanctions_categories": [],
    "screening_available": true,
    "risk_score": "low",
    "risk_categories": [],
    "is_high_risk": false,
}

# Phase 0 § Stream B namespacing: `policy.rego` now reads from
# `data.wasm.chainalysis.<field>`, so test fixtures wrap the inner shape
# under the `chainalysis` key. `wrapping_test.rego` covers the cross-pack
# composition surface; this file keeps the pre-existing rule-by-rule
# coverage intact under the new namespacing.
wrap(inner) := {"chainalysis": inner}

with_data(overrides) := wrap(object.union(clean_data, overrides))

test_allow_when_all_clean if {
    d := wrap(clean_data)
    chainalysis_address_screening.allow with data.params as default_params with data.wasm as d
    count(chainalysis_address_screening.deny) == 0 with data.params as default_params with data.wasm as d
}

test_deny_chainalysis_sanctioned if {
    d := with_data({"sanctioned": true, "sanctions_categories": ["sdn"]})
    "chainalysis_sanctioned" in chainalysis_address_screening.deny with data.params as default_params with data.wasm as d
    not chainalysis_address_screening.allow with data.params as default_params with data.wasm as d
}

test_sanctioned_disabled_param if {
    p := object.union(default_params, {"deny_on_sanctioned": false})
    d := with_data({"sanctioned": true, "sanctions_categories": ["sdn"]})
    not "chainalysis_sanctioned" in chainalysis_address_screening.deny with data.params as p with data.wasm as d
    chainalysis_address_screening.allow with data.params as p with data.wasm as d
}

test_deny_high_risk_address if {
    d := with_data({"is_high_risk": true, "risk_score": "high"})
    "high_risk_address" in chainalysis_address_screening.deny with data.params as default_params with data.wasm as d
    not chainalysis_address_screening.allow with data.params as default_params with data.wasm as d
}

test_high_risk_disabled_param if {
    p := object.union(default_params, {"deny_on_high_risk_category": false})
    d := with_data({"is_high_risk": true, "risk_score": "high"})
    not "high_risk_address" in chainalysis_address_screening.deny with data.params as p with data.wasm as d
    chainalysis_address_screening.allow with data.params as p with data.wasm as d
}

test_deny_risk_category_blocklisted if {
    d := with_data({"risk_categories": ["mixer", "exchange"]})
    "risk_category_blocklisted" in chainalysis_address_screening.deny with data.params as default_params with data.wasm as d
    not chainalysis_address_screening.allow with data.params as default_params with data.wasm as d
}

test_non_blocklisted_categories_do_not_deny if {
    d := with_data({"risk_categories": ["exchange", "defi"]})
    not "risk_category_blocklisted" in chainalysis_address_screening.deny with data.params as default_params with data.wasm as d
    chainalysis_address_screening.allow with data.params as default_params with data.wasm as d
}

test_screening_unavailable_does_not_deny if {
    d := with_data({"screening_available": false, "risk_score": null, "risk_categories": []})
    chainalysis_address_screening.allow with data.params as default_params with data.wasm as d
    count(chainalysis_address_screening.deny) == 0 with data.params as default_params with data.wasm as d
}

test_multiple_denies_do_not_fail_open if {
    d := with_data({
        "sanctioned": true,
        "sanctions_categories": ["sdn"],
        "is_high_risk": true,
        "risk_score": "severe",
        "risk_categories": ["mixer"],
    })
    deny := chainalysis_address_screening.deny with data.params as default_params with data.wasm as d
    "chainalysis_sanctioned" in deny
    "high_risk_address" in deny
    "risk_category_blocklisted" in deny
    count(deny) >= 3
    not chainalysis_address_screening.allow with data.params as default_params with data.wasm as d
}

test_deny_on_oracle_error if {
    not chainalysis_address_screening.allow with data.params as default_params with data.wasm as wrap({"error": "oracle failed"})
}

test_deny_on_empty_payload if {
    not chainalysis_address_screening.allow with data.params as default_params with data.wasm as wrap({})
}
