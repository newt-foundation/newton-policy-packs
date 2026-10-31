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
	is_number(v.venues_compared_count)
	is_number(v.book_usd)
	is_array(v.unresolved_venues)
	is_array(v.shared_nodes)
	is_boolean(v.shared_nodes_truncated)
	is_boolean(v.is_stale)
	is_number(v.data_age_seconds)
}

# --- shared-node classification ----------------------------------------------

node_types := {lower(n) | some n in t.shared_node_types}

forbidden_nodes := {lower(n) | some n in t.forbidden_shared_nodes}

# A shared node counts once enough of the book's venues lean on it and, when
# the curator lists node types, it is one of them. An empty list means every
# type (token, protocol, oracle, gov, irm, ...).
in_scope(n) if {
	n.venue_count >= t.min_venues_for_shared_node
	count(node_types) == 0
}

in_scope(n) if {
	n.venue_count >= t.min_venues_for_shared_node
	n.node_type in node_types
}

# One upstream node with more of the book's venue exposure behind it than the
# curator tolerates.
exposure_breaches contains n if {
	some n in v.shared_nodes
	in_scope(n)
	n.exposure_usd > t.max_shared_exposure_usd
}

# Share of the book behind one shared node. Cross-multiplied rather than
# divided, and never start a line with `(`: regorus reads it as a call on the
# previous line's term and rejects the policy.
book_share_breaches contains n if {
	v.book_usd > 0
	some n in v.shared_nodes
	in_scope(n)
	n.exposure_usd * 100 > t.max_shared_exposure_pct_of_book * v.book_usd
}

# A shared node whose own Xerberus loss rate is above the limit.
loss_breaches contains n if {
	some n in v.shared_nodes
	in_scope(n)
	n.expected_loss_share > t.max_shared_expected_loss_share
}

forbidden_breaches contains n if {
	some n in v.shared_nodes
	n.venue_count >= t.min_venues_for_shared_node
	n.node in forbidden_nodes
}

unresolved_material contains u if {
	some u in v.unresolved_venues
	u.exposure_usd >= t.material_venue_usd
}

# Reviewer-facing explanation of what tripped. NOT evaluated on-chain; the AVS
# entrypoint is `xerberus_common_cause.allow` only.
shared_risks contains detail if {
	some n in exposure_breaches
	detail := sprintf("%v (%v) shared by %v venues, $%v of the book behind it", [n.label, n.node, n.venue_count, round(n.exposure_usd)])
}

shared_risks contains detail if {
	some n in book_share_breaches
	detail := sprintf("%v (%v) shared by %v venues, $%v of a $%v book behind it", [n.label, n.node, n.venue_count, round(n.exposure_usd), round(v.book_usd)])
}

shared_risks contains detail if {
	some n in loss_breaches
	detail := sprintf("%v (%v) shared by %v venues has expected loss share %v", [n.label, n.node, n.venue_count, n.expected_loss_share])
}

shared_risks contains detail if {
	some n in forbidden_breaches
	detail := sprintf("forbidden node %v shared by %v venues", [n.node, n.venue_count])
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

deny contains "shared_exposure_limit" if count(exposure_breaches) > 0

deny contains "shared_book_share_limit" if count(book_share_breaches) > 0

deny contains "shared_loss_limit" if count(loss_breaches) > 0

deny contains "forbidden_shared_node" if count(forbidden_breaches) > 0

deny contains "unresolved_material_venue" if {
	t.deny_on_unresolved
	count(unresolved_material) > 0
}

# Xerberus ranks shared nodes by breadth, so a truncated list can drop a node
# that few venues share but that carries much of the book.
deny contains "shared_nodes_truncated" if {
	t.deny_on_truncated
	v.shared_nodes_truncated == true
}

# Cross-venue analysis needs at least two venues to compare; fewer means the
# checks above had nothing to find, not that there was nothing there.
deny contains "insufficient_venues" if v.venues_compared_count < t.min_venues_compared

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
