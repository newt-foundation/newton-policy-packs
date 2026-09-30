package xerberus_common_cause_test

import data.xerberus_common_cause
import future.keywords

treasury := "0xac0168b4fd7427bfd616e3a47fc05dd8175d5b64"

default_params := {
	"max_shared_gap_exposure_usd": 5000000,
	"gap_failure_classes": [],
	"forbidden_shared_dependencies": ["protocol:chainlink"],
	"min_venues_for_shared_dependency": 2,
	"max_shared_collateral_pct_of_book": 25,
	"material_subject_usd": 100000,
	"deny_on_unscored": true,
	"min_subjects_compared": 2,
	"deny_on_stale": true,
	"max_data_age_seconds": 86400,
	"require_intent_party_in_wallets": false,
}

# Three venues with small, unremarkable overlaps.
clean_data := {
	"wallets": [treasury],
	"chain": "ethereum",
	"subjects_compared_count": 3,
	"scored_subjects_count": 3,
	"total_exposure_usd": 9308230.82,
	"unscored_subjects": [],
	"largest_shared_gap_exposure_usd": 1200000,
	"shared_gaps": [{
		"tag": "governance-timelock",
		"failure_class": "governance",
		"subject_count": 2,
		"combined_exposure_usd": 1200000,
	}],
	"shared_dependencies": [{
		"target": "protocol:redstone",
		"connection_types": ["oracle"],
		"subject_count": 1,
	}],
	"largest_shared_collateral_exposure_usd": 900000,
	"shared_collateral": [{
		"token": "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf",
		"symbol": "cbBTC",
		"subject_count": 2,
		"combined_exposure_usd": 900000,
	}],
	"basis": "register",
	"requested_window": "2026-09-20T12:00:00+00:00",
	"data_window": "2026-09-20T12:00:00+00:00",
	"window_honored": true,
	"is_stale": false,
	"data_age_seconds": 3600,
}

# The design's live Fluid / Morpho / Compound result.
design_live_result := object.union(clean_data, {
	"largest_shared_gap_exposure_usd": 9308230.82,
	"shared_gaps": [
		{
			"tag": "price-deviation-circuit-breaker",
			"failure_class": "oracle_integrity",
			"subject_count": 3,
			"combined_exposure_usd": 9308230.82,
		},
		{
			"tag": "minimum-price-protection",
			"failure_class": "oracle_integrity",
			"subject_count": 3,
			"combined_exposure_usd": 9308230.82,
		},
	],
	"shared_dependencies": [{
		"target": "protocol:chainlink",
		"connection_types": ["oracle"],
		"subject_count": 3,
	}],
	"largest_shared_collateral_exposure_usd": 3801334.32,
	"shared_collateral": [{
		"token": "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599",
		"symbol": "WBTC",
		"subject_count": 3,
		"combined_exposure_usd": 3801334.32,
	}],
	"is_stale": true,
})

default_intent := {
	"from": "0x00000000000000000000000000000000000000a1",
	"to": treasury,
	"value": "0",
	"chain_id": "11155111",
	"function": {"name": "supply"},
	"decoded_function_arguments": [],
}

wrap(inner) := {"xerberus_common_cause": inner}

with_data(overrides) := wrap(object.union(clean_data, overrides))

denies(d) := ds if {
	ds := xerberus_common_cause.deny with data.params as default_params with data.wasm as d with input as default_intent
}

denies_with(d, p) := ds if {
	ds := xerberus_common_cause.deny with data.params as p with data.wasm as d with input as default_intent
}

allows(d, p) if {
	xerberus_common_cause.allow with data.params as p with data.wasm as d with input as default_intent
}

test_allow_when_clean if {
	d := wrap(clean_data)
	allows(d, default_params)
	count(denies(d)) == 0
}

# Against the compared exposure (~$9.31M), WBTC's $3.80M is ~41%, so the
# collateral limit fires here too.
test_design_live_result_denies if {
	denies(wrap(design_live_result)) == {
		"stale_data",
		"shared_gap_limit",
		"shared_dependency_limit",
		"shared_collateral_limit",
	}
}

test_deny_shared_gap_limit if {
	d := with_data({"shared_gaps": [{"tag": "x", "failure_class": "oracle_integrity", "subject_count": 3, "combined_exposure_usd": 6000000}]})
	"shared_gap_limit" in denies(d)
}

test_gap_class_filter_excludes_other_classes if {
	p := object.union(default_params, {"gap_failure_classes": ["Oracle_Integrity"]})
	d := with_data({"shared_gaps": [{"tag": "x", "failure_class": "governance", "subject_count": 3, "combined_exposure_usd": 6000000}]})
	not "shared_gap_limit" in denies_with(d, p)
}

test_gap_class_filter_is_case_insensitive if {
	p := object.union(default_params, {"gap_failure_classes": ["Oracle_Integrity"]})
	d := with_data({"shared_gaps": [{"tag": "x", "failure_class": "oracle_integrity", "subject_count": 3, "combined_exposure_usd": 6000000}]})
	"shared_gap_limit" in denies_with(d, p)
}

test_deny_shared_dependency_limit if {
	d := with_data({"shared_dependencies": [{"target": "protocol:chainlink", "connection_types": ["oracle"], "subject_count": 2}]})
	"shared_dependency_limit" in denies(d)
}

test_forbidden_dependency_on_one_venue_allows if {
	d := with_data({"shared_dependencies": [{"target": "protocol:chainlink", "connection_types": ["oracle"], "subject_count": 1}]})
	not "shared_dependency_limit" in denies(d)
}

test_forbidden_dependency_match_is_case_insensitive if {
	p := object.union(default_params, {"forbidden_shared_dependencies": ["Protocol:Chainlink"]})
	d := with_data({"shared_dependencies": [{"target": "protocol:chainlink", "connection_types": ["oracle"], "subject_count": 3}]})
	"shared_dependency_limit" in denies_with(d, p)
}

test_deny_shared_collateral_limit if {
	d := with_data({"shared_collateral": [{"token": "0x01", "symbol": "WBTC", "subject_count": 2, "combined_exposure_usd": 3000000}]})
	"shared_collateral_limit" in denies(d)
}

test_zero_exposure_does_not_divide if {
	d := with_data({"total_exposure_usd": 0})
	not "shared_collateral_limit" in denies(d)
}

test_deny_unscored_material_subject if {
	d := with_data({"unscored_subjects": [{"subject": "protocol:newvenue", "exposure_usd": 250000}]})
	"unscored_material_subject" in denies(d)
}

test_unscored_immaterial_subject_allows if {
	d := with_data({"unscored_subjects": [{"subject": "protocol:dust", "exposure_usd": 50}]})
	allows(d, default_params)
}

test_deny_insufficient_venues if {
	"insufficient_venues" in denies(with_data({"subjects_compared_count": 1}))
}

test_deny_stale_data if {
	"stale_data" in denies(with_data({"is_stale": true}))
}

test_deny_data_too_old if {
	"data_too_old" in denies(with_data({"data_age_seconds": 172800}))
}

test_deny_window_not_honored if {
	"window_not_honored" in denies(with_data({"window_honored": false}))
}

test_deny_wallets_not_bound_to_intent if {
	p := object.union(default_params, {"require_intent_party_in_wallets": true})
	i := object.union(default_intent, {"to": "0x00000000000000000000000000000000000000b2"})
	"wallets_not_bound_to_intent" in xerberus_common_cause.deny with data.params as p with data.wasm as wrap(clean_data) with input as i
}

test_wallets_bound_via_target if {
	p := object.union(default_params, {"require_intent_party_in_wallets": true})
	allows(wrap(clean_data), p)
}

test_shared_risks_explain_the_design_result if {
	details := xerberus_common_cause.shared_risks with data.params as default_params with data.wasm as wrap(design_live_result) with input as default_intent
	"forbidden dependency protocol:chainlink shared by 3 venues" in details
	count(details) == 4
}

# --- fail closed ---------------------------------------------------------------

test_error_payload_does_not_allow if {
	d := wrap({"error": "xerberus common_cause tool error: unknown wallet"})
	denies(d) == {"oracle_error"}
	not allows(d, default_params)
}

test_missing_arrays_do_not_allow if {
	d := wrap(object.remove(clean_data, ["shared_gaps"]))
	"malformed_oracle_output" in denies(d)
	not allows(d, default_params)
}
