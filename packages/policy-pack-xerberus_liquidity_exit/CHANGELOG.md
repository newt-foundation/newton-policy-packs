# @newton-xyz/policy-pack-xerberus_liquidity_exit

## 0.2.0

### Minor Changes

- bd94f0d: Add three Xerberus risk-signal packs.

  - `xerberus_liquidity_exit` gates a proposed position on Xerberus's `liquidity_exit_quote`: days to exit within a bounded market impact.
  - `xerberus_what_if` gates on Xerberus's `what_if` portfolio simulation of a set of market legs: concentration and token HHI deltas, plus 30-day exit ladder and slowest-exit deltas rebuilt from `portfolio_ladder` sale capacity at the same window.
  - `xerberus_common_cause` gates on the upstream nodes a portfolio's venues share, from Xerberus's `shared_dependencies_nodes` over the venues `get_positions` reports: USD and share of the book behind each shared node, its expected loss share, and forbidden node ids.

  All three call `https://mcp.xerberus.io/mcp`, send `XERBERUS_API_KEY`, fail closed on stale or malformed data, and accept a `window` so a composite can pin every result to one Xerberus snapshot. `@newton-xyz/policy-pack-registry` adds the three short ids to `KNOWN_PACK_IDS`.

  These ship code-only; their `deployments` export stays empty until the oracles are deployed.
