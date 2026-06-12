package redstone_oracle_divergence_test

import data.redstone_oracle_divergence

default_params := {
    "warn_bp": 50,
    "deny_bp": 100,
    "deny_sustained_seconds": 1800,
    "max_feed_age_seconds": 300,
    "enable_sustained_check": false,
}

clean_data := {
    "divergence_bp": 10,
    "redstone_feed_age_seconds": 30,
    "prev_snapshot_present": false,
    "prev_divergence_bp": null,
    "sustained_seconds": 0,
}

with_data(overrides) := object.union(clean_data, overrides)

test_allow_when_all_clean if {
    redstone_oracle_divergence.allow with data.params as default_params with data.wasm as clean_data
    count(redstone_oracle_divergence.deny) == 0 with data.params as default_params with data.wasm as clean_data
}

test_deny_redstone_feed_stale if {
    d := with_data({"redstone_feed_age_seconds": 9999})
    "redstone_feed_stale" in redstone_oracle_divergence.deny with data.params as default_params with data.wasm as d
    not redstone_oracle_divergence.allow with data.params as default_params with data.wasm as d
}

test_deny_divergence_above_hard_cap if {
    d := with_data({"divergence_bp": 150})
    "divergence_above_hard_cap" in redstone_oracle_divergence.deny with data.params as default_params with data.wasm as d
    not redstone_oracle_divergence.allow with data.params as default_params with data.wasm as d
}

test_warn_band_alone_does_not_deny if {
    d := with_data({"divergence_bp": 75})
    not "divergence_above_hard_cap" in redstone_oracle_divergence.deny with data.params as default_params with data.wasm as d
    not "divergence_sustained" in redstone_oracle_divergence.deny with data.params as default_params with data.wasm as d
    redstone_oracle_divergence.allow with data.params as default_params with data.wasm as d
}

test_deny_divergence_sustained if {
    p := object.union(default_params, {"enable_sustained_check": true})
    d := with_data({
        "divergence_bp": 75,
        "prev_snapshot_present": true,
        "prev_divergence_bp": 80,
        "sustained_seconds": 1900,
    })
    "divergence_sustained" in redstone_oracle_divergence.deny with data.params as p with data.wasm as d
    not redstone_oracle_divergence.allow with data.params as p with data.wasm as d
}

test_sustained_check_disabled_does_not_deny if {
    d := with_data({
        "divergence_bp": 75,
        "prev_snapshot_present": true,
        "prev_divergence_bp": 80,
        "sustained_seconds": 1900,
    })
    not "divergence_sustained" in redstone_oracle_divergence.deny with data.params as default_params with data.wasm as d
    redstone_oracle_divergence.allow with data.params as default_params with data.wasm as d
}

test_sustained_check_no_prev_snapshot_does_not_deny if {
    p := object.union(default_params, {"enable_sustained_check": true})
    d := with_data({
        "divergence_bp": 75,
        "prev_snapshot_present": false,
        "sustained_seconds": 1900,
    })
    not "divergence_sustained" in redstone_oracle_divergence.deny with data.params as p with data.wasm as d
    redstone_oracle_divergence.allow with data.params as p with data.wasm as d
}

test_sustained_below_window_does_not_deny if {
    p := object.union(default_params, {"enable_sustained_check": true})
    d := with_data({
        "divergence_bp": 75,
        "prev_snapshot_present": true,
        "prev_divergence_bp": 80,
        "sustained_seconds": 60,
    })
    not "divergence_sustained" in redstone_oracle_divergence.deny with data.params as p with data.wasm as d
    redstone_oracle_divergence.allow with data.params as p with data.wasm as d
}

test_multiple_denies_do_not_fail_open if {
    p := object.union(default_params, {"enable_sustained_check": true})
    d := with_data({
        "divergence_bp": 200,
        "redstone_feed_age_seconds": 9999,
        "prev_snapshot_present": true,
        "prev_divergence_bp": 200,
        "sustained_seconds": 9999,
    })
    deny := redstone_oracle_divergence.deny with data.params as p with data.wasm as d
    "divergence_above_hard_cap" in deny
    "redstone_feed_stale" in deny
    "divergence_sustained" in deny
    count(deny) >= 3
    not redstone_oracle_divergence.allow with data.params as p with data.wasm as d
}

test_deny_on_oracle_error if {
    not redstone_oracle_divergence.allow with data.params as default_params with data.wasm as {"error": "oracle failed"}
}

test_deny_on_empty_payload if {
    not redstone_oracle_divergence.allow with data.params as default_params with data.wasm as {}
}
