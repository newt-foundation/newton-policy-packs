package pharos_safe_mode

import future.keywords

default allow := false

t := data.params

# Phase 0 § Stream B namespacing — see wrapping_test.rego.
v := data.wasm.pharos_safe_mode

# Fields the oracle reports as `null` when Pharos has nothing to say. `null` is
# deliberately distinct from `0`: a null stress score means "not reported", a
# zero score would be a genuine all-clear. Naming one in
# `deny_on_missing_fields` asks for the former to block rather than fail soft.
nullable_fields := {
	"stress_score": v.stress_score,
	"data_age_seconds": v.data_age_seconds,
}

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

# Named `safe_mode_on_*`, not `deny_on_*`: an active depeg ENGAGES safe mode, it
# does not deny outright. Exposure-reducing calls stay permitted — that is the
# graduated response this pack exists for. (`pharos_treasury` has a genuinely
# denying `deny_on_active_depeg`; the two are deliberately named apart.)
safe_mode if {
	t.safe_mode_on_active_depeg
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

# Keyed by function name, because swap ABIs disagree on where the destination
# token sits: `swap(tokenIn, tokenOut, amt)` is index 1, while a Curve-style
# `exchange(i, j, dx)` has no address argument at all and belongs unmapped.
swap_destination_index := t.swap_destination_arg_index[fn]

# Undefined when the index is unmapped or out of range, which correctly fails
# closed rather than treating "no destination" as an approved destination.
swap_destination := lower(input.decoded_function_arguments[swap_destination_index])

# Named helper for the same reason as arkham_counterparty's `valid_avg_multiple`:
# OPA hoists the ref out of a bare `not t.swap_destination_arg_index[fn]`, so an
# unmapped function would leave the rule undefined rather than negating to true.
# `is_number` also keeps a legitimate index of `0` valid.
has_swap_index if is_number(swap_destination_index)

swap_destination_approved if {
	some asset in t.approved_safe_assets
	lower(asset) == swap_destination
}

# --- deny rules ------------------------------------------------------------
#
# `deny` is the single source of truth for every rule in this policy. `allow`
# below consumes it; there is no parallel set of positive helper rules to drift
# out of sync with these.

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

# A swap function the curator listed but never mapped an index for cannot be
# evaluated at all, so it denies outright rather than only under safe mode.
deny contains "missing_swap_destination_index" if {
	is_swap
	not has_swap_index
}

deny contains "stale_data" if {
	v.data_age_seconds != null
	v.data_age_seconds > t.max_data_age_seconds
}

# A threshold the curator configured is worth nothing if the oracle never
# reports the value it applies to. A null `stress_score` in particular means
# safe mode can only ever engage via the depeg branch.
#
# Opt-in PER FIELD rather than one blanket switch. A provider that never
# populates a given field would otherwise force the curator to choose between
# requiring the field they actually care about and denying every transaction.
# An empty list is the fail-soft default.
deny contains sprintf("missing_%v", [name]) if {
	some name in t.deny_on_missing_fields
	nullable_fields[name] == null
}

# --- allow -----------------------------------------------------------------

# `allow` is the ONLY on-chain entrypoint — scripts/upload.sh derives
# `<package>.allow` and nothing else is evaluated.
#
# The groundedness probes are load-bearing, not decoration: `is_boolean(v.depeg_active)`
# grounds the oracle payload and `is_string(fn)` grounds the intent. Every deny
# rule silent-skips on an undefined field, so an error envelope or a missing
# intent yields an EMPTY deny set and a bare `count(deny) == 0` would fail OPEN.
#
# Note what is deliberately absent: there is no blanket stress ceiling that
# denies everything. Withdrawals and redemptions stay permitted at any stress
# level — a graduated response, not a protocol-wide pause.
allow if {
	not v.error
	is_boolean(v.depeg_active)
	is_string(fn)
	count(deny) == 0
}
