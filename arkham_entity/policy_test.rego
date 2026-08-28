package arkham_entity_wallet_test

import data.arkham_entity_wallet
import future.keywords

default_params := {
	"prohibited_tags": ["sanctioned", "hacker", "scam", "mixer"],
	"approved_entity_categories": ["cex", "custodian", "defi"],
	"tier_verified_max_usd": 100000,
	"tier_unlabelled_max_usd": 1000,
	"min_attribution_confidence": 0.8,
	"deny_on_no_attribution": false,
	"max_risk_score": 25,
	"max_data_age_seconds": 3600,
}

# A verified Coinbase hot wallet moving $5k — comfortably inside every tier.
clean_data := {
	"address": "0x71660c4005ba85c37ccec55d0c4493e66fe775d3",
	"chain": "ethereum",
	"has_attribution": true,
	"entity_name": "Coinbase",
	"entity_category": "cex",
	"address_role": "hot_wallet",
	"tags": ["exchange"],
	"attribution_type": "verified",
	"attribution_confidence": 0.98,
	"risk_level": "low",
	"max_risk_score": 5,
	"transaction_amount_usd": 5000,
	"data_age_seconds": 30,
}

wrap(inner) := {"arkham_entity": inner}

with_data(overrides) := wrap(object.union(clean_data, overrides))

test_allow_when_all_clean if {
	d := wrap(clean_data)
	arkham_entity_wallet.allow with data.params as default_params with data.wasm as d
	count(arkham_entity_wallet.deny) == 0 with data.params as default_params with data.wasm as d
}

test_deny_prohibited_tag if {
	d := with_data({"tags": ["exchange", "sanctioned"]})
	"prohibited_tag" in arkham_entity_wallet.deny with data.params as default_params with data.wasm as d
	not arkham_entity_wallet.allow with data.params as default_params with data.wasm as d
}

# A prohibited tag denies regardless of how small the transfer is.
test_prohibited_tag_denies_even_under_intro_cap if {
	d := with_data({"tags": ["mixer"], "transaction_amount_usd": 1})
	"prohibited_tag" in arkham_entity_wallet.deny with data.params as default_params with data.wasm as d
	not arkham_entity_wallet.allow with data.params as default_params with data.wasm as d
}

test_deny_no_attribution_when_configured if {
	p := object.union(default_params, {"deny_on_no_attribution": true})
	d := with_data({
		"has_attribution": false,
		"entity_name": null,
		"entity_category": null,
		"attribution_type": "none",
		"attribution_confidence": null,
		"transaction_amount_usd": 100,
	})
	"no_attribution" in arkham_entity_wallet.deny with data.params as p with data.wasm as d
	not arkham_entity_wallet.allow with data.params as p with data.wasm as d
}

test_deny_no_attribution_over_intro_cap if {
	d := with_data({
		"has_attribution": false,
		"entity_name": null,
		"entity_category": null,
		"attribution_type": "none",
		"attribution_confidence": null,
		"transaction_amount_usd": 5000,
	})
	"no_attribution_over_limit" in arkham_entity_wallet.deny with data.params as default_params with data.wasm as d
	not arkham_entity_wallet.allow with data.params as default_params with data.wasm as d
}

# The introductory tier: an unlabelled address is usable for small amounts.
test_allow_unattributed_under_intro_cap if {
	d := with_data({
		"has_attribution": false,
		"entity_name": null,
		"entity_category": null,
		"attribution_type": "none",
		"attribution_confidence": null,
		"transaction_amount_usd": 500,
	})
	arkham_entity_wallet.allow with data.params as default_params with data.wasm as d
	count(arkham_entity_wallet.deny) == 0 with data.params as default_params with data.wasm as d
}

test_deny_unapproved_entity_category_over_cap if {
	d := with_data({"entity_category": "gambling", "transaction_amount_usd": 5000})
	"unapproved_entity_category" in arkham_entity_wallet.deny with data.params as default_params with data.wasm as d
	not arkham_entity_wallet.allow with data.params as default_params with data.wasm as d
}

test_allow_unapproved_entity_category_under_cap if {
	d := with_data({"entity_category": "gambling", "transaction_amount_usd": 500})
	arkham_entity_wallet.allow with data.params as default_params with data.wasm as d
}

test_deny_low_attribution_confidence if {
	d := with_data({"attribution_confidence": 0.5})
	"low_attribution_confidence" in arkham_entity_wallet.deny with data.params as default_params with data.wasm as d
	not arkham_entity_wallet.allow with data.params as default_params with data.wasm as d
}

test_deny_amount_over_verified_tier if {
	d := with_data({"transaction_amount_usd": 250000})
	"amount_over_verified_tier" in arkham_entity_wallet.deny with data.params as default_params with data.wasm as d
	not arkham_entity_wallet.allow with data.params as default_params with data.wasm as d
}

test_deny_risk_score_above_max if {
	d := with_data({"max_risk_score": 60, "risk_level": "high"})
	"risk_score_above_max" in arkham_entity_wallet.deny with data.params as default_params with data.wasm as d
	not arkham_entity_wallet.allow with data.params as default_params with data.wasm as d
}

test_deny_stale_data if {
	d := with_data({"data_age_seconds": 7200})
	"stale_data" in arkham_entity_wallet.deny with data.params as default_params with data.wasm as d
	not arkham_entity_wallet.allow with data.params as default_params with data.wasm as d
}

# `null` means "Arkham did not report this", and must fail-soft rather than
# being coerced to 0 (which would silently pass every `<=` comparison).
test_null_optional_fields_fail_soft if {
	d := with_data({
		"attribution_confidence": null,
		"max_risk_score": null,
		"data_age_seconds": null,
	})
	arkham_entity_wallet.allow with data.params as default_params with data.wasm as d
	count(arkham_entity_wallet.deny) == 0 with data.params as default_params with data.wasm as d
}

test_boundary_amount_exactly_at_verified_tier_allows if {
	d := with_data({"transaction_amount_usd": 100000})
	arkham_entity_wallet.allow with data.params as default_params with data.wasm as d
}

test_boundary_confidence_exactly_at_min_allows if {
	d := with_data({"attribution_confidence": 0.8})
	arkham_entity_wallet.allow with data.params as default_params with data.wasm as d
}

test_multiple_denies_do_not_fail_open if {
	d := with_data({
		"tags": ["scam"],
		"attribution_confidence": 0.1,
		"max_risk_score": 99,
		"transaction_amount_usd": 250000,
	})
	deny := arkham_entity_wallet.deny with data.params as default_params with data.wasm as d
	"prohibited_tag" in deny
	"low_attribution_confidence" in deny
	"risk_score_above_max" in deny
	"amount_over_verified_tier" in deny
	count(deny) >= 4
	not arkham_entity_wallet.allow with data.params as default_params with data.wasm as d
}

test_deny_on_oracle_error if {
	not arkham_entity_wallet.allow with data.params as default_params with data.wasm as wrap({"error": "oracle failed"})
}

test_deny_on_empty_payload if {
	not arkham_entity_wallet.allow with data.params as default_params with data.wasm as wrap({})
}

# Groundedness: a payload missing `has_attribution` entirely must not allow,
# even though every deny rule silent-skips on it.
test_missing_groundedness_field_does_not_allow if {
	d := wrap(object.remove(clean_data, {"has_attribution"}))
	not arkham_entity_wallet.allow with data.params as default_params with data.wasm as d
	count(arkham_entity_wallet.deny) == 0 with data.params as default_params with data.wasm as d
}

test_missing_amount_does_not_allow if {
	d := wrap(object.remove(clean_data, {"transaction_amount_usd"}))
	not arkham_entity_wallet.allow with data.params as default_params with data.wasm as d
}
