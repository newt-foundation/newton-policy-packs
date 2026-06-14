package vault_risk_rating_wrapping_test

import data.vault_risk_rating

# Phase 0 § Stream B Rego shape test for vaultsfyi.
#
# Locks the namespacing contract: the policy now reads from
# `data.wasm.vaultsfyi.<field>`, NOT `data.wasm.<field>`. This is the
# Rego-side mirror of `policy.js`'s `wrapOutput("vaultsfyi", ...)`
# envelope — every `policy.js` return-path is JSON-stringified as
# `{"vaultsfyi": {...}}` and the AVS shallow-merges it into `data.wasm`
# (see `newton-prover-avs/crates/operator/src/simulation.rs:296`). After
# Stream B every pack's output sits under its own top-level key so
# composite Rego can `data.wasm.<pack-id>.<field>` without collisions.
#
# Coverage limits (per phase-0-pack-namespacing-plan.md): this test
# exercises the **Rego-side** of namespacing only. It does NOT execute
# `policy.js` and therefore does NOT verify the runtime output shape —
# that gap is closed by the Stream C AST-lint guard plus a future
# `jco`-based runtime simulation harness.

default_params := {
    "apy_z_max": 4,
    "tvl_drawdown_24h_max_pct": 25,
    "tvl_drawdown_7d_max_pct": 50,
    "risk_score_floor": 60,
    "deny_on_allocation_change": true,
    "deny_on_critical_flag": true,
    "deny_on_corrupted": true,
}

clean_inner := {
    "apy_z_score": 0.5,
    "tvl_drawdown_24h_pct": 1,
    "tvl_drawdown_7d_pct": 2,
    "risk_score": 90,
    "has_critical_flag": false,
    "is_corrupted": false,
    "allocation_changed_since_last": false,
}

# `data.wasm` arrives shallow-merged across packs as
# `{ "vaultsfyi": {...}, "chainalysis": {...}, ... }`. Build the namespaced
# fixture so the policy must descend into `.vaultsfyi.<field>` to read
# anything.
namespaced(overrides) := {"vaultsfyi": object.union(clean_inner, overrides)}

# Allow path reads from `data.wasm.vaultsfyi.*`.
test_namespaced_allow_when_clean if {
    vault_risk_rating.allow with data.params as default_params with data.wasm as namespaced({})
    count(vault_risk_rating.deny) == 0 with data.params as default_params with data.wasm as namespaced({})
}

# Every existing deny rule must read from the namespaced shape. If any
# rule still references `data.wasm.<field>` (pre-namespacing), these
# fixtures won't trigger it — the deny set will be empty and the test
# fails.
test_namespaced_deny_apy_spike if {
    "apy_spike" in vault_risk_rating.deny
        with data.params as default_params
        with data.wasm as namespaced({"apy_z_score": 5})
}

test_namespaced_deny_tvl_drawdown_24h if {
    "tvl_drawdown_24h" in vault_risk_rating.deny
        with data.params as default_params
        with data.wasm as namespaced({"tvl_drawdown_24h_pct": 30})
}

test_namespaced_deny_tvl_drawdown_7d if {
    "tvl_drawdown_7d" in vault_risk_rating.deny
        with data.params as default_params
        with data.wasm as namespaced({"tvl_drawdown_7d_pct": 60})
}

test_namespaced_deny_risk_score_below_floor if {
    "risk_score_below_floor" in vault_risk_rating.deny
        with data.params as default_params
        with data.wasm as namespaced({"risk_score": 30})
}

test_namespaced_deny_critical_flag if {
    "critical_flag" in vault_risk_rating.deny
        with data.params as default_params
        with data.wasm as namespaced({"has_critical_flag": true})
}

test_namespaced_deny_corrupted if {
    "vault_corrupted" in vault_risk_rating.deny
        with data.params as default_params
        with data.wasm as namespaced({"is_corrupted": true})
}

test_namespaced_deny_allocation_changed if {
    "allocation_changed" in vault_risk_rating.deny
        with data.params as default_params
        with data.wasm as namespaced({"allocation_changed_since_last": true})
}

# Negative shape test: a flat (un-namespaced) `data.wasm` MUST NOT trigger
# any deny rule, because the rules read from `.vaultsfyi.<field>` and the
# flat fixture has no `.vaultsfyi` key. This is the load-bearing assertion
# — it locks the post-namespacing shape and would fail if a stray rule
# still referenced `data.wasm.<field>` at the bare top level.
test_flat_input_does_not_trigger_namespaced_rules if {
    flat_with_violations := object.union(clean_inner, {
        "apy_z_score": 99,
        "is_corrupted": true,
        "has_critical_flag": true,
        "allocation_changed_since_last": true,
        "risk_score": 10,
    })
    count(vault_risk_rating.deny) == 0
        with data.params as default_params
        with data.wasm as flat_with_violations
}

# Error envelope: composite Rego can selectively deny on
# `data.wasm.<pack-id>.error`. Today's policy.rego doesn't have an
# explicit `error` deny rule (it only had implicit fail-closed via the
# `allow` conjunction); pin that the namespaced error envelope at least
# does not erroneously satisfy `allow`.
test_namespaced_error_does_not_allow if {
    not vault_risk_rating.allow
        with data.params as default_params
        with data.wasm as {"vaultsfyi": {"error": "oracle failed"}}
}

# Cross-pack composition smoke: when `data.wasm` carries multiple packs
# under different top-level keys, vaultsfyi's rules MUST only read its
# own slice. Stuff `chainalysis` keys alongside vaultsfyi's — they must
# not affect vaultsfyi's deny set.
test_other_pack_keys_do_not_interfere if {
    composite := {
        "vaultsfyi": clean_inner,
        "chainalysis": {"sanctioned": true, "is_high_risk": true, "risk_score": "high"},
    }
    vault_risk_rating.allow with data.params as default_params with data.wasm as composite
    count(vault_risk_rating.deny) == 0 with data.params as default_params with data.wasm as composite
}
