package guardrail_protocol_monitor

import future.keywords

default allow := false

t := data.params
v := data.wasm

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

health_ok if v.health_available == false
health_ok if {
    v.health_available == true
    v.health_score >= t.min_health_score
}

alert_age_ok if v.oldest_alert_age_seconds == null
alert_age_ok if v.oldest_alert_age_seconds <= t.max_alert_age_seconds
