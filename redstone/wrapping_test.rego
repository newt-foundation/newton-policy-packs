package redstone_oracle_divergence_wrapping_test

import data.redstone_oracle_divergence

# Phase 0 § Stream B Rego shape test for redstone.
#
# Locks the namespacing contract: the policy now reads from
# `data.wasm.redstone.<field>`, NOT `data.wasm.<field>`. Mirrors
# `policy.js`'s `wrapOutput("redstone", ...)` envelope.
#
# Per-pack negative-shape pattern: redstone uses the silent-skip pattern
# (like vaultsfyi/balancer/chainalysis). Every deny rule uses `>` or `>=`
# comparisons that fail-skip when `v.<field>` is undefined. Flat-input
# assertion is `count(deny) == 0`.

default_params := {
    "warn_bp": 50,
    "deny_bp": 100,
    "deny_sustained_seconds": 1800,
    "max_feed_age_seconds": 300,
    "enable_sustained_check": false,
}

clean_inner := {
    "divergence_bp": 10,
    "redstone_feed_age_seconds": 30,
    "prev_snapshot_present": false,
    "prev_divergence_bp": null,
    "sustained_seconds": 0,
}

namespaced(overrides) := {"redstone": object.union(clean_inner, overrides)}

test_namespaced_allow_when_clean if {
    redstone_oracle_divergence.allow with data.params as default_params with data.wasm as namespaced({})
    count(redstone_oracle_divergence.deny) == 0 with data.params as default_params with data.wasm as namespaced({})
}

test_namespaced_deny_redstone_feed_stale if {
    "redstone_feed_stale" in redstone_oracle_divergence.deny
        with data.params as default_params
        with data.wasm as namespaced({"redstone_feed_age_seconds": 9999})
}

test_namespaced_deny_divergence_above_hard_cap if {
    "divergence_above_hard_cap" in redstone_oracle_divergence.deny
        with data.params as default_params
        with data.wasm as namespaced({"divergence_bp": 150})
}

test_namespaced_deny_divergence_sustained if {
    p := object.union(default_params, {"enable_sustained_check": true})
    "divergence_sustained" in redstone_oracle_divergence.deny
        with data.params as p
        with data.wasm as namespaced({
            "divergence_bp": 75,
            "prev_snapshot_present": true,
            "prev_divergence_bp": 80,
            "sustained_seconds": 1900,
        })
}

# Negative shape test: a flat (un-namespaced) `data.wasm` MUST NOT trigger
# any deny rule. Every redstone rule uses `>` / `>=` comparisons that
# silent-skip on undefined `v.<field>`.
test_flat_input_does_not_trigger_namespaced_rules if {
    flat_with_violations := object.union(clean_inner, {
        "divergence_bp": 9999,
        "redstone_feed_age_seconds": 99999,
        "prev_snapshot_present": true,
        "prev_divergence_bp": 9999,
        "sustained_seconds": 99999,
    })
    count(redstone_oracle_divergence.deny) == 0
        with data.params as default_params
        with data.wasm as flat_with_violations
}

# Error envelope: composite Rego can selectively deny on
# `data.wasm.<pack-id>.error`.
test_namespaced_error_does_not_allow if {
    not redstone_oracle_divergence.allow
        with data.params as default_params
        with data.wasm as {"redstone": {"error": "oracle failed"}}
}

# Fail-closed under malformed/empty namespaced output.
test_namespaced_empty_pack_slot_does_not_allow if {
    not redstone_oracle_divergence.allow
        with data.params as default_params
        with data.wasm as {"redstone": {}}
}

# Cross-pack composition smoke: stuff `vaultsfyi` and `chainalysis` extreme
# values at sibling depth — redstone's rules MUST only read its own slice
# via `v := data.wasm.redstone`.
test_other_pack_keys_do_not_interfere if {
    composite := {
        "redstone": clean_inner,
        "vaultsfyi": {
            "tvl_drawdown_24h_pct": 999,
            "is_corrupted": true,
        },
        "chainalysis": {
            "sanctioned": true,
            "is_high_risk": true,
        },
    }
    redstone_oracle_divergence.allow with data.params as default_params with data.wasm as composite
    count(redstone_oracle_divergence.deny) == 0 with data.params as default_params with data.wasm as composite
}
