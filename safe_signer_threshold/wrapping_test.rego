package safe_signer_threshold_wrapping_test

import data.safe_signer_threshold

# Phase 0 § Stream B Rego shape test for safe_signer_threshold.
#
# Locks the namespacing contract: the policy reads from
# `data.wasm.safe_signer_threshold.<field>`, NOT `data.wasm.<field>`. Mirrors
# `policy.js`'s `wrapOutput("safe_signer_threshold", ...)` envelope.
#
# Per-pack negative-shape pattern: safe_signer_threshold uses the silent-skip
# pattern (like redstone/vaultsfyi/balancer). Every oracle-derived deny rule
# bottoms out in a comparison that fail-skips when `v.<field>` is undefined,
# and `allow` re-asserts field presence positively so the skip fails closed.
# Flat-input assertion is therefore `count(deny) == 0` AND `not allow`.
#
# `intent_chain_id_missing` is the one deny rule that reads `input` rather
# than `data.wasm`, so every assertion here supplies an intent — otherwise it
# would fire regardless of the wasm shape under test.

default_params := {
    "safe_address": "0x1111111111111111111111111111111111111111",
    "min_threshold": 2,
    "min_owners": 3,
    "max_owners": 5,
}

clean_inner := {
    "safe_address": "0x1111111111111111111111111111111111111111",
    "chain_id": 11155111,
    "block_number": 11629333,
    "threshold": 3,
    "owner_count": 4,
}

default_intent := {"chain_id": "11155111"}

namespaced(overrides) := {"safe_signer_threshold": object.union(clean_inner, overrides)}

test_namespaced_allow_when_clean if {
    safe_signer_threshold.allow with data.params as default_params with data.wasm as namespaced({}) with input as default_intent
    count(safe_signer_threshold.deny) == 0 with data.params as default_params with data.wasm as namespaced({}) with input as default_intent
}

test_namespaced_deny_threshold_below_minimum if {
    "threshold_below_minimum" in safe_signer_threshold.deny
        with data.params as default_params
        with data.wasm as namespaced({"threshold": 1})
        with input as default_intent
}

test_namespaced_deny_owners_out_of_range if {
    "owners_below_minimum" in safe_signer_threshold.deny
        with data.params as default_params
        with data.wasm as namespaced({"owner_count": 1})
        with input as default_intent

    "owners_above_maximum" in safe_signer_threshold.deny
        with data.params as default_params
        with data.wasm as namespaced({"owner_count": 99})
        with input as default_intent
}

test_namespaced_deny_safe_address_mismatch if {
    "safe_address_mismatch" in safe_signer_threshold.deny
        with data.params as default_params
        with data.wasm as namespaced({"safe_address": "0x2222222222222222222222222222222222222222"})
        with input as default_intent
}

test_namespaced_deny_chain_id_mismatch if {
    "chain_id_mismatch" in safe_signer_threshold.deny
        with data.params as default_params
        with data.wasm as namespaced({"chain_id": 84532})
        with input as default_intent
}

# Negative shape test: a flat (un-namespaced) `data.wasm` MUST NOT trigger
# any oracle-derived deny rule, and MUST NOT allow either — every such rule
# silent-skips on the undefined `v.<field>`, and `allow`'s positive field
# assertions fail.
test_flat_input_does_not_trigger_namespaced_rules if {
    flat_with_violations := object.union(clean_inner, {
        "safe_address": "0x9999999999999999999999999999999999999999",
        "chain_id": 84532,
        "threshold": 0,
        "owner_count": 99,
    })
    count(safe_signer_threshold.deny) == 0
        with data.params as default_params
        with data.wasm as flat_with_violations
        with input as default_intent
    not safe_signer_threshold.allow
        with data.params as default_params
        with data.wasm as flat_with_violations
        with input as default_intent
}

# Error envelope: composite Rego can selectively deny on
# `data.wasm.<pack-id>.error`.
test_namespaced_error_does_not_allow if {
    not safe_signer_threshold.allow
        with data.params as default_params
        with data.wasm as {"safe_signer_threshold": {"error": "oracle failed"}}
        with input as default_intent
}

# Fail-closed under malformed/empty namespaced output.
test_namespaced_empty_pack_slot_does_not_allow if {
    not safe_signer_threshold.allow
        with data.params as default_params
        with data.wasm as {"safe_signer_threshold": {}}
        with input as default_intent
}

# Cross-pack composition smoke: stuff sibling pack slots with extreme values
# — safe_signer_threshold's rules MUST only read its own slice via
# `v := data.wasm.safe_signer_threshold`. A sibling reporting a conflicting
# `chain_id` must not affect this pack's intent comparison either.
test_other_pack_keys_do_not_interfere if {
    composite := {
        "safe_signer_threshold": clean_inner,
        "pharos_safe_mode": {
            "depeg_active": true,
            "chain_id": 84532,
        },
        "blockaid": {
            "classification": "Malicious",
            "simulation_succeeded": false,
        },
    }
    safe_signer_threshold.allow with data.params as default_params with data.wasm as composite with input as default_intent
    count(safe_signer_threshold.deny) == 0 with data.params as default_params with data.wasm as composite with input as default_intent
}
