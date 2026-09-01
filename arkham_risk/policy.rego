package arkham_risk_exposure

import future.keywords

default allow := false

t := data.params

# Phase 0 § Stream B namespacing — see wrapping_test.rego.
v := data.wasm.arkham_risk

# Fields the oracle reports as `null` when Arkham has nothing to say. `null` is
# deliberately distinct from `0`: a null score means "not reported", a zero
# score would be a genuine clean verdict. Naming one in
# `deny_on_missing_fields` asks for the former to block rather than fail soft.
nullable_fields := {
	"max_score": v.max_score,
	"data_age_seconds": v.data_age_seconds,
}

# --- path classification ---------------------------------------------------
#
# The oracle emits Arkham's raw exposure paths and this policy does the
# filtering, so the curator's notion of "severe" lives in params rather than
# being baked into the WASM. That is what makes the decision explainable:
# `risk_paths` below can name the exact route that tripped the deny.

# Dust first. A path contributing a trivial amount is ignored outright, so a
# dusting attack cannot brick a wallet by manufacturing exposure.
material_paths contains p if {
	some p in v.paths
	p.contributed_usd > t.dust_tolerance_usd
}

severe_paths contains p if {
	some p in material_paths
	p.category in t.severe_categories
}

# Close exposure denies on presence alone — no value or recency test.
severe_near_paths contains p if {
	some p in severe_paths
	p.hop_distance <= t.max_severe_hop_distance
}

# Distant exposure is tolerated unless it is materially large...
material_distant_paths contains p if {
	some p in severe_paths
	p.hop_distance > t.max_severe_hop_distance
	p.contributed_usd > t.material_exposure_usd
}

# ...or recent, regardless of size.
recent_distant_paths contains p if {
	some p in severe_paths
	p.hop_distance > t.max_severe_hop_distance
	p.last_seen_days != null
	p.last_seen_days <= t.recent_exposure_days
}

# ...or, under strict mode, when Arkham reports no date at all: an undated path
# slips past `recent_distant_paths` above, so the missing recency is itself the
# signal a curator asked to act on.
undated_distant_paths contains p if {
	some p in severe_paths
	p.hop_distance > t.max_severe_hop_distance
	p.last_seen_days == null
}

offending_paths := (severe_near_paths | material_distant_paths) | recent_distant_paths

# Reviewer-facing explanation of WHY the policy denied: the category, the
# risky source, the hop distance and the contributed value for every path
# that tripped a rule.
#
# NOT evaluated on-chain. The AVS entrypoint is `arkham_risk_exposure.allow`
# and nothing else; this rule exists for `opa eval`, local simulation, and
# composite policies that want to surface a reason to an operator.
risk_paths contains detail if {
	some p in offending_paths
	detail := sprintf(
		"%v exposure via %v at %v hop(s), $%v contributed",
		[p.category, p.seed_address, p.hop_distance, p.contributed_usd],
	)
}

# --- deny rules ------------------------------------------------------------
#
# `deny` is the single source of truth for every rule in this policy. `allow`
# below consumes it; there is no parallel set of positive helper rules to drift
# out of sync with these.

deny contains "seed_address" if {
	t.deny_on_seed
	v.is_seed == true
}

deny contains "severe_exposure_within_hops" if count(severe_near_paths) > 0

deny contains "material_distant_exposure" if count(material_distant_paths) > 0

deny contains "recent_distant_exposure" if count(recent_distant_paths) > 0

deny contains "risk_score_above_max" if {
	v.max_score != null
	v.max_score > t.max_risk_score
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

# `path_last_seen_days` describes per-path data rather than a top-level field,
# so it is a valid entry in `deny_on_missing_fields` without appearing in
# `nullable_fields` above.
deny contains "missing_path_last_seen_days" if {
	"path_last_seen_days" in t.deny_on_missing_fields
	count(undated_distant_paths) > 0
}

# --- allow -----------------------------------------------------------------

# `allow` is the ONLY on-chain entrypoint — scripts/upload.sh derives
# `<package>.allow` and nothing else is evaluated. `risk_paths` above is for
# `opa eval`, local simulation and composites, never for the AVS.
#
# The groundedness probes are load-bearing, not decoration: `is_array(v.paths)`
# in particular. An error envelope has no `paths` key, every path rule then
# yields an empty set, and a bare `count(deny) == 0` would fail OPEN on exactly
# the payload that most needs to fail closed.
allow if {
	not v.error
	is_boolean(v.is_seed)
	is_array(v.paths)
	count(deny) == 0
}
