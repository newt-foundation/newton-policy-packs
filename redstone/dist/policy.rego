package redstone_oracle_divergence

import future.keywords

default allow := false

t := data.params
v := data.wasm

deny contains "redstone_feed_stale" if v.redstone_feed_age_seconds > t.max_feed_age_seconds

deny contains "divergence_above_hard_cap" if v.divergence_bp >= t.deny_bp

deny contains "divergence_sustained" if {
    t.enable_sustained_check
    v.prev_snapshot_present
    v.divergence_bp >= t.warn_bp
    v.prev_divergence_bp >= t.warn_bp
    v.sustained_seconds >= t.deny_sustained_seconds
}

allow if count(deny) == 0
