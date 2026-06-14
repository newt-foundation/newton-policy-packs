package persona_kyc

import future.keywords

default allow := false

t := data.params

# Phase 0 § Stream B namespacing: every pack's WASM output is wrapped under
# its `PACK_ID` key by `policy.js`'s `wrapOutput("persona", ...)` so the
# AVS-side shallow `merge_jsons` composes cleanly across packs without
# top-level key collisions.
v := data.wasm.persona

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

allow if {
    v.has_inquiry
    v.status in {"approved", "completed"}
    v.age_days <= t.max_age_days
    country_ok
    age_years_ok
    v.government_id_status == "passed"
    selfie_ok
    watchlist_ok
}

country_ok if v.country_code == null
country_ok if v.country_code in t.allowed_countries

age_years_ok if v.age_years == null
age_years_ok if v.age_years >= t.min_age_years

selfie_ok if not t.require_selfie
selfie_ok if {
    t.require_selfie
    v.selfie_status == "passed"
}

watchlist_ok if not t.require_watchlist_pass
watchlist_ok if {
    t.require_watchlist_pass
    v.watchlist_status == "passed"
}
