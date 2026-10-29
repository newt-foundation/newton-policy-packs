---
"@newton-xyz/policy-pack-xerberus_liquidity_exit": minor
"@newton-xyz/policy-pack-xerberus_what_if": minor
"@newton-xyz/policy-pack-xerberus_common_cause": minor
"@newton-xyz/policy-pack-registry": minor
---

Add three Xerberus risk-signal packs.

- `xerberus_liquidity_exit` gates a proposed position on Xerberus's `liquidity_exit_quote`: days to exit within a bounded market impact.
- `xerberus_what_if` gates on Xerberus's `what_if` portfolio simulation of a set of market legs: concentration and token HHI deltas, plus 30-day exit ladder and slowest-exit deltas rebuilt from `portfolio_ladder` sale capacity at the same window.
- `xerberus_common_cause` gates on Xerberus's `common_cause` analysis: missing safeguards, dependencies and collateral shared across venues.

`xerberus_liquidity_exit` and `xerberus_what_if` call `https://mcp.xerberus.io/mcp`; `xerberus_common_cause` still calls the enterprise endpoint, where `common_cause` lives. All three send `XERBERUS_API_KEY`, fail closed on stale or malformed data, and accept a `window` so a composite can pin every result to one Xerberus snapshot. `@newton-xyz/policy-pack-registry` adds the three short ids to `KNOWN_PACK_IDS`.

These ship code-only; their `deployments` export stays empty until the oracles are deployed.
