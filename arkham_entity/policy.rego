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

# Destination tags the curator has prohibited outright. A set (not a bare
# boolean) so the deny reason can be traced back to the offending tag.
prohibited_tag_hits contains tag if {
	some tag in v.tags
	tag in t.prohibited_tags
}

# --- deny rules ------------------------------------------------------------

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

# --- allow -----------------------------------------------------------------

# Explicit positive conjunction rather than `count(deny) == 0`. Every deny
# rule above silent-skips on an undefined field, so an error envelope or an
# empty pack slot would produce an empty deny set and `count(deny) == 0`
# would fail OPEN. The two `is_*` groundedness checks below are what make
# this fail CLOSED: they are undefined — and so block `allow` — unless the
# oracle actually emitted a well-formed payload.
allow if {
	is_boolean(v.has_attribution)
	is_number(amount)
	count(prohibited_tag_hits) == 0
	attribution_ok
	category_ok
	confidence_ok
	amount <= t.tier_verified_max_usd
	risk_ok
	fresh_ok
}

attribution_ok if v.has_attribution == true

attribution_ok if {
	v.has_attribution == false
	not t.deny_on_no_attribution
	amount <= t.tier_unlabelled_max_usd
}

# An attributed destination in an approved category gets the full tier; one
# outside it is still allowed, but only up to the introductory cap.
category_ok if {
	v.has_attribution == true
	v.entity_category in t.approved_entity_categories
}

category_ok if {
	v.has_attribution == true
	not v.entity_category in t.approved_entity_categories
	amount <= t.tier_unlabelled_max_usd
}

category_ok if v.has_attribution == false

# `null` is the oracle's "Arkham did not report this", distinct from a
# genuine 0. The WASM always emits these keys so a MISSING key (rather than
# an explicit null) leaves these undefined and correctly blocks `allow`.
confidence_ok if v.attribution_confidence == null

confidence_ok if v.attribution_confidence >= t.min_attribution_confidence

risk_ok if v.max_risk_score == null

risk_ok if v.max_risk_score <= t.max_risk_score

fresh_ok if v.data_age_seconds == null

fresh_ok if v.data_age_seconds <= t.max_data_age_seconds
