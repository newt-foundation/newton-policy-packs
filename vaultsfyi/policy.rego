package vault_risk_rating

# revision: v3 (oracle-error guard + numeric-field guards)

import future.keywords

default allow := false

t := data.params
v := data.wasm

# If the oracle reported an error (WASM caught an exception or missing
# secrets), deny rather than silently allow. Without this guard, an
# error-shaped data.wasm has none of the expected fields, every other
# `deny` rule's body is undefined, and `allow if count(deny) == 0` returns
# true — a false allow.
deny contains sprintf("oracle_error: %s", [v.error]) if v.error

# Defense-in-depth: require the core numeric metrics to exist. If any are
# missing, the oracle output is malformed.
deny contains "oracle_missing_apy_z_score" if not is_number(v.apy_z_score)
deny contains "oracle_missing_tvl_drawdown_24h_pct" if not is_number(v.tvl_drawdown_24h_pct)
deny contains "oracle_missing_tvl_drawdown_7d_pct" if not is_number(v.tvl_drawdown_7d_pct)

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
