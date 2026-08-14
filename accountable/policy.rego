package accountable_dvn_attestation

import future.keywords

# Fail-closed default, matching every other first-party pack in this repo
# (see redstone, chainalysis, webacy): allow is false unless the positive
# `allow` rule below proves the oracle payload is well-formed AND zero
# deny reasons fired. An oracle error, an empty payload, or a proof that
# never arrived all land here, not on a silently-skipped rule.
default allow := false

t := data.params

# Phase 0 § Stream B namespacing: policy.js wraps its output under
# wrapOutput("accountable", ...) so the AVS-side shallow merge composes
# cleanly alongside sibling packs in a composite bundle.
v := data.wasm.accountable

# Parameter names below intentionally match Tempora's own already-published
# mandate vocabulary (proof_max_age_seconds, min_verifiability_rung,
# max_nav_deviation_pct) one-to-one, so wiring this pack into an existing
# aCV bundle is a params-file change, not a rewrite.

# --- Rule 1: freshness window --------------------------------------------
# "A proof must be no older than the window" — same shape as redstone's
# max_feed_age_seconds, generalized from Accountable's own hardcoded
# staleness modifier into a bundle parameter.
deny contains "accountable_proof_stale" if {
    is_number(v.snapshot_age_seconds)
    v.snapshot_age_seconds > t.proof_max_age_seconds
}

# A carry-forward value is a *reused* prior snapshot re-served under a new
# check, not a fresh proof — it can pass the age check above while still
# not being real freshness. Tempora's brief calls this out explicitly, so
# it denies on its own signal rather than folding into the age check.
deny contains "accountable_carry_forward_proof" if {
    t.deny_on_carry_forward_proof
    v.carry_forward == true
}

# A skipped snapshot is not a proof at all, regardless of how old the last
# real one was.
deny contains "accountable_snapshot_not_ok" if {
    is_string(v.snapshot_status)
    v.snapshot_status != "ok"
}

# --- Rule 2: verifiability strength floor --------------------------------
# "A proof must be at least as strong as our floor." Ordinal comparison —
# same shape as chainalysis's risk-enum floor, just numeric here since
# Tempora's own ladder is a 1-6 integer rung, not a labelled enum.
deny contains "accountable_verifiability_below_floor" if {
    is_number(v.verifiability)
    v.verifiability < t.min_verifiability_rung
}

# --- Admission: venue roster ----------------------------------------------
# "Absent from the roster means not investable." Distinct from the
# strength floor: a venue can be well-attested and still not be one
# Accountable's network covers at all.
deny contains "accountable_not_on_roster" if {
    t.require_roster_membership
    v.on_roster == false
}

# --- Circuit breaker: provider degradation --------------------------------
# "If their network degrades, we stop allocating." success_count/total_count
# is Tempora's own field pair for this; deny closed instead of computing on
# a zero-total ratio (see the is_number(v.success_ratio) probe below).
deny contains "accountable_network_degraded" if {
    is_number(v.success_ratio)
    v.success_ratio < t.min_success_ratio
}

# --- Rule 3: divergence ceiling -------------------------------------------
# "An attested value must not diverge from the on-chain price." Same shape
# as redstone's divergence_bp check — two numbers from different origins,
# compared as a percentage instead of basis points since that is the unit
# Tempora's own max_nav_deviation_pct parameter already uses.
deny contains "accountable_nav_deviation_above_cap" if {
    is_number(v.nav_deviation_pct)
    v.nav_deviation_pct > t.max_nav_deviation_pct
}

# allow: requires every field the deny rules above depend on to be
# well-formed (not an error payload, not a missing field from a proof that
# never arrived) AND zero deny reasons. Mirrors the max-ltv-gate /
# chainalysis pattern: probing each field here is load-bearing, not
# decorative — without it a well-formed-looking-but-partial payload (e.g.
# verifiability present, on_roster missing) would fall through to allow.
allow if {
    is_number(v.verifiability)
    is_number(v.snapshot_age_seconds)
    is_string(v.snapshot_status)
    is_boolean(v.carry_forward)
    is_boolean(v.on_roster)
    is_number(v.nav_deviation_pct)
    is_number(v.success_ratio)
    not proof_stale_blocks
    not carry_forward_blocks
    not snapshot_not_ok_blocks
    not verifiability_below_floor_blocks
    not not_on_roster_blocks
    not network_degraded_blocks
    not nav_deviation_above_cap_blocks
}

proof_stale_blocks if {
    is_number(v.snapshot_age_seconds)
    v.snapshot_age_seconds > t.proof_max_age_seconds
}

carry_forward_blocks if {
    t.deny_on_carry_forward_proof
    v.carry_forward == true
}

snapshot_not_ok_blocks if {
    is_string(v.snapshot_status)
    v.snapshot_status != "ok"
}

verifiability_below_floor_blocks if {
    is_number(v.verifiability)
    v.verifiability < t.min_verifiability_rung
}

not_on_roster_blocks if {
    t.require_roster_membership
    v.on_roster == false
}

network_degraded_blocks if {
    is_number(v.success_ratio)
    v.success_ratio < t.min_success_ratio
}

nav_deviation_above_cap_blocks if {
    is_number(v.nav_deviation_pct)
    v.nav_deviation_pct > t.max_nav_deviation_pct
}
