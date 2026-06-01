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

allow if count(deny) == 0
