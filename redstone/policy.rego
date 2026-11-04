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

# Rego orders null below every number, so `null <= 300` holds. The oracle
# serializes a NaN price or timestamp as null, so every field compared here must
# be a number first.
allow if {
    is_number(v.redstone_feed_age_seconds)
    is_number(v.divergence_bp)
    is_number(v.sustained_seconds)
    v.redstone_feed_age_seconds <= t.max_feed_age_seconds
    v.divergence_bp < t.deny_bp
    not divergence_sustained_blocks
}

# With a previous snapshot the sustained check needs its divergence; a null one
# would make the comparisons below fail and wave the check through.
divergence_sustained_blocks if {
    t.enable_sustained_check
    v.prev_snapshot_present
    not is_number(v.prev_divergence_bp)
}

divergence_sustained_blocks if {
    t.enable_sustained_check
    v.prev_snapshot_present
    v.divergence_bp >= t.warn_bp
    v.prev_divergence_bp >= t.warn_bp
    v.sustained_seconds >= t.deny_sustained_seconds
}
