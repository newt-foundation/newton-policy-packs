package persona_kyc_test

import data.persona_kyc

default_params := {
    "max_age_days": 365,
    "allowed_countries": ["US", "GB", "CA", "DE", "FR", "JP", "SG"],
    "min_age_years": 18,
    "require_selfie": true,
    "require_watchlist_pass": true,
}

clean_data := {
    "has_inquiry": true,
    "status": "approved",
    "age_days": 10,
    "country_code": "US",
    "age_years": 30,
    "government_id_status": "passed",
    "selfie_status": "passed",
    "watchlist_status": "passed",
    "inquiry_id": "inq_abc123",
    "timestamp": 1700000000000,
}

with_data(overrides) := object.union(clean_data, overrides)

test_allow_when_all_clean if {
    persona_kyc.allow with data.params as default_params with data.wasm as clean_data
    count(persona_kyc.deny) == 0 with data.params as default_params with data.wasm as clean_data
}

test_deny_no_inquiry if {
    d := {
        "has_inquiry": false,
        "status": null,
        "age_days": null,
        "country_code": null,
        "age_years": null,
        "government_id_status": null,
        "selfie_status": null,
        "watchlist_status": null,
        "inquiry_id": null,
        "timestamp": 1700000000000,
    }
    "no_inquiry" in persona_kyc.deny with data.params as default_params with data.wasm as d
    not persona_kyc.allow with data.params as default_params with data.wasm as d
}

test_deny_inquiry_not_approved if {
    d := with_data({"status": "declined"})
    "inquiry_not_approved" in persona_kyc.deny with data.params as default_params with data.wasm as d
    not persona_kyc.allow with data.params as default_params with data.wasm as d
}

test_deny_kyc_stale if {
    d := with_data({"age_days": 400})
    "kyc_stale" in persona_kyc.deny with data.params as default_params with data.wasm as d
    not persona_kyc.allow with data.params as default_params with data.wasm as d
}

test_deny_country_not_allowed if {
    d := with_data({"country_code": "KP"})
    "country_not_allowed" in persona_kyc.deny with data.params as default_params with data.wasm as d
    not persona_kyc.allow with data.params as default_params with data.wasm as d
}

test_deny_underage if {
    d := with_data({"age_years": 17})
    "underage" in persona_kyc.deny with data.params as default_params with data.wasm as d
    not persona_kyc.allow with data.params as default_params with data.wasm as d
}

test_deny_id_not_passed if {
    d := with_data({"government_id_status": "failed"})
    "id_not_passed" in persona_kyc.deny with data.params as default_params with data.wasm as d
    not persona_kyc.allow with data.params as default_params with data.wasm as d
}

test_deny_selfie_not_passed if {
    d := with_data({"selfie_status": "failed"})
    "selfie_not_passed" in persona_kyc.deny with data.params as default_params with data.wasm as d
    not persona_kyc.allow with data.params as default_params with data.wasm as d
}

test_deny_watchlist_hit if {
    d := with_data({"watchlist_status": "failed"})
    "watchlist_hit" in persona_kyc.deny with data.params as default_params with data.wasm as d
    not persona_kyc.allow with data.params as default_params with data.wasm as d
}

test_require_selfie_disabled_param if {
    p := object.union(default_params, {"require_selfie": false})
    d := with_data({"selfie_status": "failed"})
    not "selfie_not_passed" in persona_kyc.deny with data.params as p with data.wasm as d
    persona_kyc.allow with data.params as p with data.wasm as d
}

test_require_watchlist_pass_disabled_param if {
    p := object.union(default_params, {"require_watchlist_pass": false})
    d := with_data({"watchlist_status": "failed"})
    not "watchlist_hit" in persona_kyc.deny with data.params as p with data.wasm as d
    persona_kyc.allow with data.params as p with data.wasm as d
}

test_country_code_null_does_not_deny if {
    d := with_data({"country_code": null})
    not "country_not_allowed" in persona_kyc.deny with data.params as default_params with data.wasm as d
    persona_kyc.allow with data.params as default_params with data.wasm as d
}

test_age_years_null_does_not_deny if {
    d := with_data({"age_years": null})
    not "underage" in persona_kyc.deny with data.params as default_params with data.wasm as d
    persona_kyc.allow with data.params as default_params with data.wasm as d
}

# When has_inquiry is false, the no_inquiry rule must fire and the policy
# must still evaluate cleanly without crashing on missing/null downstream
# fields (status, age_days, country_code, age_years, etc.).
test_no_inquiry_short_circuits if {
    d := {
        "has_inquiry": false,
        "status": null,
        "age_days": null,
        "country_code": null,
        "age_years": null,
        "government_id_status": null,
        "selfie_status": null,
        "watchlist_status": null,
        "inquiry_id": null,
        "timestamp": 1700000000000,
    }
    deny := persona_kyc.deny with data.params as default_params with data.wasm as d
    "no_inquiry" in deny
    not persona_kyc.allow with data.params as default_params with data.wasm as d
}

# Multiple deny reasons must coexist in the deny set (set-based form).
# Regression guard against the single-value `:=` failure mode where
# conflicts caused allow to flip true.
test_multiple_denies_do_not_fail_open if {
    d := with_data({"status": "declined", "age_years": 16})
    deny := persona_kyc.deny with data.params as default_params with data.wasm as d
    "inquiry_not_approved" in deny
    "underage" in deny
    count(deny) >= 2
    not persona_kyc.allow with data.params as default_params with data.wasm as d
}

test_deny_on_oracle_error if {
    not persona_kyc.allow with data.params as default_params with data.wasm as {"error": "oracle failed"}
}

test_deny_on_empty_payload if {
    not persona_kyc.allow with data.params as default_params with data.wasm as {}
}
