package arkham_entity_wallet

import future.keywords

default allow := false

t := data.params

# Phase 0 § Stream B namespacing: every pack's WASM output is wrapped under
# its `PACK_ID` key by `policy.js`'s `wrapOutput("arkham_entity", ...)` so the
# AVS-side shallow `merge_jsons` composes cleanly across packs. Field names
# like `tags` and `max_risk_score` are shared with the sibling arkham packs,
# so reading the bare `data.wasm.*` here would silently cross-wire them.
v := data.wasm.arkham_entity

# USD notional of the proposed transfer. Caller-supplied via wasm_args and
# echoed by the oracle, so it is NOT attested — see README.md. Every tier
# comparison below rests on it.
amount := v.transaction_amount_usd

# Fields the oracle reports as `null` when Arkham has nothing to say. `null` is
# deliberately distinct from `0`: a null risk score means "not reported", a zero
# score would be a genuine clean verdict. Naming one in
# `deny_on_missing_fields` asks for the former to block rather than fail soft.
nullable_fields := {
	"attribution_confidence": v.attribution_confidence,
	"max_risk_score": v.max_risk_score,
	"data_age_seconds": v.data_age_seconds,
}

# Destination tags the curator has prohibited outright. A set (not a bare
# boolean) so the deny reason can be traced back to the offending tag.
prohibited_tag_hits contains tag if {
	some tag in v.tags
	tag in t.prohibited_tags
}

# --- deny rules ------------------------------------------------------------
#
# `deny` is the single source of truth for every rule in this policy. `allow`
# below consumes it; there is no parallel set of positive helper rules to drift
# out of sync with these.

deny contains "prohibited_tag" if count(prohibited_tag_hits) > 0

deny contains "no_attribution" if {
	t.deny_on_no_attribution
	v.has_attribution == false
}

deny contains "no_attribution_over_limit" if {
	v.has_attribution == false
	amount > t.tier_unlabelled_max_usd
}

deny contains "unapproved_entity_category" if {
	v.has_attribution == true
	not v.entity_category in t.approved_entity_categories
	amount > t.tier_unlabelled_max_usd
}

deny contains "low_attribution_confidence" if {
	v.attribution_confidence != null
	v.attribution_confidence < t.min_attribution_confidence
}

deny contains "amount_over_verified_tier" if amount > t.tier_verified_max_usd

deny contains "risk_score_above_max" if {
	v.max_risk_score != null
	v.max_risk_score > t.max_risk_score
}

deny contains "stale_data" if {
	v.data_age_seconds != null
	v.data_age_seconds > t.max_data_age_seconds
}

# A threshold the curator configured is worth nothing if the oracle never
# reports the value it applies to.
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
# The groundedness probes are load-bearing, not decoration: every deny rule
# silent-skips on an undefined field, so an error envelope or an empty pack slot
# yields an EMPTY deny set and a bare `count(deny) == 0` would fail OPEN on
# exactly the input that most needs to fail closed. The probes below are what
# make it fail CLOSED.
#
# Note the no-attribution path is NOT a hole here: `deny_on_no_attribution` and
# `tier_unlabelled_max_usd` are the explicit curator controls over it, and
# `unapproved_entity_category` deliberately requires `has_attribution == true`
# because an unattributed address has no category to judge.
allow if {
	not v.error
	is_boolean(v.has_attribution)
	is_number(amount)
	count(deny) == 0
}
