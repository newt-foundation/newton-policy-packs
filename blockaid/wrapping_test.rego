package blockaid_tx_safety_wrapping_test

import data.blockaid_tx_safety

# Phase 0 § Stream B Rego shape test for blockaid.
#
# Locks the namespacing contract: the policy now reads from
# `data.wasm.blockaid.<field>`, NOT `data.wasm.<field>`. Mirrors
# `policy.js`'s `wrapOutput("blockaid", ...)` envelope — every return-path
# is JSON-stringified as `{"blockaid": {...}}` and the AVS shallow-merges
# it into `data.wasm` so composite Rego references unambiguously as
# `data.wasm.blockaid.<field>` without colliding on shared keys.
#
# Coverage limits: this test exercises the Rego-side of namespacing only.
# It does NOT execute `policy.js` — runtime output shape is locked by the
# Stream C AST-lint guard plus a future jco-based simulation harness.

default_params := {
    "deny_features": ["unbounded_approval", "honeypot", "phishing"],
    "max_outbound_inbound_ratio": 1.05,
    "require_received_shares": true,
}

clean_inner := {
    "classification": "Benign",
    "features": [],
    "expected_inbound_value_usd": 1000,
    "expected_outbound_value_usd": 1000,
    "outbound_inbound_ratio": 1.0,
    "received_shares": true,
    "simulation_succeeded": true,
}

namespaced(overrides) := {"blockaid": object.union(clean_inner, overrides)}

test_namespaced_allow_when_clean if {
    blockaid_tx_safety.allow with data.params as default_params with data.wasm as namespaced({})
    count(blockaid_tx_safety.deny) == 0 with data.params as default_params with data.wasm as namespaced({})
}

test_namespaced_deny_blockaid_malicious if {
    "blockaid_malicious" in blockaid_tx_safety.deny
        with data.params as default_params
        with data.wasm as namespaced({"classification": "Malicious"})
}

test_namespaced_deny_simulation_failed if {
    "simulation_failed" in blockaid_tx_safety.deny
        with data.params as default_params
        with data.wasm as namespaced({"simulation_succeeded": false})
}

test_namespaced_deny_warning_with_blocked_feature if {
    "blockaid_feature:unbounded_approval" in blockaid_tx_safety.deny
        with data.params as default_params
        with data.wasm as namespaced({"classification": "Warning", "features": ["unbounded_approval"]})
}

test_namespaced_deny_no_shares_received if {
    "no_shares_received" in blockaid_tx_safety.deny
        with data.params as default_params
        with data.wasm as namespaced({"received_shares": false})
}

test_namespaced_deny_value_skim if {
    "value_skim" in blockaid_tx_safety.deny
        with data.params as default_params
        with data.wasm as namespaced({"outbound_inbound_ratio": 1.5})
}

test_namespaced_deny_unknown_classification if {
    "blockaid_unknown_classification" in blockaid_tx_safety.deny
        with data.params as default_params
        with data.wasm as namespaced({"classification": "Unknown"})
}

# Negative shape test: a flat (un-namespaced) `data.wasm` does NOT allow,
# because the rules read from `.blockaid.<field>` and the flat fixture has
# no `.blockaid` key. The deny set is non-empty under blockaid's
# fail-closed default-deny rules (e.g. `not v.simulation_succeeded` fires
# when `v.simulation_succeeded` is undefined) — that's the correct posture
# for a missing pack slot. The load-bearing claim here is that
# bare-top-level field reads do NOT contribute to allow: even though the
# flat fixture has `classification: "Benign"` etc. at the top level, the
# policy reads through `v := data.wasm.blockaid` so allow MUST fail.
test_flat_input_fails_allow if {
    flat_clean := clean_inner
    deny := blockaid_tx_safety.deny
        with data.params as default_params
        with data.wasm as flat_clean
    # Pin the deny shape, not just the absence of allow. A future drift
    # where every deny rule silent-skips on undefined would still satisfy
    # `not allow` (default false), but it would NOT satisfy these
    # assertions — they lock the load-bearing claim that blockaid's
    # bare `not v.<field>` rules fire when the namespace slot is missing,
    # which is the documented fail-closed posture. Note: only the bare
    # boolean-field rules fire on undefined-`v`. The `not v.classification
    # in {set}` rule (`blockaid_unknown_classification`) does NOT fire
    # because `<undefined> in {...}` makes the whole expression
    # ungroundable rather than returning false. That's why this assertion
    # pins the two boolean rules specifically — strengthening the test
    # without misclaiming the classification-check pattern.
    "simulation_failed" in deny
    "no_shares_received" in deny
    count(deny) >= 2
    not blockaid_tx_safety.allow
        with data.params as default_params
        with data.wasm as flat_clean
}

# Error envelope: composite Rego can selectively deny on
# `data.wasm.<pack-id>.error`. Pin that the namespaced error envelope at
# least does not erroneously satisfy `allow`.
test_namespaced_error_does_not_allow if {
    not blockaid_tx_safety.allow
        with data.params as default_params
        with data.wasm as {"blockaid": {"error": "oracle failed"}}
}

# Fail-closed under malformed/empty namespaced output. Locks frozen rule 5
# at the policy boundary regardless of how an upstream `policy.js` bug
# routed around its catch.
test_namespaced_empty_pack_slot_does_not_allow if {
    not blockaid_tx_safety.allow
        with data.params as default_params
        with data.wasm as {"blockaid": {}}
}

# Cross-pack composition smoke: when `data.wasm` carries multiple packs
# under different top-level keys, blockaid's rules MUST only read its own
# slice. Stuff `chainalysis` and `vaultsfyi` keys alongside blockaid's —
# they must not affect blockaid's deny set, even though they may share
# field names like `classification` (chainalysis emits a different shape
# but Rego field access is by name, so a bare top-level read would
# silently cross-contaminate).
test_other_pack_keys_do_not_interfere if {
    composite := {
        "blockaid": clean_inner,
        "chainalysis": {
            "classification": "Malicious",
            "sanctioned": true,
            "is_high_risk": true,
        },
        "vaultsfyi": {
            "simulation_succeeded": false,
            "received_shares": false,
        },
    }
    blockaid_tx_safety.allow with data.params as default_params with data.wasm as composite
    count(blockaid_tx_safety.deny) == 0 with data.params as default_params with data.wasm as composite
}
