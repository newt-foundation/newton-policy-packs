package vault_risk_rating

import future.keywords

default allow := false

t := data.params
v := data.wasm

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

allow if count(deny) == 0
