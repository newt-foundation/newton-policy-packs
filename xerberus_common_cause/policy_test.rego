package xerberus_common_cause_test

import data.xerberus_common_cause
import future.keywords

treasury := "0xac0168b4fd7427bfd616e3a47fc05dd8175d5b64"

default_params := {
	"min_venues_for_shared_node": 2,
	"shared_node_types": [],
	"max_shared_exposure_usd": 5000000,
	"max_shared_exposure_pct_of_book": 40,
	"max_shared_expected_loss_share": 0.05,
	"forbidden_shared_nodes": [],
	"material_venue_usd": 100000,
	"deny_on_unresolved": true,
	"deny_on_truncated": true,
	"min_venues_compared": 2,
	"deny_on_stale": true,
	"max_data_age_seconds": 86400,
	"require_intent_party_in_wallets": false,
}

# Eleven venues with small, unremarkable overlaps.
clean_data := {
	"wallets": [treasury],
	"chain": "ethereum",
	"relations": ["collateral", "oracle", "issuer", "governance"],
	"venues_compared_count": 11,
	"book_usd": 16444692.56,
	"debt_usd": 8991489.49,
	"venues_omitted_usd": 0,
	"unresolved_venues": [],
	"shared_node_count": 2,
	"shared_nodes_truncated": false,
	"largest_shared_node": "token:0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf",
	"largest_shared_exposure_usd": 3685003.51,
	"shared_nodes": [
		{
			"node": "token:0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf",
			"node_type": "token",
			"label": "cbBTC",
			"venue_count": 4,
			"exposure_usd": 3685003.51,
			"expected_loss_share": 0.008756,
			"combined_weight": 3.457,
			"combined_contribution": 0.030269,
		},
		{
			"node": "protocol:etherfi",
			"node_type": "protocol",
			"label": "protocol:etherfi",
			"venue_count": 2,
			"exposure_usd": 1155913.93,
			"expected_loss_share": 0,
			"combined_weight": 0.9,
			"combined_contribution": 0,
		},
	],
	"requested_window": null,
	"data_window": "2026-10-29T12:00:00+00:00",
	"latest_window": "2026-10-29T12:00:00+00:00",
	"window_honored": null,
	"is_stale": false,
	"data_age_seconds": 3600,
}

# Live result for the treasury on the 2026-10-29T12:00 window: seven of its
# eleven venues lean on wstETH and the Lido stack behind it.
live_2026_10_29 := object.union(clean_data, {
	"shared_node_count": 4,
	"largest_shared_node": "token:0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0",
	"largest_shared_exposure_usd": 8979727.65,
	"shared_nodes": [
		{
			"node": "token:0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0",
			"node_type": "token",
			"label": "wstETH",
			"venue_count": 7,
			"exposure_usd": 8979727.65,
			"expected_loss_share": 0.029727,
			"combined_weight": 8.700325,
			"combined_contribution": 0.258632,
		},
		{
			"node": "protocol:lido",
			"node_type": "protocol",
			"label": "protocol:lido",
			"venue_count": 7,
			"exposure_usd": 8979727.65,
			"expected_loss_share": 0,
			"combined_weight": 7.395275,
			"combined_contribution": 0,
		},
		{
			"node": "oracle:0x8fffffd4afb6115b954bd326cbe7b4ba576818f6",
			"node_type": "oracle",
			"label": "oracle:0x8fff…18f6",
			"venue_count": 3,
			"exposure_usd": 5379545.98,
			"expected_loss_share": 0,
			"combined_weight": 2.295,
			"combined_contribution": 0,
		},
		{
			"node": "token:0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf",
			"node_type": "token",
			"label": "cbBTC",
			"venue_count": 4,
			"exposure_usd": 3685003.51,
			"expected_loss_share": 0.008756,
			"combined_weight": 3.457,
			"combined_contribution": 0.030269,
		},
	],
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

with_node(n) := with_data({"shared_nodes": [n]})

node(overrides) := object.union(
	{
		"node": "oracle:0x01",
		"node_type": "oracle",
		"label": "oracle:0x01",
		"venue_count": 3,
		"exposure_usd": 1000000,
		"expected_loss_share": 0,
		"combined_weight": 1,
		"combined_contribution": 0,
	},
	overrides,
)

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

# $8.98M behind wstETH is over $5M and ~55% of the $16.44M book.
test_live_2026_10_29_denies if {
	denies(wrap(live_2026_10_29)) == {"shared_exposure_limit", "shared_book_share_limit"}
}

test_deny_shared_exposure_limit if {
	"shared_exposure_limit" in denies(with_node(node({"exposure_usd": 6000000})))
}

test_exposure_at_limit_allows if {
	allows(with_node(node({"exposure_usd": 5000000})), default_params)
}

test_deny_shared_book_share_limit if {
	d := with_data({"book_usd": 2000000, "shared_nodes": [node({"exposure_usd": 1000000})]})
	denies(d) == {"shared_book_share_limit"}
}

test_zero_book_does_not_divide if {
	d := with_data({"book_usd": 0})
	not "shared_book_share_limit" in denies(d)
}

test_deny_shared_loss_limit if {
	"shared_loss_limit" in denies(with_node(node({"node_type": "token", "expected_loss_share": 0.08})))
}

test_single_venue_node_is_out_of_scope if {
	d := with_node(node({"venue_count": 1, "exposure_usd": 9000000, "expected_loss_share": 0.5}))
	allows(d, default_params)
}

test_node_type_filter_excludes_other_types if {
	p := object.union(default_params, {"shared_node_types": ["Oracle", "protocol"]})
	d := with_node(node({"node_type": "token", "exposure_usd": 9000000}))
	not "shared_exposure_limit" in denies_with(d, p)
}

test_node_type_filter_is_case_insensitive if {
	p := object.union(default_params, {"shared_node_types": ["Oracle"]})
	d := with_node(node({"exposure_usd": 9000000}))
	"shared_exposure_limit" in denies_with(d, p)
}

test_deny_forbidden_shared_node if {
	p := object.union(default_params, {"forbidden_shared_nodes": ["Protocol:Lido"]})
	d := with_node(node({"node": "protocol:lido", "node_type": "protocol", "venue_count": 2}))
	denies_with(d, p) == {"forbidden_shared_node"}
}

test_forbidden_node_on_one_venue_allows if {
	p := object.union(default_params, {"forbidden_shared_nodes": ["protocol:lido"]})
	d := with_node(node({"node": "protocol:lido", "node_type": "protocol", "venue_count": 1}))
	allows(d, p)
}

test_deny_unresolved_material_venue if {
	d := with_data({"unresolved_venues": [{"venue": "market:newvenue:0x01", "exposure_usd": 250000}]})
	"unresolved_material_venue" in denies(d)
}

test_unresolved_immaterial_venue_allows if {
	d := with_data({"unresolved_venues": [{"venue": "market:dust:0x01", "exposure_usd": 500}]})
	allows(d, default_params)
}

test_unresolved_allowed_when_disabled if {
	p := object.union(default_params, {"deny_on_unresolved": false})
	d := with_data({"unresolved_venues": [{"venue": "market:newvenue:0x01", "exposure_usd": 250000}]})
	allows(d, p)
}

test_deny_truncated if {
	"shared_nodes_truncated" in denies(with_data({"shared_nodes_truncated": true}))
}

test_truncated_allowed_when_disabled if {
	p := object.union(default_params, {"deny_on_truncated": false})
	allows(with_data({"shared_nodes_truncated": true}), p)
}

test_deny_insufficient_venues if {
	"insufficient_venues" in denies(with_data({"venues_compared_count": 1, "shared_nodes": []}))
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

test_shared_risks_explain_the_live_result if {
	details := xerberus_common_cause.shared_risks with data.params as default_params with data.wasm as wrap(live_2026_10_29) with input as default_intent
	"wstETH (token:0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0) shared by 7 venues, $8979728 of a $16444693 book behind it" in details
	count(details) == 5
}

# --- fail closed ---------------------------------------------------------------

test_error_payload_does_not_allow if {
	d := wrap({"error": "xerberus shared_dependencies_nodes bad_request: unknown dep_type"})
	denies(d) == {"oracle_error"}
	not allows(d, default_params)
}

test_missing_arrays_do_not_allow if {
	d := wrap(object.remove(clean_data, ["shared_nodes"]))
	"malformed_oracle_output" in denies(d)
	not allows(d, default_params)
}

test_missing_truncation_flag_does_not_allow if {
	d := wrap(object.remove(clean_data, ["shared_nodes_truncated"]))
	"malformed_oracle_output" in denies(d)
}
