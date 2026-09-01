package arkham_entity_wallet_wrapping_test

import data.arkham_entity_wallet
import future.keywords

# Phase 0 § Stream B Rego shape test for arkham_entity.
#
# Locks the namespacing contract: the policy reads from
# `data.wasm.arkham_entity.<field>`, NOT `data.wasm.<field>`. Mirrors
# `policy.js`'s `wrapOutput("arkham_entity", ...)` envelope.
#
# This matters more for the arkham family than for most packs: all three
# arkham packs emit overlapping field names (`tags`, `max_risk_score`,
# `data_age_seconds`, `transaction_amount_usd`), so an un-namespaced read
# would cross-wire a composite that stacks two of them.
#
# Coverage limit: this exercises the Rego side only. It does NOT execute
# `policy.js` — runtime output shape is locked by the Stream C AST-lint
# guard plus live `newton-cli policy simulate` runs.

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

clean_inner := {
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

namespaced(overrides) := {"arkham_entity": object.union(clean_inner, overrides)}

test_namespaced_allow_when_clean if {
	arkham_entity_wallet.allow with data.params as default_params with data.wasm as namespaced({})
	count(arkham_entity_wallet.deny) == 0 with data.params as default_params with data.wasm as namespaced({})
}

test_namespaced_deny_prohibited_tag if {
	"prohibited_tag" in arkham_entity_wallet.deny
		with data.params as default_params
		with data.wasm as namespaced({"tags": ["hacker"]})
}

test_namespaced_deny_amount_over_verified_tier if {
	"amount_over_verified_tier" in arkham_entity_wallet.deny
		with data.params as default_params
		with data.wasm as namespaced({"transaction_amount_usd": 250000})
}

test_namespaced_deny_risk_score_above_max if {
	"risk_score_above_max" in arkham_entity_wallet.deny
		with data.params as default_params
		with data.wasm as namespaced({"max_risk_score": 90})
}

test_namespaced_deny_stale_data if {
	"stale_data" in arkham_entity_wallet.deny
		with data.params as default_params
		with data.wasm as namespaced({"data_age_seconds": 99999})
}

# Negative shape test: a flat (un-namespaced) `data.wasm` MUST NOT trigger
# any deny rule, because every rule reads `.arkham_entity.<field>` and the
# flat fixture has no such key. Fails if a stray rule still references
# `data.wasm.<field>` at the bare top level.
test_flat_input_does_not_trigger_namespaced_rules if {
	flat_with_violations := object.union(clean_inner, {
		"tags": ["sanctioned"],
		"attribution_confidence": 0.01,
		"max_risk_score": 99,
		"transaction_amount_usd": 999999999,
		"data_age_seconds": 99999,
	})
	count(arkham_entity_wallet.deny) == 0
		with data.params as default_params
		with data.wasm as flat_with_violations
}

# ...and it must not ALLOW either. Flat input leaves the groundedness
# checks undefined, so the policy fails closed rather than sailing through
# on an empty deny set.
test_flat_input_does_not_allow if {
	not arkham_entity_wallet.allow
		with data.params as default_params
		with data.wasm as clean_inner
}

test_namespaced_error_does_not_allow if {
	not arkham_entity_wallet.allow
		with data.params as default_params
		with data.wasm as {"arkham_entity": {"error": "oracle failed"}}
}

test_namespaced_empty_pack_slot_does_not_allow if {
	not arkham_entity_wallet.allow
		with data.params as default_params
		with data.wasm as {"arkham_entity": {}}
}

# Cross-pack composition: arkham_entity MUST read only its own slice, even
# when a sibling arkham pack in the same composite carries hostile values
# under the SAME field names.
test_other_pack_keys_do_not_interfere if {
	composite := {
		"arkham_entity": clean_inner,
		"arkham_risk": {
			"max_risk_score": 100,
			"tags": ["sanctioned"],
			"data_age_seconds": 99999,
		},
		"arkham_counterparty": {
			"transaction_amount_usd": 999999999,
			"tags": ["scam"],
		},
	}
	arkham_entity_wallet.allow with data.params as default_params with data.wasm as composite
	count(arkham_entity_wallet.deny) == 0 with data.params as default_params with data.wasm as composite
}
