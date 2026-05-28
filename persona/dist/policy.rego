package persona_kyc

import future.keywords

default allow := false

t := data.params
v := data.wasm

deny contains "no_inquiry" if not v.has_inquiry

deny contains "inquiry_not_approved" if {
    v.has_inquiry
    not v.status in {"approved", "completed"}
}

deny contains "kyc_stale" if v.age_days > t.max_age_days

deny contains "country_not_allowed" if {
    v.country_code != null
    not v.country_code in t.allowed_countries
}

deny contains "underage" if {
    v.age_years != null
    v.age_years < t.min_age_years
}

deny contains "id_not_passed" if v.government_id_status != "passed"

deny contains "selfie_not_passed" if {
    t.require_selfie
    v.selfie_status != "passed"
}

deny contains "watchlist_hit" if {
    t.require_watchlist_pass
    v.watchlist_status != "passed"
}

allow if count(deny) == 0
