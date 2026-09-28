package xerberus_common_cause

import future.keywords

default allow := false

t := data.params

# Phase 0 § Stream B namespacing — see wrapping_test.rego.
v := data.wasm.xerberus_common_cause

# --- well-formedness ---------------------------------------------------------
#
# Every field a deny rule reads must be present and typed. An error envelope
# leaves the arrays undefined, every set below comes out empty, and a bare
# `count(deny) == 0` would fail OPEN on exactly the payload that most needs to
# fail closed.
well_formed if {
	is_array(v.wallets)
	is_number(v.subjects_compared_count)
	is_number(v.total_exposure_usd)
	is_array(v.unscored_subjects)
	is_array(v.shared_gaps)
	is_array(v.shared_dependencies)
	is_array(v.shared_collateral)
	is_boolean(v.is_stale)
	is_number(v.data_age_seconds)
}

# --- shared-risk classification ---------------------------------------------

gap_classes := {lower(c) | some c in t.gap_failure_classes}

forbidden_dependencies := {lower(d) | some d in t.forbidden_shared_dependencies}

# An empty class list means every failure class counts.
gap_in_scope(_) if count(gap_classes) == 0

gap_in_scope(g) if g.failure_class in gap_classes

# A missing safeguard shared by several venues, carrying more combined exposure
# than the curator tolerates.
gap_breaches contains g if {
	some g in v.shared_gaps
	gap_in_scope(g)
	g.combined_exposure_usd > t.max_shared_gap_exposure_usd
}

dependency_breaches contains d if {
	some d in v.shared_dependencies
	d.target in forbidden_dependencies
	d.subject_count >= t.min_venues_for_shared_dependency
}

# Collateral share is measured against the exposure Xerberus compared, which is
# the book it can see for these wallets.
collateral_breaches contains c if {
	v.total_exposure_usd > 0
	some c in v.shared_collateral
	(c.combined_exposure_usd / v.total_exposure_usd) * 100 > t.max_shared_collateral_pct_of_book
}

unscored_material contains s if {
	some s in v.unscored_subjects
	s.exposure_usd >= t.material_subject_usd
}

# Reviewer-facing explanation of what tripped. NOT evaluated on-chain; the AVS
# entrypoint is `xerberus_common_cause.allow` only.
shared_risks contains detail if {
	some g in gap_breaches
	detail := sprintf("missing safeguard %v (%v) across %v venues, $%v combined", [g.tag, g.failure_class, g.subject_count, g.combined_exposure_usd])
}

shared_risks contains detail if {
	some d in dependency_breaches
	detail := sprintf("forbidden dependency %v shared by %v venues", [d.target, d.subject_count])
}

shared_risks contains detail if {
	some c in collateral_breaches
	detail := sprintf("collateral %v shared by %v venues, $%v combined", [c.symbol, c.subject_count, c.combined_exposure_usd])
}

# The analysed portfolio must belong to a party of the transaction.
wallets_bound_to_intent if {
	some w in v.wallets
	w == lower(input.from)
}

wallets_bound_to_intent if {
	some w in v.wallets
	w == lower(input.to)
}

# --- deny rules ----------------------------------------------------------------

deny contains "oracle_error" if v.error

deny contains "malformed_oracle_output" if {
	not v.error
	not well_formed
}

deny contains "stale_data" if {
	t.deny_on_stale
	v.is_stale == true
}

deny contains "data_too_old" if v.data_age_seconds > t.max_data_age_seconds

deny contains "window_not_honored" if v.window_honored == false

deny contains "shared_gap_limit" if count(gap_breaches) > 0

deny contains "shared_dependency_limit" if count(dependency_breaches) > 0

deny contains "shared_collateral_limit" if count(collateral_breaches) > 0

deny contains "unscored_material_subject" if {
	t.deny_on_unscored
	count(unscored_material) > 0
}

# Cross-venue analysis needs at least two venues to compare; fewer means the
# checks above had nothing to find, not that there was nothing there.
deny contains "insufficient_venues" if v.subjects_compared_count < t.min_subjects_compared

deny contains "wallets_not_bound_to_intent" if {
	t.require_intent_party_in_wallets
	is_array(v.wallets)
	not wallets_bound_to_intent
}

# --- allow -------------------------------------------------------------------

# `allow` is the ONLY on-chain entrypoint.
allow if {
	not v.error
	well_formed
	count(deny) == 0
}
