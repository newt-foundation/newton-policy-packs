package guardrail_protocol_monitor_wrapping_test

import data.guardrail_protocol_monitor

# Phase 0 § Stream B Rego shape test for guardrail.
#
# Locks the namespacing contract: the policy now reads from
# `data.wasm.guardrail.<field>`, NOT `data.wasm.<field>`. Mirrors
# `policy.js`'s `wrapOutput("guardrail", ...)` envelope.
#
# Per-pack negative-shape pattern: guardrail uses a MIXED pattern. Most
# deny rules have explicit preconditions on `v.<field>` that fail-skip
# when `v` is undefined (silent-skip, like vaultsfyi/balancer/chainalysis).
# But `guardrail_health_unavailable` has the `not v.health_available`
# shape (like blockaid's `not v.simulation_succeeded`) — when `v` is
# undefined and `t.require_health` is true, the AND evaluates true and
# this rule FIRES. That's the correct fail-closed posture for the
# health-unavailable case: a missing pack slot should deny when the
# operator required health. The flat-input assertion below pins this
# specific deny + `not allow`, mirroring blockaid's shape.

default_params := {
    "deny_on_active_alert": true,
    "deny_alert_severities": ["critical", "high"],
    "max_alert_age_seconds": 86400,
    "min_health_score": 60,
    "require_health": true,
}

clean_inner := {
    "active_alert_count": 0,
    "alert_severities": [],
    "oldest_alert_age_seconds": null,
    "health_available": true,
    "health_score": 95,
}

namespaced(overrides) := {"guardrail": object.union(clean_inner, overrides)}

test_namespaced_allow_when_clean if {
    guardrail_protocol_monitor.allow with data.params as default_params with data.wasm as namespaced({})
    count(guardrail_protocol_monitor.deny) == 0 with data.params as default_params with data.wasm as namespaced({})
}

test_namespaced_deny_active_alert if {
    "guardrail_active_alert" in guardrail_protocol_monitor.deny
        with data.params as default_params
        with data.wasm as namespaced({"active_alert_count": 1, "alert_severities": ["critical"]})
}

test_namespaced_deny_health_below_floor if {
    "guardrail_health_below_floor" in guardrail_protocol_monitor.deny
        with data.params as default_params
        with data.wasm as namespaced({"health_score": 30})
}

test_namespaced_deny_health_unavailable if {
    "guardrail_health_unavailable" in guardrail_protocol_monitor.deny
        with data.params as default_params
        with data.wasm as namespaced({"health_available": false, "health_score": null})
}

test_namespaced_deny_alert_stale_data if {
    "guardrail_alert_stale_data" in guardrail_protocol_monitor.deny
        with data.params as default_params
        with data.wasm as namespaced({"active_alert_count": 1, "alert_severities": ["info"], "oldest_alert_age_seconds": 999999})
}

# Negative shape test: a flat (un-namespaced) `data.wasm` does NOT allow,
# because the rules read from `.guardrail.<field>` and the flat fixture
# has no `.guardrail` key. Most deny rules silent-skip on undefined `v`,
# but `guardrail_health_unavailable` fires because `t.require_health` is
# true and `not v.health_available` is true on undefined `v`. The
# load-bearing claim is that bare-top-level field reads do NOT contribute
# to allow: even though the flat fixture has `health_available: true` at
# the top level, the policy reads through `v := data.wasm.guardrail` so
# allow MUST fail.
test_flat_input_fails_allow if {
    flat_clean := clean_inner
    deny := guardrail_protocol_monitor.deny
        with data.params as default_params
        with data.wasm as flat_clean
    # Pin the deny shape: under undefined `v` with `require_health=true`,
    # `guardrail_health_unavailable` MUST fire (the `not v.health_available`
    # rule body grounds true on undefined). A regression where this rule
    # silent-skips on undefined would still satisfy `not allow` (default
    # false) but would NOT satisfy this assertion.
    "guardrail_health_unavailable" in deny
    # Stronger pin: ONLY this rule fires under flat input (others
    # silent-skip on undefined `v`). A regression where another rule
    # accidentally starts firing on undefined would change this count.
    count(deny) == 1
    not guardrail_protocol_monitor.allow
        with data.params as default_params
        with data.wasm as flat_clean
}

# Error envelope: composite Rego can selectively deny on
# `data.wasm.<pack-id>.error`. Pin that the namespaced error envelope at
# least does not erroneously satisfy `allow`.
test_namespaced_error_does_not_allow if {
    not guardrail_protocol_monitor.allow
        with data.params as default_params
        with data.wasm as {"guardrail": {"error": "oracle failed"}}
}

# Fail-closed under malformed/empty namespaced output.
test_namespaced_empty_pack_slot_does_not_allow if {
    not guardrail_protocol_monitor.allow
        with data.params as default_params
        with data.wasm as {"guardrail": {}}
}

# Cross-pack composition smoke: when `data.wasm` carries multiple packs
# under different top-level keys, guardrail's rules MUST only read its
# own slice. Stuff `vaultsfyi` and `chainalysis` keys with extreme values
# at sibling depth — guardrail must allow regardless because its `v`
# reads only `data.wasm.guardrail`.
test_other_pack_keys_do_not_interfere if {
    composite := {
        "guardrail": clean_inner,
        "vaultsfyi": {
            "tvl_drawdown_24h_pct": 999,
            "is_corrupted": true,
        },
        "chainalysis": {
            "sanctioned": true,
            "is_high_risk": true,
            "risk_categories": ["mixer"],
        },
    }
    guardrail_protocol_monitor.allow with data.params as default_params with data.wasm as composite
    count(guardrail_protocol_monitor.deny) == 0 with data.params as default_params with data.wasm as composite
}
