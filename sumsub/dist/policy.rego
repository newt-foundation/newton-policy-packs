package sumsub_kyc

import future.keywords

default allow := false

t := data.params
v := data.wasm

deny contains "no_applicant" if not v.has_applicant

deny contains "review_status_not_passing" if {
    v.has_applicant
    v.review_answer != t.required_review_answer
}

deny contains "kyc_stale" if {
    v.has_applicant
    v.applicant_age_days != null
    v.applicant_age_days > t.max_age_days
}

deny contains "country_not_allowed" if {
    v.has_applicant
    v.country_code != null
    not v.country_code in t.allowed_countries
}

deny contains "underage" if {
    v.has_applicant
    v.age_years != null
    v.age_years < t.min_age_years
}

deny contains "pending_review" if {
    v.has_applicant
    t.deny_on_pending
    v.review_status in {"init", "pending", "prechecked", "queued"}
}

allow if {
    v.has_applicant
    v.review_answer == t.required_review_answer
    age_days_ok
    country_ok
    age_years_ok
    not pending_review_blocks
}

age_days_ok if v.applicant_age_days == null
age_days_ok if v.applicant_age_days <= t.max_age_days

country_ok if v.country_code == null
country_ok if v.country_code in t.allowed_countries

age_years_ok if v.age_years == null
age_years_ok if v.age_years >= t.min_age_years

pending_review_blocks if {
    t.deny_on_pending
    v.review_status in {"init", "pending", "prechecked", "queued"}
}
