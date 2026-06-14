package guardrail_protocol_monitor_test

import data.guardrail_protocol_monitor

default_params := {
    "deny_on_active_alert": true,
    "deny_alert_severities": ["critical", "high"],
    "max_alert_age_seconds": 86400,
    "min_health_score": 60,
    "require_health": true,
}

clean_data := {
    "active_alert_count": 0,
    "alert_severities": [],
    "oldest_alert_age_seconds": null,
    "health_available": true,
    "health_score": 95,
}

# Phase 0 § Stream B namespacing: `policy.rego` now reads from
# `data.wasm.guardrail.<field>`, so test fixtures wrap the inner shape
# under the `guardrail` key. `wrapping_test.rego` covers the cross-pack
# composition surface; this file keeps the pre-existing rule-by-rule
# coverage intact under the new namespacing.
wrap(inner) := {"guardrail": inner}

with_data(overrides) := wrap(object.union(clean_data, overrides))

test_allow_when_all_clean if {
    d := wrap(clean_data)
    guardrail_protocol_monitor.allow with data.params as default_params with data.wasm as d
    count(guardrail_protocol_monitor.deny) == 0 with data.params as default_params with data.wasm as d
}

test_deny_active_critical_alert if {
    d := with_data({"active_alert_count": 1, "alert_severities": ["critical"], "oldest_alert_age_seconds": 60})
    "guardrail_active_alert" in guardrail_protocol_monitor.deny with data.params as default_params with data.wasm as d
    not guardrail_protocol_monitor.allow with data.params as default_params with data.wasm as d
}

test_active_low_severity_alert_does_not_deny if {
    d := with_data({"active_alert_count": 1, "alert_severities": ["low"], "oldest_alert_age_seconds": 60})
    not "guardrail_active_alert" in guardrail_protocol_monitor.deny with data.params as default_params with data.wasm as d
    guardrail_protocol_monitor.allow with data.params as default_params with data.wasm as d
}

test_active_alert_disabled_param if {
    p := object.union(default_params, {"deny_on_active_alert": false})
    d := with_data({"active_alert_count": 1, "alert_severities": ["critical"], "oldest_alert_age_seconds": 60})
    not "guardrail_active_alert" in guardrail_protocol_monitor.deny with data.params as p with data.wasm as d
    guardrail_protocol_monitor.allow with data.params as p with data.wasm as d
}

test_deny_health_below_floor if {
    d := with_data({"health_score": 30})
    "guardrail_health_below_floor" in guardrail_protocol_monitor.deny with data.params as default_params with data.wasm as d
    not guardrail_protocol_monitor.allow with data.params as default_params with data.wasm as d
}

test_health_unavailable_denies_when_required if {
    d := with_data({"health_available": false, "health_score": null})
    "guardrail_health_unavailable" in guardrail_protocol_monitor.deny with data.params as default_params with data.wasm as d
    not guardrail_protocol_monitor.allow with data.params as default_params with data.wasm as d
}

test_health_unavailable_allowed_when_not_required if {
    p := object.union(default_params, {"require_health": false})
    d := with_data({"health_available": false, "health_score": null})
    not "guardrail_health_unavailable" in guardrail_protocol_monitor.deny with data.params as p with data.wasm as d
    not "guardrail_health_below_floor" in guardrail_protocol_monitor.deny with data.params as p with data.wasm as d
    guardrail_protocol_monitor.allow with data.params as p with data.wasm as d
}

test_deny_stale_alert_data if {
    d := with_data({"active_alert_count": 1, "alert_severities": ["info"], "oldest_alert_age_seconds": 999999})
    "guardrail_alert_stale_data" in guardrail_protocol_monitor.deny with data.params as default_params with data.wasm as d
    not guardrail_protocol_monitor.allow with data.params as default_params with data.wasm as d
}

test_oldest_alert_age_null_does_not_deny if {
    d := with_data({"active_alert_count": 0, "alert_severities": [], "oldest_alert_age_seconds": null})
    not "guardrail_alert_stale_data" in guardrail_protocol_monitor.deny with data.params as default_params with data.wasm as d
    guardrail_protocol_monitor.allow with data.params as default_params with data.wasm as d
}

test_multiple_denies_do_not_fail_open if {
    d := with_data({
        "active_alert_count": 2,
        "alert_severities": ["critical"],
        "oldest_alert_age_seconds": 999999,
        "health_score": 10,
    })
    deny := guardrail_protocol_monitor.deny with data.params as default_params with data.wasm as d
    "guardrail_active_alert" in deny
    "guardrail_health_below_floor" in deny
    "guardrail_alert_stale_data" in deny
    count(deny) >= 3
    not guardrail_protocol_monitor.allow with data.params as default_params with data.wasm as d
}

test_deny_on_oracle_error if {
    not guardrail_protocol_monitor.allow with data.params as default_params with data.wasm as wrap({"error": "oracle failed"})
}

test_deny_on_empty_payload if {
    not guardrail_protocol_monitor.allow with data.params as default_params with data.wasm as wrap({})
}
