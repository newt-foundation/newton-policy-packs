package webacy_depeg_risk

import future.keywords

default allow := false

t := data.params
v := data.wasm

deny contains "token_collapsed" if {
    t.deny_on_collapsed
    v.is_collapsed
}

deny contains "recent_depeg_events" if v.recent_depeg_event_count > t.max_recent_depeg_events

deny contains "consecutive_days_below_peg" if v.consecutive_days_below_peg > t.max_consecutive_days_below_peg

deny contains "stale_oracle_data" if {
    t.deny_on_stale_data
    v.stale
}

allow if {
    not collapsed_blocks
    v.recent_depeg_event_count <= t.max_recent_depeg_events
    v.consecutive_days_below_peg <= t.max_consecutive_days_below_peg
    not stale_blocks
}

collapsed_blocks if {
    t.deny_on_collapsed
    v.is_collapsed
}

stale_blocks if {
    t.deny_on_stale_data
    v.stale
}
