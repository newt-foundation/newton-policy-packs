package vault_risk_rating

import future.keywords

default allow := false

t := data.params
v := data.data

deny_reason := "apy_spike" if v.apy_z_score > t.apy_z_max

deny_reason := "tvl_drawdown_24h" if v.tvl_drawdown_24h_pct > t.tvl_drawdown_24h_max_pct

deny_reason := "tvl_drawdown_7d" if v.tvl_drawdown_7d_pct > t.tvl_drawdown_7d_max_pct

deny_reason := "risk_score_below_floor" if {
    v.risk_score != null
    v.risk_score < t.risk_score_floor
}

deny_reason := "allocation_changed" if {
    v.allocation_changed_since_last
    t.deny_on_allocation_change
}

deny_reason := "nrt_stale" if {
    v.nrt_age_seconds != null
    v.nrt_age_seconds > t.nrt_max_age_seconds
}

allow if not deny_reason
