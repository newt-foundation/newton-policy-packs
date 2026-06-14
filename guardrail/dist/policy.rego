package guardrail_protocol_monitor

import future.keywords

default allow := false

t := data.params

# Phase 0 § Stream B namespacing: every pack's WASM output is wrapped under
# its `PACK_ID` key by `policy.js`'s `wrapOutput("guardrail", ...)` so the
# AVS-side shallow `merge_jsons` composes cleanly across packs.
v := data.wasm.guardrail

deny contains "guardrail_active_alert" if {
    t.deny_on_active_alert
    some s in v.alert_severities
    s in t.deny_alert_severities
}

deny contains "guardrail_health_below_floor" if {
    v.health_available
    v.health_score < t.min_health_score
}

deny contains "guardrail_alert_stale_data" if {
    v.oldest_alert_age_seconds != null
    v.oldest_alert_age_seconds > t.max_alert_age_seconds
}

# When the operator requires health, missing health data is itself a deny.
# Without this rule, health endpoint outages (policy.js:67/113 set
# health_available=false on HTTP / parse failures) silently fail open.
deny contains "guardrail_health_unavailable" if {
    t.require_health
    not v.health_available
}

allow if {
    active_alert_ok
    health_ok
    alert_age_ok
}

active_alert_ok if not t.deny_on_active_alert
active_alert_ok if {
    t.deny_on_active_alert
    every s in v.alert_severities {
        not s in t.deny_alert_severities
    }
}

health_ok if not t.require_health
health_ok if {
    t.require_health
    v.health_available == true
    v.health_score >= t.min_health_score
}

alert_age_ok if v.oldest_alert_age_seconds == null
alert_age_ok if v.oldest_alert_age_seconds <= t.max_alert_age_seconds
