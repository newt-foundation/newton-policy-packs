package vaultsfyi_chainalysis_gate_test

import data.vaultsfyi_chainalysis_gate

import future.keywords

# Params namespaced by short pack id (composite manifest convention).
default_params := {
	"vaultsfyi": {
		"apy_z_max": 4,
		"tvl_drawdown_24h_max_pct": 25,
		"tvl_drawdown_7d_max_pct": 50,
		"risk_score_floor": 60,
		"deny_on_allocation_change": true,
		"deny_on_critical_flag": true,
		"deny_on_corrupted": true,
	},
	"chainalysis": {
		"deny_on_sanctioned": true,
		"deny_on_high_risk_category": true,
		"risk_categories_blocklist": ["mixer", "stolen_funds", "ransomware"],
	},
}

# Clean WASM output for both oracles (well-formed, nothing tripping a deny).
clean_vaultsfyi := {
	"apy_z_score": 0.5,
	"tvl_drawdown_24h_pct": 1,
	"tvl_drawdown_7d_pct": 2,
	"risk_score": 90,
	"has_critical_flag": false,
	"is_corrupted": false,
	"allocation_changed_since_last": false,
}

clean_chainalysis := {
	"sanctioned": false,
	"is_high_risk": false,
	"risk_categories": [],
	"screening_available": true,
	"risk_score": "low",
}

# Merged data.wasm shape: both oracles' outputs under their short pack id —
# exactly what the AVS produces after merge_jsons across two PolicyData WASMs.
clean_wasm := {"vaultsfyi": clean_vaultsfyi, "chainalysis": clean_chainalysis}

# Override helper: patch one oracle's slice, keep the other clean.
wasm_with(pack, overrides) := merged if {
	patched := object.union(clean_wasm[pack], overrides)
	merged := object.union(clean_wasm, {pack: patched})
}

test_allow_when_both_oracles_clean if {
	vaultsfyi_chainalysis_gate.allow with data.params as default_params with data.wasm as clean_wasm
	count(vaultsfyi_chainalysis_gate.deny) == 0 with data.params as default_params with data.wasm as clean_wasm
}

# --- vaultsfyi half denies, chainalysis clean ---

test_deny_vaultsfyi_risk_below_floor if {
	d := wasm_with("vaultsfyi", {"risk_score": 30})
	"vaultsfyi:risk_below_floor" in vaultsfyi_chainalysis_gate.deny with data.params as default_params with data.wasm as d
	not vaultsfyi_chainalysis_gate.allow with data.params as default_params with data.wasm as d
}

test_deny_vaultsfyi_apy_spike if {
	d := wasm_with("vaultsfyi", {"apy_z_score": 9})
	"vaultsfyi:apy_spike" in vaultsfyi_chainalysis_gate.deny with data.params as default_params with data.wasm as d
	not vaultsfyi_chainalysis_gate.allow with data.params as default_params with data.wasm as d
}

# --- chainalysis half denies, vaultsfyi clean ---

test_deny_chainalysis_sanctioned if {
	d := wasm_with("chainalysis", {"sanctioned": true})
	"chainalysis:sanctioned" in vaultsfyi_chainalysis_gate.deny with data.params as default_params with data.wasm as d
	not vaultsfyi_chainalysis_gate.allow with data.params as default_params with data.wasm as d
}

test_deny_chainalysis_blocklisted_category if {
	d := wasm_with("chainalysis", {"risk_categories": ["mixer", "exchange"]})
	"chainalysis:risk_category_blocklisted" in vaultsfyi_chainalysis_gate.deny with data.params as default_params with data.wasm as d
	not vaultsfyi_chainalysis_gate.allow with data.params as default_params with data.wasm as d
}

# --- per-pack param toggles work independently across the namespaces ---

test_chainalysis_sanctioned_toggle_off_still_allows if {
	p := object.union(default_params, {"chainalysis": object.union(default_params.chainalysis, {"deny_on_sanctioned": false})})
	d := wasm_with("chainalysis", {"sanctioned": true})
	not "chainalysis:sanctioned" in vaultsfyi_chainalysis_gate.deny with data.params as p with data.wasm as d
	vaultsfyi_chainalysis_gate.allow with data.params as p with data.wasm as d
}

# --- both halves deny simultaneously — no fail-open, both reasons present ---

test_both_oracles_deny_no_fail_open if {
	d := object.union(clean_wasm, {
		"vaultsfyi": object.union(clean_vaultsfyi, {"is_corrupted": true}),
		"chainalysis": object.union(clean_chainalysis, {"sanctioned": true}),
	})
	deny := vaultsfyi_chainalysis_gate.deny with data.params as default_params with data.wasm as d
	"vaultsfyi:corrupted" in deny
	"chainalysis:sanctioned" in deny
	count(deny) >= 2
	not vaultsfyi_chainalysis_gate.allow with data.params as default_params with data.wasm as d
}

# --- fail-closed when EITHER oracle errors (the composite-specific guarantee) ---

# NOTE: construct the merged wasm explicitly (NOT via object.union) so the
# erroring oracle's slice is FULLY replaced by `{"error": ...}`. object.union
# deep-merges, which would keep the clean fields and only add an `error` key —
# masking the fail-closed behavior we're trying to assert.
test_fail_closed_on_vaultsfyi_oracle_error if {
	d := {"vaultsfyi": {"error": "vaultsfyi api unreachable"}, "chainalysis": clean_chainalysis}
	not vaultsfyi_chainalysis_gate.allow with data.params as default_params with data.wasm as d
}

test_fail_closed_on_chainalysis_oracle_error if {
	d := {"vaultsfyi": clean_vaultsfyi, "chainalysis": {"error": "chainalysis api unreachable"}}
	not vaultsfyi_chainalysis_gate.allow with data.params as default_params with data.wasm as d
}

test_fail_closed_on_empty_payload if {
	not vaultsfyi_chainalysis_gate.allow with data.params as default_params with data.wasm as {"vaultsfyi": {}, "chainalysis": {}}
}

# --- nullable risk_score legitimately does NOT deny ---

test_vaultsfyi_null_risk_score_does_not_deny if {
	d := wasm_with("vaultsfyi", {"risk_score": null})
	not "vaultsfyi:risk_below_floor" in vaultsfyi_chainalysis_gate.deny with data.params as default_params with data.wasm as d
	vaultsfyi_chainalysis_gate.allow with data.params as default_params with data.wasm as d
}
