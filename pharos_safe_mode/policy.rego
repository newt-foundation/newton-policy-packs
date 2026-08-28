package pharos_safe_mode

import future.keywords

default allow := false

t := data.params

# Phase 0 § Stream B namespacing — see wrapping_test.rego.
v := data.wasm.pharos_safe_mode

# The attested action. Unlike every other pack in this repo, this policy
# reads the INTENT as well as the oracle: a graduated response has to know
# whether the caller is adding exposure or shedding it, and that fact must
# come from the signed intent rather than from anything the oracle asserts.
#
# `input.function.name` is the bare name ("withdraw"); the fully rendered
# signature is `input.decoded_function_signature`. Verified against
# newton-cli 0.5.2 — see this pack's README for the full input shape.
fn := input.function.name

# --- safe-mode trigger -----------------------------------------------------

safe_mode if {
	t.deny_on_active_depeg
	v.depeg_active == true
}

safe_mode if {
	v.stress_score != null
	v.stress_score >= t.safe_mode_stress_threshold
}

# --- action classification -------------------------------------------------

is_reducing if fn in t.exposure_reducing_functions

is_increasing if fn in t.exposure_increasing_functions

is_swap if fn in t.swap_functions

classified if is_reducing

classified if is_increasing

classified if is_swap

# Undefined when the index is out of range, which correctly fails closed
# rather than treating "no destination" as an approved destination.
swap_destination := lower(input.decoded_function_arguments[t.swap_destination_arg_index])

swap_destination_approved if {
	some asset in t.approved_safe_assets
	lower(asset) == swap_destination
}

# --- deny rules ------------------------------------------------------------

# Fail closed on an action the curator has not classified. Without this a
# novel function name would sail past every rule below.
deny contains "unclassified_function" if not classified

deny contains "safe_mode_blocks_exposure_increase" if {
	safe_mode
	is_increasing
}

deny contains "unapproved_swap_destination" if {
	safe_mode
	is_swap
	not swap_destination_approved
}

deny contains "stale_data" if {
	v.data_age_seconds != null
	v.data_age_seconds > t.max_data_age_seconds
}

# --- allow -----------------------------------------------------------------

# Explicit positive conjunction. `is_boolean(v.depeg_active)` grounds the
# oracle payload and `is_string(fn)` grounds the intent, so an error
# envelope or a missing intent fails CLOSED rather than sailing through on
# an empty deny set.
#
# Note what is deliberately absent: there is no blanket stress ceiling that
# denies everything. Withdrawals and redemptions stay permitted at any
# stress level — a graduated response, not a protocol-wide pause.
allow if {
	is_boolean(v.depeg_active)
	is_string(fn)
	classified
	not increase_blocked
	not swap_blocked
	fresh_ok
}

increase_blocked if {
	safe_mode
	is_increasing
}

swap_blocked if {
	safe_mode
	is_swap
	not swap_destination_approved
}

fresh_ok if v.data_age_seconds == null

fresh_ok if v.data_age_seconds <= t.max_data_age_seconds
