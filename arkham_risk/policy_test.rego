package arkham_risk_exposure_test

import data.arkham_risk_exposure
import future.keywords

default_params := {
	"severe_categories": ["sanctions", "hacker", "ransomware", "mixer", "darkweb"],
	"max_severe_hop_distance": 1,
	"material_exposure_usd": 10000,
	"recent_exposure_days": 30,
	"dust_tolerance_usd": 100,
	"deny_on_seed": true,
	"max_risk_score": 40,
	"max_data_age_seconds": 3600,
	"deny_on_missing_data": false,
}

# A clean address: low headline score, and its only exposure path is a
# distant, small, old gambling link that is not in severe_categories.
clean_data := {
	"address": "0x71660c4005ba85c37ccec55d0c4493e66fe775d3",
	"chain": "ethereum",
	"risk_level": "low",
	"max_score": 5,
	"category_scores": {"sanctions": 0, "hacker": 0, "mixer": 0, "gambling": 5},
	"top_risk_category": "gambling",
	"is_seed": false,
	"paths": [{
		"category": "gambling",
		"direction": "received",
		"hop_distance": 4,
		"seed_address": "0x00000000000000000000000000000000000000aa",
		"score": 5,
		"contributed_usd": 250,
		"contributed_pct": 0.4,
		"nodes": ["0x00000000000000000000000000000000000000ab"],
		"first_seen_days": 400,
		"last_seen_days": 380,
	}],
	"data_age_seconds": 60,
}

wrap(inner) := {"arkham_risk": inner}

with_data(overrides) := wrap(object.union(clean_data, overrides))

path(overrides) := object.union(
	{
		"category": "sanctions",
		"direction": "received",
		"hop_distance": 5,
		"seed_address": "0x00000000000000000000000000000000000000ff",
		"score": 90,
		"contributed_usd": 500,
		"contributed_pct": 1,
		"nodes": [],
		"first_seen_days": 300,
		"last_seen_days": 290,
	},
	overrides,
)

test_allow_when_clean if {
	d := wrap(clean_data)
	arkham_risk_exposure.allow with data.params as default_params with data.wasm as d
	count(arkham_risk_exposure.deny) == 0 with data.params as default_params with data.wasm as d
}

test_deny_seed_address if {
	d := with_data({"is_seed": true})
	"seed_address" in arkham_risk_exposure.deny with data.params as default_params with data.wasm as d
	not arkham_risk_exposure.allow with data.params as default_params with data.wasm as d
}

test_seed_tolerated_when_configured_off if {
	p := object.union(default_params, {"deny_on_seed": false})
	d := with_data({"is_seed": true})
	not "seed_address" in arkham_risk_exposure.deny with data.params as p with data.wasm as d
	arkham_risk_exposure.allow with data.params as p with data.wasm as d
}

# Direct exposure to a severe category denies on presence alone.
test_deny_severe_direct_exposure if {
	d := with_data({"paths": [path({"hop_distance": 0})]})
	"severe_exposure_within_hops" in arkham_risk_exposure.deny with data.params as default_params with data.wasm as d
	not arkham_risk_exposure.allow with data.params as default_params with data.wasm as d
}

test_deny_severe_one_hop_exposure if {
	d := with_data({"paths": [path({"hop_distance": 1})]})
	"severe_exposure_within_hops" in arkham_risk_exposure.deny with data.params as default_params with data.wasm as d
}

# Distant severe exposure is tolerated when it is small and old...
test_allow_distant_small_old_severe_exposure if {
	d := with_data({"paths": [path({"hop_distance": 5, "contributed_usd": 500, "last_seen_days": 300})]})
	arkham_risk_exposure.allow with data.params as default_params with data.wasm as d
	count(arkham_risk_exposure.deny) == 0 with data.params as default_params with data.wasm as d
}

# ...but not when it is materially large...
test_deny_material_distant_exposure if {
	d := with_data({"paths": [path({"hop_distance": 5, "contributed_usd": 50000, "last_seen_days": 300})]})
	"material_distant_exposure" in arkham_risk_exposure.deny with data.params as default_params with data.wasm as d
	not arkham_risk_exposure.allow with data.params as default_params with data.wasm as d
}

# ...nor when it is recent, however small.
test_deny_recent_distant_exposure if {
	d := with_data({"paths": [path({"hop_distance": 5, "contributed_usd": 500, "last_seen_days": 3})]})
	"recent_distant_exposure" in arkham_risk_exposure.deny with data.params as default_params with data.wasm as d
	not arkham_risk_exposure.allow with data.params as default_params with data.wasm as d
}

# Dust is ignored entirely, so a dusting attack cannot brick the wallet.
test_dust_exposure_ignored if {
	d := with_data({"paths": [path({"hop_distance": 0, "contributed_usd": 50})]})
	count(arkham_risk_exposure.deny) == 0 with data.params as default_params with data.wasm as d
	arkham_risk_exposure.allow with data.params as default_params with data.wasm as d
}

# Dust tolerance is a > comparison, so a path exactly at the floor is dust.
test_dust_boundary_exactly_at_floor_is_dust if {
	d := with_data({"paths": [path({"hop_distance": 0, "contributed_usd": 100})]})
	arkham_risk_exposure.allow with data.params as default_params with data.wasm as d
}

# A category outside severe_categories never trips the hop rules, even direct.
test_non_severe_category_direct_exposure_allowed if {
	d := with_data({"paths": [path({"category": "gambling", "hop_distance": 0, "contributed_usd": 999999})]})
	arkham_risk_exposure.allow with data.params as default_params with data.wasm as d
	count(arkham_risk_exposure.deny) == 0 with data.params as default_params with data.wasm as d
}

test_deny_risk_score_above_max if {
	d := with_data({"max_score": 85, "risk_level": "severe"})
	"risk_score_above_max" in arkham_risk_exposure.deny with data.params as default_params with data.wasm as d
	not arkham_risk_exposure.allow with data.params as default_params with data.wasm as d
}

test_deny_stale_data if {
	d := with_data({"data_age_seconds": 99999})
	"stale_data" in arkham_risk_exposure.deny with data.params as default_params with data.wasm as d
	not arkham_risk_exposure.allow with data.params as default_params with data.wasm as d
}

test_empty_paths_array_allows if {
	d := with_data({"paths": []})
	arkham_risk_exposure.allow with data.params as default_params with data.wasm as d
	count(arkham_risk_exposure.deny) == 0 with data.params as default_params with data.wasm as d
}

# Explainability: the deny must be traceable to a specific route.
test_risk_paths_explains_the_deny if {
	d := with_data({"paths": [path({
		"hop_distance": 0,
		"contributed_usd": 25000,
		"seed_address": "0x00000000000000000000000000000000000000ff",
		"category": "sanctions",
	})]})
	explained := arkham_risk_exposure.risk_paths with data.params as default_params with data.wasm as d
	count(explained) == 1
	some detail in explained
	contains(detail, "sanctions")
	contains(detail, "0x00000000000000000000000000000000000000ff")
}

test_risk_paths_empty_when_clean if {
	d := wrap(clean_data)
	count(arkham_risk_exposure.risk_paths) == 0 with data.params as default_params with data.wasm as d
}

# One address can carry several distinct exposure routes at once.
test_multiple_paths_multiple_denies if {
	d := with_data({"paths": [
		path({"hop_distance": 0, "contributed_usd": 5000}),
		path({"hop_distance": 6, "contributed_usd": 90000, "last_seen_days": 300}),
		path({"hop_distance": 7, "contributed_usd": 500, "last_seen_days": 2}),
	]})
	deny := arkham_risk_exposure.deny with data.params as default_params with data.wasm as d
	"severe_exposure_within_hops" in deny
	"material_distant_exposure" in deny
	"recent_distant_exposure" in deny
	not arkham_risk_exposure.allow with data.params as default_params with data.wasm as d
	count(arkham_risk_exposure.risk_paths) == 3 with data.params as default_params with data.wasm as d
}

test_null_optional_fields_fail_soft if {
	d := with_data({"max_score": null, "data_age_seconds": null, "paths": [path({"last_seen_days": null, "hop_distance": 5, "contributed_usd": 500})]})
	arkham_risk_exposure.allow with data.params as default_params with data.wasm as d
	count(arkham_risk_exposure.deny) == 0 with data.params as default_params with data.wasm as d
}

test_deny_on_oracle_error if {
	not arkham_risk_exposure.allow with data.params as default_params with data.wasm as wrap({"error": "oracle failed"})
}

test_deny_on_empty_payload if {
	not arkham_risk_exposure.allow with data.params as default_params with data.wasm as wrap({})
}

# Groundedness: a payload with no `paths` key must fail closed, even though
# every path rule silent-skips to an empty set.
test_missing_paths_does_not_allow if {
	d := wrap(object.remove(clean_data, {"paths"}))
	not arkham_risk_exposure.allow with data.params as default_params with data.wasm as d
	count(arkham_risk_exposure.deny) == 0 with data.params as default_params with data.wasm as d
}

# --- deny_on_missing_data --------------------------------------------------

test_missing_data_denies_when_strict if {
	p := object.union(default_params, {"deny_on_missing_data": true})
	d := with_data({"max_score": null})
	"missing_max_score" in arkham_risk_exposure.deny with data.params as p with data.wasm as d
	not arkham_risk_exposure.allow with data.params as p with data.wasm as d
}

test_missing_data_names_every_null_field if {
	p := object.union(default_params, {"deny_on_missing_data": true})
	d := with_data({"max_score": null, "data_age_seconds": null})
	deny := arkham_risk_exposure.deny with data.params as p with data.wasm as d
	"missing_max_score" in deny
	"missing_data_age_seconds" in deny
}

# An undated distant severe path slips past `recent_distant_paths` — under
# strict mode the absent date is itself the deny.
test_undated_distant_severe_path_denies_when_strict if {
	p := object.union(default_params, {"deny_on_missing_data": true})
	d := with_data({"paths": [path({
		"category": "mixer",
		"hop_distance": 4,
		"contributed_usd": 500,
		"last_seen_days": null,
	})]})
	"missing_path_last_seen_days" in arkham_risk_exposure.deny with data.params as p with data.wasm as d
	not arkham_risk_exposure.allow with data.params as p with data.wasm as d
}

# ...and stays permitted when the curator has not asked for strict mode.
test_undated_distant_severe_path_fails_soft_by_default if {
	d := with_data({"paths": [path({
		"category": "mixer",
		"hop_distance": 4,
		"contributed_usd": 500,
		"last_seen_days": null,
	})]})
	arkham_risk_exposure.allow with data.params as default_params with data.wasm as d
}

test_populated_fields_are_not_reported_missing if {
	p := object.union(default_params, {"deny_on_missing_data": true})
	arkham_risk_exposure.allow with data.params as p with data.wasm as wrap(clean_data)
}

# The regression test for the refactor: an error envelope produces NO denies at
# all, so the groundedness probes in `allow` — not `count(deny) == 0` — are what
# keep it closed.
test_error_envelope_yields_empty_deny_set_and_no_allow if {
	d := wrap({"error": "oracle failed"})
	count(arkham_risk_exposure.deny) == 0 with data.params as default_params with data.wasm as d
	not arkham_risk_exposure.allow with data.params as default_params with data.wasm as d
}
