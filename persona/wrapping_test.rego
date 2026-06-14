package persona_kyc_wrapping_test

import data.persona_kyc

# Phase 0 § Stream B Rego shape test for persona.
#
# Locks the namespacing contract: the policy now reads from
# `data.wasm.persona.<field>`, NOT `data.wasm.<field>`. Mirrors
# `policy.js`'s `wrapOutput("persona", ...)` envelope.
#
# Per-pack negative-shape pattern: persona uses the MIXED pattern (like
# guardrail). Most deny rules silent-skip on undefined `v`, but
# `no_inquiry` has the bare `not v.has_inquiry` shape — when `v` is
# undefined, `not undefined` grounds true and this rule FIRES. Same
# fail-closed posture as guardrail's `health_unavailable`: a missing
# pack slot should deny because there's no KYC inquiry to gate on.

default_params := {
    "max_age_days": 365,
    "allowed_countries": ["US", "GB", "CA", "DE", "FR", "JP", "SG"],
    "min_age_years": 18,
    "require_selfie": true,
    "require_watchlist_pass": true,
}

clean_inner := {
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

namespaced(overrides) := {"persona": object.union(clean_inner, overrides)}

test_namespaced_allow_when_clean if {
    persona_kyc.allow with data.params as default_params with data.wasm as namespaced({})
    count(persona_kyc.deny) == 0 with data.params as default_params with data.wasm as namespaced({})
}

test_namespaced_deny_no_inquiry if {
    "no_inquiry" in persona_kyc.deny
        with data.params as default_params
        with data.wasm as {"persona": {"has_inquiry": false}}
}

test_namespaced_deny_inquiry_not_approved if {
    "inquiry_not_approved" in persona_kyc.deny
        with data.params as default_params
        with data.wasm as namespaced({"status": "declined"})
}

test_namespaced_deny_kyc_stale if {
    "kyc_stale" in persona_kyc.deny
        with data.params as default_params
        with data.wasm as namespaced({"age_days": 400})
}

test_namespaced_deny_country_not_allowed if {
    "country_not_allowed" in persona_kyc.deny
        with data.params as default_params
        with data.wasm as namespaced({"country_code": "KP"})
}

test_namespaced_deny_underage if {
    "underage" in persona_kyc.deny
        with data.params as default_params
        with data.wasm as namespaced({"age_years": 17})
}

test_namespaced_deny_id_not_passed if {
    "id_not_passed" in persona_kyc.deny
        with data.params as default_params
        with data.wasm as namespaced({"government_id_status": "failed"})
}

# Negative shape test: a flat (un-namespaced) `data.wasm` does NOT allow.
# Under flat input where `data.wasm.persona` is absent, `not v.has_inquiry`
# grounds true on undefined `v`, so `no_inquiry` fires. Other rules
# silent-skip. The load-bearing claim is that bare-top-level field reads
# do NOT contribute to allow.
test_flat_input_fails_allow if {
    flat_clean := clean_inner
    deny := persona_kyc.deny
        with data.params as default_params
        with data.wasm as flat_clean
    "no_inquiry" in deny
    # Stronger pin: ONLY this rule fires under flat input (other deny
    # rules silent-skip on undefined `v`). A regression where another
    # rule accidentally starts firing on undefined would change this
    # count.
    count(deny) == 1
    not persona_kyc.allow
        with data.params as default_params
        with data.wasm as flat_clean
}

# Error envelope: composite Rego can selectively deny on
# `data.wasm.<pack-id>.error`.
test_namespaced_error_does_not_allow if {
    not persona_kyc.allow
        with data.params as default_params
        with data.wasm as {"persona": {"error": "oracle failed"}}
}

# Fail-closed under malformed/empty namespaced output.
test_namespaced_empty_pack_slot_does_not_allow if {
    not persona_kyc.allow
        with data.params as default_params
        with data.wasm as {"persona": {}}
}

# Cross-pack composition smoke: stuff `vaultsfyi` and `chainalysis`
# extreme values at sibling depth — persona's rules MUST only read its
# own slice via `v := data.wasm.persona`.
test_other_pack_keys_do_not_interfere if {
    composite := {
        "persona": clean_inner,
        "vaultsfyi": {
            "tvl_drawdown_24h_pct": 999,
            "is_corrupted": true,
        },
        "chainalysis": {
            "sanctioned": true,
            "is_high_risk": true,
        },
    }
    persona_kyc.allow with data.params as default_params with data.wasm as composite
    count(persona_kyc.deny) == 0 with data.params as default_params with data.wasm as composite
}
