package vaultsfyi_chainalysis_gate

import future.keywords

# Composite policy: gate a vault deposit on BOTH vaultsfyi's risk envelope
# AND chainalysis's sanctions screening. One NewtonPolicy, two PolicyData
# oracles (reused from the published packs — no new WASM build).
#
# Namespacing conventions this composite relies on:
#   - WASM outputs:  data.wasm.<short-pack-id>.<field>   (Phase 0 — wrapOutput)
#   - Curator params: data.params.<short-pack-id>.<field> (Phase 1.5 — manifest)
#
# Both halves are namespaced by SHORT pack id ("vaultsfyi", "chainalysis"),
# so the two oracles' outputs never collide even though, e.g., vaultsfyi
# emits `risk_score` as a number and chainalysis emits it as a string.

default allow := false

# vaultsfyi oracle slice + its params slice
vf := data.wasm.vaultsfyi
vfp := data.params.vaultsfyi

# chainalysis oracle slice + its params slice
ca := data.wasm.chainalysis
cap := data.params.chainalysis

# ---------------------------------------------------------------------------
# vaultsfyi deny rules (copied from vaultsfyi/policy.rego, params re-namespaced
# from flat `data.params` to `data.params.vaultsfyi`)
# ---------------------------------------------------------------------------

deny contains "vaultsfyi:apy_spike" if vf.apy_z_score > vfp.apy_z_max

deny contains "vaultsfyi:tvl_drawdown_24h" if vf.tvl_drawdown_24h_pct > vfp.tvl_drawdown_24h_max_pct

deny contains "vaultsfyi:tvl_drawdown_7d" if vf.tvl_drawdown_7d_pct > vfp.tvl_drawdown_7d_max_pct

deny contains "vaultsfyi:risk_below_floor" if {
	vf.risk_score != null
	vf.risk_score < vfp.risk_score_floor
}

deny contains "vaultsfyi:critical_flag" if {
	vf.has_critical_flag
	vfp.deny_on_critical_flag
}

deny contains "vaultsfyi:corrupted" if {
	vf.is_corrupted
	vfp.deny_on_corrupted
}

deny contains "vaultsfyi:allocation_changed" if {
	vf.allocation_changed_since_last
	vfp.deny_on_allocation_change
}

# ---------------------------------------------------------------------------
# chainalysis deny rules (copied from chainalysis/policy.rego, params
# re-namespaced to `data.params.chainalysis`)
# ---------------------------------------------------------------------------

deny contains "chainalysis:sanctioned" if {
	cap.deny_on_sanctioned
	ca.sanctioned
}

deny contains "chainalysis:high_risk" if {
	cap.deny_on_high_risk_category
	ca.is_high_risk
}

deny contains "chainalysis:risk_category_blocklisted" if {
	some cat in ca.risk_categories
	cat in cap.risk_categories_blocklist
}

# ---------------------------------------------------------------------------
# allow: fail-closed. Requires BOTH oracles to be well-formed AND zero denies.
#
# The well-formedness probes (is_number / is_boolean / is_array) are what make
# the composite fail closed: an oracle error payload like
# `{"vaultsfyi": {"error": "..."}}` leaves the numeric fields undefined, so the
# probe fails and `allow` stays at its `default false` — even though no deny
# rule fired against the missing data. This mirrors each pack's standalone
# `allow if { ... }` structure.
#
# `risk_score` is excluded from the probe because it's legitimately nullable;
# the deny rule above guards it with `vf.risk_score != null`.
# ---------------------------------------------------------------------------

allow if {
	# vaultsfyi well-formed
	is_number(vf.apy_z_score)
	is_number(vf.tvl_drawdown_24h_pct)
	is_number(vf.tvl_drawdown_7d_pct)
	is_boolean(vf.has_critical_flag)
	is_boolean(vf.is_corrupted)
	is_boolean(vf.allocation_changed_since_last)

	# chainalysis well-formed
	is_boolean(ca.sanctioned)
	is_boolean(ca.is_high_risk)
	is_array(ca.risk_categories)

	# no deny across either namespace
	count(deny) == 0
}
