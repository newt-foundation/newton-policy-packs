package sumsub_kyc_wrapping_test

import data.sumsub_kyc

# Phase 0 § Stream B Rego shape test for sumsub.
#
# Locks the namespacing contract: the policy now reads from
# `data.wasm.sumsub.<field>`, NOT `data.wasm.<field>`. Mirrors
# `policy.js`'s `wrapOutput("sumsub", ...)` envelope.
#
# Per-pack negative-shape pattern: sumsub uses the MIXED pattern (like
# persona/guardrail). Most deny rules silent-skip on undefined `v`, but
# `no_applicant` has the bare `not v.has_applicant` shape — when `v` is
# undefined, `not undefined` grounds true and the rule FIRES. That's
# the correct fail-closed posture: a missing pack slot should deny
# because there's no applicant to gate on.

default_params := {
    "max_age_days": 365,
    "allowed_countries": ["US", "GB", "CA", "DE", "FR", "JP", "SG"],
    "min_age_years": 18,
    "required_review_answer": "GREEN",
    "deny_on_pending": true,
}

clean_inner := {
    "has_applicant": true,
    "applicant_id": "abc123",
    "review_status": "completed",
    "review_answer": "GREEN",
    "applicant_age_days": 30,
    "country_code": "US",
    "age_years": 35,
}

namespaced(overrides) := {"sumsub": object.union(clean_inner, overrides)}

test_namespaced_allow_when_clean if {
    sumsub_kyc.allow with data.params as default_params with data.wasm as namespaced({})
    count(sumsub_kyc.deny) == 0 with data.params as default_params with data.wasm as namespaced({})
}

test_namespaced_deny_no_applicant if {
    "no_applicant" in sumsub_kyc.deny
        with data.params as default_params
        with data.wasm as {"sumsub": {"has_applicant": false}}
}

test_namespaced_deny_review_status_not_passing if {
    "review_status_not_passing" in sumsub_kyc.deny
        with data.params as default_params
        with data.wasm as namespaced({"review_answer": "RED"})
}

test_namespaced_deny_kyc_stale if {
    "kyc_stale" in sumsub_kyc.deny
        with data.params as default_params
        with data.wasm as namespaced({"applicant_age_days": 400})
}

test_namespaced_deny_country_not_allowed if {
    "country_not_allowed" in sumsub_kyc.deny
        with data.params as default_params
        with data.wasm as namespaced({"country_code": "KP"})
}

test_namespaced_deny_underage if {
    "underage" in sumsub_kyc.deny
        with data.params as default_params
        with data.wasm as namespaced({"age_years": 16})
}

test_namespaced_deny_pending_review if {
    "pending_review" in sumsub_kyc.deny
        with data.params as default_params
        with data.wasm as namespaced({"review_status": "pending"})
}

# Negative shape test: a flat (un-namespaced) `data.wasm` does NOT allow.
# `no_applicant` fires because `not v.has_applicant` grounds true on
# undefined. Other rules silent-skip on undefined. Pin both the specific
# deny + count == 1 to lock the shape (mirrors persona/guardrail).
test_flat_input_fails_allow if {
    flat_clean := clean_inner
    deny := sumsub_kyc.deny
        with data.params as default_params
        with data.wasm as flat_clean
    "no_applicant" in deny
    count(deny) == 1
    not sumsub_kyc.allow
        with data.params as default_params
        with data.wasm as flat_clean
}

# Error envelope: composite Rego can selectively deny on
# `data.wasm.<pack-id>.error`.
test_namespaced_error_does_not_allow if {
    not sumsub_kyc.allow
        with data.params as default_params
        with data.wasm as {"sumsub": {"error": "oracle failed"}}
}

# Fail-closed under malformed/empty namespaced output.
test_namespaced_empty_pack_slot_does_not_allow if {
    not sumsub_kyc.allow
        with data.params as default_params
        with data.wasm as {"sumsub": {}}
}

# Cross-pack composition: sumsub MUST only read its own slice via
# `v := data.wasm.sumsub`.
test_other_pack_keys_do_not_interfere if {
    composite := {
        "sumsub": clean_inner,
        "vaultsfyi": {
            "tvl_drawdown_24h_pct": 999,
            "is_corrupted": true,
        },
        "persona": {
            "has_inquiry": false,
            "status": null,
        },
    }
    sumsub_kyc.allow with data.params as default_params with data.wasm as composite
    count(sumsub_kyc.deny) == 0 with data.params as default_params with data.wasm as composite
}
