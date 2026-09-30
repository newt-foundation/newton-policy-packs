package xerberus_portfolio_what_if

import future.keywords

default allow := false

t := data.params

# Phase 0 § Stream B namespacing — see wrapping_test.rego.
v := data.wasm.xerberus_what_if

# --- well-formedness ---------------------------------------------------------
#
# Every field a deny rule reads must be present and typed, or an error envelope
# would produce an empty deny set and fail OPEN.
well_formed if {
	is_array(v.wallets)
	is_boolean(v.is_risk_reducing)
	is_number(v.post_largest_token_pct)
	is_number(v.pre_largest_token_pct)
	is_number(v.hhi_delta)
	is_number(v.ladder_30d_delta_pp)
	is_number(v.slowest_exit_delta_days)
	is_number(v.issues_count)
	is_boolean(v.is_stale)
	is_number(v.data_age_seconds)
}

# Risk-reducing changes (pure removals) may proceed on stale data when the
# curator opts in, so unavailable data never stops the agent de-risking. The
# delta checks below still apply.
stale_exempt if {
	t.allow_stale_when_risk_reducing
	v.is_risk_reducing == true
}

# The simulated portfolio must belong to a party of the transaction: the
# sender (an agent or EOA) or the target (a vault acting on its own book).
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
	not stale_exempt
}

deny contains "data_too_old" if {
	v.data_age_seconds > t.max_data_age_seconds
	not stale_exempt
}

deny contains "window_not_honored" if v.window_honored == false

# Only a change that pushes the largest post-trade position past the limit AND
# grows its share denies, so a trade that trims an already-concentrated book is
# not blocked by the level it is reducing.
deny contains "concentration_limit" if {
	v.post_largest_token_pct > t.max_post_token_share_pct
	v.post_largest_token_pct > v.pre_largest_token_pct
}

deny contains "hhi_delta_limit" if v.hhi_delta > t.max_hhi_delta

deny contains "liquidity_30d_deterioration" if {
	is_number(v.ladder_30d_delta_pp)
	v.ladder_30d_delta_pp < t.min_ladder_30d_delta_pp
}

deny contains "slowest_exit_limit" if v.slowest_exit_delta_days > t.max_slowest_exit_delta_days

deny contains "simulation_issues" if {
	t.deny_on_issues
	v.issues_count > 0
}

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
