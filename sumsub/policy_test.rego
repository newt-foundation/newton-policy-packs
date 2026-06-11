package sumsub_kyc_test

import data.sumsub_kyc

default_params := {
    "max_age_days": 365,
    "allowed_countries": ["US", "GB", "CA", "DE", "FR", "JP", "SG"],
    "min_age_years": 18,
    "required_review_answer": "GREEN",
    "deny_on_pending": true,
}

clean_data := {
    "has_applicant": true,
    "applicant_id": "abc123",
    "review_status": "completed",
    "review_answer": "GREEN",
    "applicant_age_days": 30,
    "country_code": "US",
    "age_years": 35,
}

with_data(overrides) := object.union(clean_data, overrides)

test_allow_when_all_clean if {
    sumsub_kyc.allow with data.params as default_params with data.wasm as clean_data
    count(sumsub_kyc.deny) == 0 with data.params as default_params with data.wasm as clean_data
}

test_deny_no_applicant if {
    d := {
        "has_applicant": false,
        "applicant_id": null,
        "review_status": null,
        "review_answer": null,
        "applicant_age_days": null,
        "country_code": null,
        "age_years": null,
    }
    "no_applicant" in sumsub_kyc.deny with data.params as default_params with data.wasm as d
    not sumsub_kyc.allow with data.params as default_params with data.wasm as d
}

test_deny_review_status_not_passing if {
    d := with_data({"review_answer": "RED"})
    "review_status_not_passing" in sumsub_kyc.deny with data.params as default_params with data.wasm as d
    not sumsub_kyc.allow with data.params as default_params with data.wasm as d
}

test_deny_kyc_stale if {
    d := with_data({"applicant_age_days": 400})
    "kyc_stale" in sumsub_kyc.deny with data.params as default_params with data.wasm as d
    not sumsub_kyc.allow with data.params as default_params with data.wasm as d
}

test_deny_country_not_allowed if {
    d := with_data({"country_code": "KP"})
    "country_not_allowed" in sumsub_kyc.deny with data.params as default_params with data.wasm as d
    not sumsub_kyc.allow with data.params as default_params with data.wasm as d
}

test_deny_underage if {
    d := with_data({"age_years": 16})
    "underage" in sumsub_kyc.deny with data.params as default_params with data.wasm as d
    not sumsub_kyc.allow with data.params as default_params with data.wasm as d
}

test_deny_pending_review if {
    # review_answer must equal required_review_answer, otherwise
    # review_status_not_passing also fires; this isolates pending_review.
    d := with_data({"review_status": "pending"})
    "pending_review" in sumsub_kyc.deny with data.params as default_params with data.wasm as d
    not sumsub_kyc.allow with data.params as default_params with data.wasm as d
}

test_pending_disabled_param if {
    p := object.union(default_params, {"deny_on_pending": false})
    d := with_data({"review_status": "pending"})
    not "pending_review" in sumsub_kyc.deny with data.params as p with data.wasm as d
    sumsub_kyc.allow with data.params as p with data.wasm as d
}

test_country_code_null_does_not_deny if {
    d := with_data({"country_code": null})
    not "country_not_allowed" in sumsub_kyc.deny with data.params as default_params with data.wasm as d
    sumsub_kyc.allow with data.params as default_params with data.wasm as d
}

test_age_years_null_does_not_deny if {
    d := with_data({"age_years": null})
    not "underage" in sumsub_kyc.deny with data.params as default_params with data.wasm as d
    sumsub_kyc.allow with data.params as default_params with data.wasm as d
}

test_no_applicant_short_circuits if {
    # When there is no applicant, only no_applicant fires — none of the
    # detail-level rules (kyc_stale, country, underage, pending) should
    # trigger off null fields.
    d := {
        "has_applicant": false,
        "applicant_id": null,
        "review_status": null,
        "review_answer": null,
        "applicant_age_days": null,
        "country_code": null,
        "age_years": null,
    }
    deny := sumsub_kyc.deny with data.params as default_params with data.wasm as d
    "no_applicant" in deny
    not "kyc_stale" in deny
    not "country_not_allowed" in deny
    not "underage" in deny
    not "pending_review" in deny
}

test_red_review_answer_denies if {
    # Even with status="completed", a RED reviewAnswer must deny via
    # review_status_not_passing — applicants who have been reviewed and
    # rejected must never pass.
    d := with_data({"review_status": "completed", "review_answer": "RED"})
    "review_status_not_passing" in sumsub_kyc.deny with data.params as default_params with data.wasm as d
    not sumsub_kyc.allow with data.params as default_params with data.wasm as d
}

test_multiple_denies_do_not_fail_open if {
    d := with_data({
        "review_answer": "RED",
        "applicant_age_days": 400,
        "country_code": "KP",
        "age_years": 16,
    })
    deny := sumsub_kyc.deny with data.params as default_params with data.wasm as d
    "review_status_not_passing" in deny
    "kyc_stale" in deny
    "country_not_allowed" in deny
    "underage" in deny
    count(deny) >= 4
    not sumsub_kyc.allow with data.params as default_params with data.wasm as d
}

test_deny_on_oracle_error if {
    not sumsub_kyc.allow with data.params as default_params with data.wasm as {"error": "oracle failed"}
}

test_deny_on_empty_payload if {
    not sumsub_kyc.allow with data.params as default_params with data.wasm as {}
}
