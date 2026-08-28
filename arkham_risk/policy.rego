package arkham_risk_exposure

import future.keywords

default allow := false

t := data.params

# Phase 0 § Stream B namespacing — see wrapping_test.rego.
v := data.wasm.arkham_risk

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

# --- allow -----------------------------------------------------------------

# Explicit positive conjunction, not `count(deny) == 0`. `is_array(v.paths)`
# is the load-bearing groundedness check: an error envelope has no `paths`
# key, every path rule then yields an empty set, and a `count(deny) == 0`
# formulation would fail OPEN on exactly the payload that most needs to
# fail closed.
allow if {
	is_boolean(v.is_seed)
	is_array(v.paths)
	not seed_blocks
	count(severe_near_paths) == 0
	count(material_distant_paths) == 0
	count(recent_distant_paths) == 0
	risk_ok
	fresh_ok
}

seed_blocks if {
	t.deny_on_seed
	v.is_seed == true
}

risk_ok if v.max_score == null

risk_ok if v.max_score <= t.max_risk_score

fresh_ok if v.data_age_seconds == null

fresh_ok if v.data_age_seconds <= t.max_data_age_seconds
