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

# Tokens currently outside their expected peg range must be denied even
# when there are zero discrete depeg events / streak / staleness — that
# was the silent fail-open prior to this rule.
deny contains "outside_expected_range" if v.within_expected_range == false

deny contains "abs_dev_above_max" if {
    v.abs_dev_clean != null
    v.abs_dev_clean > t.max_abs_dev_pct
}

allow if {
    not collapsed_blocks
    v.recent_depeg_event_count <= t.max_recent_depeg_events
    v.consecutive_days_below_peg <= t.max_consecutive_days_below_peg
    not stale_blocks
    v.within_expected_range == true
    abs_dev_ok
}

collapsed_blocks if {
    t.deny_on_collapsed
    v.is_collapsed
}

stale_blocks if {
    t.deny_on_stale_data
    v.stale
}

abs_dev_ok if v.abs_dev_clean == null
abs_dev_ok if v.abs_dev_clean <= t.max_abs_dev_pct
