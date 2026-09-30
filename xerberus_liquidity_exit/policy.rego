package xerberus_liquidity_exit

import future.keywords

default allow := false

t := data.params

# Phase 0 § Stream B namespacing — see wrapping_test.rego.
v := data.wasm.xerberus_liquidity_exit

# --- well-formedness ---------------------------------------------------------
#
# Every field a deny rule reads must be present and typed. An error envelope,
# an empty slot, or a quote Xerberus could not price leaves these undefined or
# null, and a bare `count(deny) == 0` would then fail OPEN.
well_formed if {
	is_string(v.token)
	is_number(v.days_to_exit)
	is_number(v.max_sale_per_day_usd)
	is_number(v.impact_band_pct)
	is_boolean(v.is_stale)
	is_number(v.data_age_seconds)
}

# Addresses the intent touches: the call target plus every decoded argument.
# `contains` rather than equality so an address nested inside a tuple or array
# argument (rendered as one string) still matches.
intent_mentions(addr) if lower(input.to) == addr

intent_mentions(addr) if {
	some arg in input.decoded_function_arguments
	is_string(arg)
	contains(lower(arg), addr)
}

# --- deny rules ----------------------------------------------------------------

deny contains "oracle_error" if v.error

deny contains "malformed_oracle_output" if {
	not v.error
	not well_formed
}

# Xerberus's own freshness verdict.
deny contains "stale_data" if {
	t.deny_on_stale
	v.is_stale == true
}

# Our own freshness bound, measured from the data window Xerberus answered from.
deny contains "data_too_old" if v.data_age_seconds > t.max_data_age_seconds

# The caller pinned a window and Xerberus answered from a different one.
deny contains "window_not_honored" if v.window_honored == false

deny contains "exit_too_slow" if v.days_to_exit > t.max_days_to_exit

deny contains "impact_band_exceeded" if v.impact_band_pct > t.max_impact_band_pct

deny contains "no_exit_liquidity" if {
	is_number(v.max_sale_per_day_usd)
	v.max_sale_per_day_usd <= 0
}

# Binds the quote to the transaction: evidence for one token must not
# authorise an intent moving another.
deny contains "token_not_in_intent" if {
	t.require_token_in_intent
	is_string(v.token)
	not intent_mentions(lower(v.token))
}

# --- allow -------------------------------------------------------------------

# `allow` is the ONLY on-chain entrypoint.
allow if {
	not v.error
	well_formed
	count(deny) == 0
}
