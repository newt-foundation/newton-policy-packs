package webacy_depeg_risk_wrapping_test

import data.webacy_depeg_risk

# Phase 0 § Stream B Rego shape test for webacy.
#
# Locks the namespacing contract: the policy now reads from
# `data.wasm.webacy.<field>`, NOT `data.wasm.<field>`. Mirrors
# `policy.js`'s `wrapOutput("webacy", ...)` envelope.
#
# Per-pack negative-shape pattern: webacy uses pure silent-skip (every
# deny rule has explicit precondition or comparison that fails-skip on
# undefined `v.<field>`). Same shape as
# vaultsfyi/balancer/chainalysis/redstone. Flat-input assertion is
# `count(deny) == 0`.

default_params := {
    "deny_on_collapsed": true,
    "max_recent_depeg_events": 0,
    "max_consecutive_days_below_peg": 1,
    "deny_on_stale_data": true,
    "max_abs_dev_pct": 0.005,
}

clean_inner := {
    "address": "0x0000000000000000000000000000000000000001",
    "chain": "eth",
    "symbol": "USDT",
    "is_collapsed": false,
    "lookback_hours": 168,
    "recent_depeg_event_count": 0,
    "max_recent_deviation_pct": 0,
    "consecutive_days_below_peg": 0,
    "within_expected_range": true,
    "abs_dev_clean": 0.001,
    "stale": false,
}

namespaced(overrides) := {"webacy": object.union(clean_inner, overrides)}

test_namespaced_allow_when_clean if {
    webacy_depeg_risk.allow with data.params as default_params with data.wasm as namespaced({})
    count(webacy_depeg_risk.deny) == 0 with data.params as default_params with data.wasm as namespaced({})
}

test_namespaced_deny_token_collapsed if {
    "token_collapsed" in webacy_depeg_risk.deny
        with data.params as default_params
        with data.wasm as namespaced({"is_collapsed": true})
}

test_namespaced_deny_recent_depeg_events if {
    "recent_depeg_events" in webacy_depeg_risk.deny
        with data.params as default_params
        with data.wasm as namespaced({"recent_depeg_event_count": 2})
}

test_namespaced_deny_consecutive_days_below_peg if {
    "consecutive_days_below_peg" in webacy_depeg_risk.deny
        with data.params as default_params
        with data.wasm as namespaced({"consecutive_days_below_peg": 5})
}

test_namespaced_deny_stale_oracle_data if {
    "stale_oracle_data" in webacy_depeg_risk.deny
        with data.params as default_params
        with data.wasm as namespaced({"stale": true})
}

test_namespaced_deny_outside_expected_range if {
    "outside_expected_range" in webacy_depeg_risk.deny
        with data.params as default_params
        with data.wasm as namespaced({"within_expected_range": false})
}

test_namespaced_deny_abs_dev_above_max if {
    "abs_dev_above_max" in webacy_depeg_risk.deny
        with data.params as default_params
        with data.wasm as namespaced({"abs_dev_clean": 0.01})
}

# Negative shape test: a flat (un-namespaced) `data.wasm` MUST NOT trigger
# any deny rule. Every webacy rule has explicit preconditions or
# comparisons that silent-skip on undefined `v.<field>`. The
# `outside_expected_range` rule (`v.within_expected_range == false`) also
# silent-skips because `undefined == false` is ungroundable.
test_flat_input_does_not_trigger_namespaced_rules if {
    flat_with_violations := object.union(clean_inner, {
        "is_collapsed": true,
        "recent_depeg_event_count": 99,
        "consecutive_days_below_peg": 99,
        "stale": true,
        "within_expected_range": false,
        "abs_dev_clean": 0.99,
    })
    count(webacy_depeg_risk.deny) == 0
        with data.params as default_params
        with data.wasm as flat_with_violations
}

# Error envelope.
test_namespaced_error_does_not_allow if {
    not webacy_depeg_risk.allow
        with data.params as default_params
        with data.wasm as {"webacy": {"error": "oracle failed"}}
}

# Fail-closed under malformed/empty namespaced output.
test_namespaced_empty_pack_slot_does_not_allow if {
    not webacy_depeg_risk.allow
        with data.params as default_params
        with data.wasm as {"webacy": {}}
}

# Cross-pack composition: webacy MUST only read its own slice.
test_other_pack_keys_do_not_interfere if {
    composite := {
        "webacy": clean_inner,
        "vaultsfyi": {
            "is_corrupted": true,
            "tvl_drawdown_24h_pct": 999,
        },
        "chainalysis": {
            "sanctioned": true,
            "is_high_risk": true,
        },
    }
    webacy_depeg_risk.allow with data.params as default_params with data.wasm as composite
    count(webacy_depeg_risk.deny) == 0 with data.params as default_params with data.wasm as composite
}
