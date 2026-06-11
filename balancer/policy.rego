package balancer_pool_risk

import future.keywords

default allow := false

t := data.params
v := data.wasm

deny contains "token_weight_drift" if v.max_token_weight_pct > t.max_token_weight_pct

deny contains "non_allowlisted_token_in_pool" if count(v.non_allowlisted_tokens) > 0

deny contains "underlying_protocol_risk" if {
    t.deny_on_underlying_risk
    v.has_boosted_tokens
}

deny contains "tvl_below_floor" if v.tvl_usd < t.min_tvl_usd

deny contains "tvl_drawdown_24h" if {
    v.tvl_drawdown_24h_pct != null
    v.tvl_drawdown_24h_pct > t.tvl_drawdown_24h_max_pct
}

deny contains "tvl_drawdown_7d" if {
    v.tvl_drawdown_7d_pct != null
    v.tvl_drawdown_7d_pct > t.tvl_drawdown_7d_max_pct
}

allow if {
    v.max_token_weight_pct <= t.max_token_weight_pct
    count(v.non_allowlisted_tokens) == 0
    not underlying_risk_blocks
    v.tvl_usd >= t.min_tvl_usd
    drawdown_24h_ok
    drawdown_7d_ok
}

underlying_risk_blocks if {
    t.deny_on_underlying_risk
    v.has_boosted_tokens
}

drawdown_24h_ok if v.tvl_drawdown_24h_pct == null
drawdown_24h_ok if v.tvl_drawdown_24h_pct <= t.tvl_drawdown_24h_max_pct

drawdown_7d_ok if v.tvl_drawdown_7d_pct == null
drawdown_7d_ok if v.tvl_drawdown_7d_pct <= t.tvl_drawdown_7d_max_pct
