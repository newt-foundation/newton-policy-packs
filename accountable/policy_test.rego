package accountable_dvn_attestation_test

import data.accountable_dvn_attestation

default_params := {
    "proof_max_age_seconds": 86400,
    "min_verifiability_rung": 4,
    "max_nav_deviation_pct": 0.5,
    "deny_on_carry_forward_proof": true,
    "require_roster_membership": true,
    "min_success_ratio": 0.9,
}

clean_data := {
    "venue": "example-venue",
    "verifiability": 5,
    "attested_value": 1000000,
    "onchain_price": 1000000,
    "nav_deviation_pct": 0,
    "snapshot_timestamp": 1000,
    "snapshot_age_seconds": 60,
    "snapshot_status": "ok",
    "carry_forward": false,
    "on_roster": true,
    "success_count": 98,
    "total_count": 100,
    "success_ratio": 0.98,
    "timestamp": 123456,
}

# Phase 0 § Stream B namespacing: policy.rego reads from
# data.wasm.accountable.<field>, so fixtures wrap the inner shape under the
# `accountable` key, matching redstone/chainalysis test conventions.
wrap(inner) := {"accountable": inner}

with_data(overrides) := wrap(object.union(clean_data, overrides))

test_allow_when_all_clean if {
    d := wrap(clean_data)
    accountable_dvn_attestation.allow with data.params as default_params with data.wasm as d
    count(accountable_dvn_attestation.deny) == 0 with data.params as default_params with data.wasm as d
}

# --- Rule 1: freshness ------------------------------------------------------

test_deny_proof_stale if {
    d := with_data({"snapshot_age_seconds": 999999})
    "accountable_proof_stale" in accountable_dvn_attestation.deny with data.params as default_params with data.wasm as d
    not accountable_dvn_attestation.allow with data.params as default_params with data.wasm as d
}

test_allow_just_inside_freshness_window if {
    d := with_data({"snapshot_age_seconds": 86400})
    not "accountable_proof_stale" in accountable_dvn_attestation.deny with data.params as default_params with data.wasm as d
    accountable_dvn_attestation.allow with data.params as default_params with data.wasm as d
}

test_deny_carry_forward_proof if {
    d := with_data({"carry_forward": true})
    "accountable_carry_forward_proof" in accountable_dvn_attestation.deny with data.params as default_params with data.wasm as d
    not accountable_dvn_attestation.allow with data.params as default_params with data.wasm as d
}

test_carry_forward_allowed_when_flag_disabled if {
    p := object.union(default_params, {"deny_on_carry_forward_proof": false})
    d := with_data({"carry_forward": true})
    not "accountable_carry_forward_proof" in accountable_dvn_attestation.deny with data.params as p with data.wasm as d
    accountable_dvn_attestation.allow with data.params as p with data.wasm as d
}

test_deny_snapshot_not_ok if {
    d := with_data({"snapshot_status": "skipped"})
    "accountable_snapshot_not_ok" in accountable_dvn_attestation.deny with data.params as default_params with data.wasm as d
    not accountable_dvn_attestation.allow with data.params as default_params with data.wasm as d
}

# --- Rule 2: verifiability floor --------------------------------------------

test_deny_verifiability_below_floor if {
    d := with_data({"verifiability": 2})
    "accountable_verifiability_below_floor" in accountable_dvn_attestation.deny with data.params as default_params with data.wasm as d
    not accountable_dvn_attestation.allow with data.params as default_params with data.wasm as d
}

test_allow_verifiability_exactly_at_floor if {
    d := with_data({"verifiability": 4})
    not "accountable_verifiability_below_floor" in accountable_dvn_attestation.deny with data.params as default_params with data.wasm as d
    accountable_dvn_attestation.allow with data.params as default_params with data.wasm as d
}

# --- Roster admission --------------------------------------------------------

test_deny_not_on_roster if {
    d := with_data({"on_roster": false})
    "accountable_not_on_roster" in accountable_dvn_attestation.deny with data.params as default_params with data.wasm as d
    not accountable_dvn_attestation.allow with data.params as default_params with data.wasm as d
}

test_roster_check_disabled_does_not_deny if {
    p := object.union(default_params, {"require_roster_membership": false})
    d := with_data({"on_roster": false})
    not "accountable_not_on_roster" in accountable_dvn_attestation.deny with data.params as p with data.wasm as d
    accountable_dvn_attestation.allow with data.params as p with data.wasm as d
}

# --- Circuit breaker ---------------------------------------------------------

test_deny_network_degraded if {
    d := with_data({"success_count": 40, "total_count": 100, "success_ratio": 0.4})
    "accountable_network_degraded" in accountable_dvn_attestation.deny with data.params as default_params with data.wasm as d
    not accountable_dvn_attestation.allow with data.params as default_params with data.wasm as d
}

test_deny_when_success_ratio_missing if {
    # total_count == 0 in the oracle means success_ratio is null — no
    # confirmed-healthy signal, so the fail-closed default blocks allow
    # even though no explicit deny reason fires.
    d := with_data({"success_count": 0, "total_count": 0, "success_ratio": null})
    count(accountable_dvn_attestation.deny) == 0 with data.params as default_params with data.wasm as d
    not accountable_dvn_attestation.allow with data.params as default_params with data.wasm as d
}

# --- Rule 3: NAV divergence --------------------------------------------------

test_deny_nav_deviation_above_cap if {
    d := with_data({"nav_deviation_pct": 1.2})
    "accountable_nav_deviation_above_cap" in accountable_dvn_attestation.deny with data.params as default_params with data.wasm as d
    not accountable_dvn_attestation.allow with data.params as default_params with data.wasm as d
}

test_allow_nav_deviation_just_under_cap if {
    d := with_data({"nav_deviation_pct": 0.49})
    not "accountable_nav_deviation_above_cap" in accountable_dvn_attestation.deny with data.params as default_params with data.wasm as d
    accountable_dvn_attestation.allow with data.params as default_params with data.wasm as d
}

# --- Fail-closed on absent / malformed proof --------------------------------

test_deny_on_oracle_error if {
    not accountable_dvn_attestation.allow with data.params as default_params with data.wasm as wrap({"error": "oracle failed"})
}

test_deny_on_empty_payload if {
    not accountable_dvn_attestation.allow with data.params as default_params with data.wasm as wrap({})
}

test_deny_on_partial_payload if {
    # verifiability present, everything else missing (e.g. a proof that
    # never arrived past the first field) — must not fall through to allow.
    d := wrap({"verifiability": 6})
    not accountable_dvn_attestation.allow with data.params as default_params with data.wasm as d
}

# --- Multiple simultaneous denies -------------------------------------------

test_multiple_denies_do_not_fail_open if {
    d := with_data({
        "snapshot_age_seconds": 999999,
        "verifiability": 1,
        "on_roster": false,
        "nav_deviation_pct": 5,
        "carry_forward": true,
    })
    deny := accountable_dvn_attestation.deny with data.params as default_params with data.wasm as d
    "accountable_proof_stale" in deny
    "accountable_verifiability_below_floor" in deny
    "accountable_not_on_roster" in deny
    "accountable_nav_deviation_above_cap" in deny
    "accountable_carry_forward_proof" in deny
    count(deny) >= 5
    not accountable_dvn_attestation.allow with data.params as default_params with data.wasm as d
}
