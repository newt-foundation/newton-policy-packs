package chainalysis_address_screening_wrapping_test

import data.chainalysis_address_screening

# Phase 0 § Stream B Rego shape test for chainalysis.
#
# Locks the namespacing contract: the policy now reads from
# `data.wasm.chainalysis.<field>`, NOT `data.wasm.<field>`. Mirrors
# `policy.js`'s `wrapOutput("chainalysis", ...)` envelope — every
# return-path is JSON-stringified as `{"chainalysis": {...}}` and the AVS
# shallow-merges it into `data.wasm` so composite Rego references
# unambiguously as `data.wasm.chainalysis.<field>` without colliding on
# shared keys (notably `risk_score` — vaultsfyi emits it as a number,
# chainalysis emits it as a string).
#
# Coverage limits: this test exercises the Rego-side of namespacing only.
# It does NOT execute `policy.js` — runtime output shape is locked by the
# Stream C AST-lint guard plus a future jco-based simulation harness.
#
# Per-pack negative-shape pattern: every chainalysis deny rule has an
# explicit precondition (e.g. `t.deny_on_sanctioned AND v.sanctioned`),
# so when `v` is undefined under flat input the AND fails-skip and the
# deny set is empty. Same silent-skip shape as vaultsfyi/balancer; the
# flat-input assertion is `count(deny) == 0` (NOT blockaid's `not allow`
# + deny pinning, which fits packs whose rules use bare `not v.<bool>`
# patterns).

default_params := {
    "deny_on_sanctioned": true,
    "deny_on_high_risk_category": true,
    "risk_categories_blocklist": ["mixer", "stolen_funds", "ransomware"],
}

clean_inner := {
    "sanctioned": false,
    "sanctions_categories": [],
    "screening_available": true,
    "risk_score": "low",
    "risk_categories": [],
    "is_high_risk": false,
}

namespaced(overrides) := {"chainalysis": object.union(clean_inner, overrides)}

test_namespaced_allow_when_clean if {
    chainalysis_address_screening.allow with data.params as default_params with data.wasm as namespaced({})
    count(chainalysis_address_screening.deny) == 0 with data.params as default_params with data.wasm as namespaced({})
}

test_namespaced_deny_chainalysis_sanctioned if {
    "chainalysis_sanctioned" in chainalysis_address_screening.deny
        with data.params as default_params
        with data.wasm as namespaced({"sanctioned": true, "sanctions_categories": ["sdn"]})
}

test_namespaced_deny_high_risk_address if {
    "high_risk_address" in chainalysis_address_screening.deny
        with data.params as default_params
        with data.wasm as namespaced({"is_high_risk": true, "risk_score": "high"})
}

test_namespaced_deny_risk_category_blocklisted if {
    "risk_category_blocklisted" in chainalysis_address_screening.deny
        with data.params as default_params
        with data.wasm as namespaced({"risk_categories": ["mixer", "exchange"]})
}

# Negative shape test: a flat (un-namespaced) `data.wasm` MUST NOT trigger
# any deny rule because every rule has an explicit precondition that
# fails-skip when `v := data.wasm.chainalysis` is undefined. Locks the
# post-namespacing shape — fails if a stray rule still references
# `data.wasm.<field>` at the bare top level.
test_flat_input_does_not_trigger_namespaced_rules if {
    flat_with_violations := object.union(clean_inner, {
        "sanctioned": true,
        "is_high_risk": true,
        "risk_categories": ["mixer", "ransomware"],
    })
    count(chainalysis_address_screening.deny) == 0
        with data.params as default_params
        with data.wasm as flat_with_violations
}

# Error envelope: composite Rego can selectively deny on
# `data.wasm.<pack-id>.error`. Pin that the namespaced error envelope at
# least does not erroneously satisfy `allow`.
test_namespaced_error_does_not_allow if {
    not chainalysis_address_screening.allow
        with data.params as default_params
        with data.wasm as {"chainalysis": {"error": "oracle failed"}}
}

# Fail-closed under malformed/empty namespaced output. Note: chainalysis's
# allow rule has explicit type guards (`is_boolean(v.sanctioned)`,
# `is_array(v.risk_categories)`) so an empty pack slot fails the type
# checks — allow MUST NOT hold. Locks frozen rule 5 at the policy
# boundary regardless of how an upstream `policy.js` bug routed around
# its catch.
test_namespaced_empty_pack_slot_does_not_allow if {
    not chainalysis_address_screening.allow
        with data.params as default_params
        with data.wasm as {"chainalysis": {}}
}

# Cross-pack composition smoke: when `data.wasm` carries multiple packs
# under different top-level keys, chainalysis's rules MUST only read its
# own slice. The load-bearing case for chainalysis: vaultsfyi emits
# `risk_score` as a number, chainalysis emits it as a string. Pre-
# namespacing this would silently clobber under merge_jsons last-wins.
# Stuff a vaultsfyi sibling with `risk_score: 10` (a number) — chainalysis
# must NOT read it through `v.risk_score` since `v` is namespaced.
test_other_pack_keys_do_not_interfere if {
    composite := {
        "chainalysis": clean_inner,
        "vaultsfyi": {
            "risk_score": 10,
            "tvl_drawdown_24h_pct": 999,
            "is_corrupted": true,
        },
        "blockaid": {
            "classification": "Malicious",
            "is_high_risk": true,
        },
    }
    chainalysis_address_screening.allow with data.params as default_params with data.wasm as composite
    count(chainalysis_address_screening.deny) == 0 with data.params as default_params with data.wasm as composite
}
