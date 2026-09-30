# @newton-xyz/policy-pack-xerberus_what_if

## 0.2.0

### Minor Changes

- bd94f0d: Add three Xerberus risk-signal packs.

  - `xerberus_liquidity_exit` gates a proposed position on Xerberus's `liquidity_exit_quote`: days to exit within a bounded market impact.
  - `xerberus_what_if` gates on Xerberus's `what_if` portfolio simulation: concentration, token HHI, 30-day exit ladder and slowest-exit deltas.
  - `xerberus_common_cause` gates on Xerberus's `common_cause` analysis: missing safeguards, dependencies and collateral shared across venues.

  All three call the Xerberus enterprise MCP endpoint with `XERBERUS_API_KEY`, fail closed on stale or malformed data, and accept a `window` so a composite can pin every result to one Xerberus snapshot. `@newton-xyz/policy-pack-registry` adds the three short ids to `KNOWN_PACK_IDS`.

  These ship code-only; their `deployments` export stays empty until the oracles are deployed.
