package vault_risk_rating

import future.keywords

default allow := false

t := data.params

# Phase 0 § Stream B namespacing: every pack's WASM output is wrapped under
# its `PACK_ID` key by `policy.js`'s `wrapOutput("vaultsfyi", ...)` so the
# AVS-side shallow `merge_jsons` composes cleanly across packs without
# top-level key collisions. Read this pack's slice via `.vaultsfyi`.
v := data.wasm.vaultsfyi

deny contains "apy_spike" if v.apy_z_score > t.apy_z_max

deny contains "tvl_drawdown_24h" if v.tvl_drawdown_24h_pct > t.tvl_drawdown_24h_max_pct

deny contains "tvl_drawdown_7d" if v.tvl_drawdown_7d_pct > t.tvl_drawdown_7d_max_pct

deny contains "risk_score_below_floor" if {
    v.risk_score != null
    v.risk_score < t.risk_score_floor
}

deny contains "allocation_changed" if {
    v.allocation_changed_since_last
    t.deny_on_allocation_change
}

deny contains "critical_flag" if {
    v.has_critical_flag
    t.deny_on_critical_flag
}

deny contains "vault_corrupted" if {
    v.is_corrupted
    t.deny_on_corrupted
}

allow if {
    v.apy_z_score <= t.apy_z_max
    v.tvl_drawdown_24h_pct <= t.tvl_drawdown_24h_max_pct
    v.tvl_drawdown_7d_pct <= t.tvl_drawdown_7d_max_pct
    risk_score_ok
    not allocation_change_blocks
    not critical_flag_blocks
    not corrupted_blocks
}

risk_score_ok if v.risk_score == null
risk_score_ok if v.risk_score >= t.risk_score_floor

allocation_change_blocks if {
    v.allocation_changed_since_last
    t.deny_on_allocation_change
}

critical_flag_blocks if {
    v.has_critical_flag
    t.deny_on_critical_flag
}

corrupted_blocks if {
    v.is_corrupted
    t.deny_on_corrupted
}
