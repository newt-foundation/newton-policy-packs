package balancer_pool_risk_wrapping_test

import data.balancer_pool_risk

# Phase 0 § Stream B Rego shape test for balancer.
#
# Locks the namespacing contract: the policy now reads from
# `data.wasm.balancer.<field>`, NOT `data.wasm.<field>`. Mirrors
# `policy.js`'s `wrapOutput("balancer", ...)` envelope — every return-path
# is JSON-stringified as `{"balancer": {...}}` and the AVS shallow-merges
# it into `data.wasm` so composite Rego references unambiguously as
# `data.wasm.balancer.<field>` without colliding on shared keys (e.g.
# `tvl_usd`).
#
# Coverage limits: this test exercises the Rego-side of namespacing only.
# It does NOT execute `policy.js` — runtime output shape is locked by the
# Stream C AST-lint guard plus a future jco-based simulation harness.

default_params := {
    "max_token_weight_pct": 80,
    "deny_on_underlying_risk": true,
    "min_tvl_usd": 100000,
    "tvl_drawdown_24h_max_pct": 25,
    "tvl_drawdown_7d_max_pct": 50,
}

clean_inner := {
    "pool_id": "0x1535d7ca00323aa32bd62aeddf7ca651e4b95966",
    "chain": "MAINNET",
    "pool_type": "WEIGHTED",
    "tvl_usd": 500000,
    "tvl_drawdown_24h_pct": 1,
    "tvl_drawdown_7d_pct": 3,
    "token_count": 2,
    "max_token_weight_pct": 80,
    "non_allowlisted_tokens": [],
    "has_boosted_tokens": false,
    "underlying_protocols": [],
}

namespaced(overrides) := {"balancer": object.union(clean_inner, overrides)}

test_namespaced_allow_when_clean if {
    balancer_pool_risk.allow with data.params as default_params with data.wasm as namespaced({})
    count(balancer_pool_risk.deny) == 0 with data.params as default_params with data.wasm as namespaced({})
}

test_namespaced_deny_token_weight_drift if {
    "token_weight_drift" in balancer_pool_risk.deny
        with data.params as default_params
        with data.wasm as namespaced({"max_token_weight_pct": 95})
}

test_namespaced_deny_non_allowlisted_token_in_pool if {
    "non_allowlisted_token_in_pool" in balancer_pool_risk.deny
        with data.params as default_params
        with data.wasm as namespaced({"non_allowlisted_tokens": ["0xdbdb4d16eda451d0503b854cf79d55697f90c8df"]})
}

test_namespaced_deny_underlying_protocol_risk if {
    "underlying_protocol_risk" in balancer_pool_risk.deny
        with data.params as default_params
        with data.wasm as namespaced({"has_boosted_tokens": true})
}

test_namespaced_deny_tvl_below_floor if {
    "tvl_below_floor" in balancer_pool_risk.deny
        with data.params as default_params
        with data.wasm as namespaced({"tvl_usd": 50000})
}

test_namespaced_deny_tvl_drawdown_24h if {
    "tvl_drawdown_24h" in balancer_pool_risk.deny
        with data.params as default_params
        with data.wasm as namespaced({"tvl_drawdown_24h_pct": 30})
}

test_namespaced_deny_tvl_drawdown_7d if {
    "tvl_drawdown_7d" in balancer_pool_risk.deny
        with data.params as default_params
        with data.wasm as namespaced({"tvl_drawdown_7d_pct": 60})
}

# Negative shape test: a flat (un-namespaced) `data.wasm` MUST NOT trigger
# any deny rule, because the rules read from `.balancer.<field>` and the
# flat fixture has no `.balancer` key. Locks the post-namespacing shape —
# fails if a stray rule still references `data.wasm.<field>` at the bare
# top level.
test_flat_input_does_not_trigger_namespaced_rules if {
    flat_with_violations := object.union(clean_inner, {
        "max_token_weight_pct": 99,
        "tvl_usd": 1,
        "tvl_drawdown_24h_pct": 99,
        "tvl_drawdown_7d_pct": 99,
        "has_boosted_tokens": true,
        "non_allowlisted_tokens": ["0xdead"],
    })
    count(balancer_pool_risk.deny) == 0
        with data.params as default_params
        with data.wasm as flat_with_violations
}

# Error envelope: composite Rego can selectively deny on
# `data.wasm.<pack-id>.error`. Pin that the namespaced error envelope at
# least does not erroneously satisfy `allow`.
test_namespaced_error_does_not_allow if {
    not balancer_pool_risk.allow
        with data.params as default_params
        with data.wasm as {"balancer": {"error": "oracle failed"}}
}

# Fail-closed under malformed/empty namespaced output. Locks frozen rule 5
# at the policy boundary regardless of how an upstream `policy.js` bug
# routed around its catch.
test_namespaced_empty_pack_slot_does_not_allow if {
    not balancer_pool_risk.allow
        with data.params as default_params
        with data.wasm as {"balancer": {}}
}

# Cross-pack composition smoke: when `data.wasm` carries multiple packs
# under different top-level keys, balancer's rules MUST only read its own
# slice. Stuff `vaultsfyi` keys alongside balancer's — they must not
# affect balancer's deny set, even though they share field names like
# `tvl_drawdown_24h_pct` (the load-bearing case for the namespacing fix).
test_other_pack_keys_do_not_interfere if {
    composite := {
        "balancer": clean_inner,
        "vaultsfyi": {
            "tvl_drawdown_24h_pct": 999,
            "tvl_drawdown_7d_pct": 999,
            "has_critical_flag": true,
            "is_corrupted": true,
        },
    }
    balancer_pool_risk.allow with data.params as default_params with data.wasm as composite
    count(balancer_pool_risk.deny) == 0 with data.params as default_params with data.wasm as composite
}
