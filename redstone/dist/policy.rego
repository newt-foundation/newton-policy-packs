package redstone_oracle_divergence

import future.keywords

default allow := false

t := data.params

# Phase 0 § Stream B namespacing: every pack's WASM output is wrapped under
# its `PACK_ID` key by `policy.js`'s `wrapOutput("redstone", ...)` so the
# AVS-side shallow `merge_jsons` composes cleanly across packs.
v := data.wasm.redstone

deny contains "redstone_feed_stale" if v.redstone_feed_age_seconds > t.max_feed_age_seconds

deny contains "divergence_above_hard_cap" if v.divergence_bp >= t.deny_bp

deny contains "divergence_sustained" if {
    t.enable_sustained_check
    v.prev_snapshot_present
    v.divergence_bp >= t.warn_bp
    v.prev_divergence_bp >= t.warn_bp
    v.sustained_seconds >= t.deny_sustained_seconds
}

allow if {
    v.redstone_feed_age_seconds <= t.max_feed_age_seconds
    v.divergence_bp < t.deny_bp
    not divergence_sustained_blocks
}

divergence_sustained_blocks if {
    t.enable_sustained_check
    v.prev_snapshot_present
    v.divergence_bp >= t.warn_bp
    v.prev_divergence_bp >= t.warn_bp
    v.sustained_seconds >= t.deny_sustained_seconds
}
