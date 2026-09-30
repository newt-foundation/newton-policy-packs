# xerberus_what_if

## Overview

This policy catches transactions that look fine in isolation but make the **portfolio** riskier. Using [Xerberus](https://xerberus.io), it simulates the managed book before and after a proposed change and denies one that:

- pushes the largest position past a concentration limit while growing it,
- raises the token Herfindahl-Hirschman index too far,
- erodes the share of the book exitable within 30 days, or
- lengthens the portfolio's slowest exit.

Xerberus returns deterministic exposure and liquidity deltas here; it does not rerun a systemic rating or a tail-risk model.

Requires a Xerberus enterprise API key (`XERBERUS_API_KEY`).

## How it works

### Data Oracle (policy.js)

One MCP `tools/call` of `what_if`, POSTed as JSON-RPC 2.0 to `https://mcp.xerberus.io/enterprise/mcp` with the key in the `x-api-key` header. The transport is shared with the other `xerberus_*` packs; see [xerberus_liquidity_exit](../xerberus_liquidity_exit/README.md#data-oracle-policyjs).

| Field | Description |
|---|---|
| `wallets` / `add` / `remove` | Echoed from wasm_args (addresses lowercased) |
| `is_risk_reducing` | `true` for a pure removal (no additions) |
| `book_usd_before` / `book_usd_after` | Portfolio value either side of the change |
| `post_largest_token` / `post_largest_token_pct` | Largest position after the change and its share of the book, in percent |
| `pre_largest_token_pct` | That same token's share before the change (0 if outside the reported top positions) |
| `hhi_before` / `hhi_after` / `hhi_delta` | Token HHI (0–1 scale) and its change |
| `ladder_30d_before_pct` / `ladder_30d_after_pct` / `ladder_30d_delta_pp` | Share of the book exitable within 30 days, and its change in percentage points |
| `slowest_exit_days_before` / `slowest_exit_days_after` / `slowest_exit_delta_days` | Slowest token exit and its change |
| `issues` / `issues_count` | Simulation issues flattened to strings (first 10) and their count |
| `requested_window` / `data_window` / `window_honored` / `is_stale` / `data_age_seconds` | Freshness, as in the other `xerberus_*` packs |

Position shares are derived from `usd / book_usd`, so the unit never depends on whether Xerberus reports `pct` as a fraction or a percentage. Deltas use Xerberus's `delta` block and fall back to `after − before`.

### Policy Rules (policy.rego)

Package `xerberus_portfolio_what_if`. Deny reasons:

| Deny reason | Fires when |
|---|---|
| `oracle_error` / `malformed_oracle_output` | Oracle error, or a field the rules read is missing |
| `stale_data` | `deny_on_stale` and Xerberus flags the window stale (unless exempt, below) |
| `data_too_old` | `data_age_seconds > max_data_age_seconds` (unless exempt) |
| `window_not_honored` | A window was pinned and Xerberus answered from another |
| `concentration_limit` | `post_largest_token_pct > max_post_token_share_pct` **and** that share grew |
| `hhi_delta_limit` | `hhi_delta > max_hhi_delta` |
| `liquidity_30d_deterioration` | `ladder_30d_delta_pp < min_ladder_30d_delta_pp` |
| `slowest_exit_limit` | `slowest_exit_delta_days > max_slowest_exit_delta_days` |
| `simulation_issues` | `deny_on_issues` and Xerberus reported any issue |
| `wallets_not_bound_to_intent` | `require_intent_party_in_wallets` and neither the intent's sender nor target is a simulated wallet |

### Policy Parameters

| Param | Type | Description |
|---|---|---|
| `max_post_token_share_pct` | number | Concentration ceiling, percent. Design reference: 50 |
| `max_hhi_delta` | number | HHI increase ceiling. Design reference: 0.01 |
| `min_ladder_30d_delta_pp` | number | 30-day liquidity floor, in pp (negative). Design reference: −3 |
| `max_slowest_exit_delta_days` | number | Slowest-exit increase ceiling. Design reference: 3 |
| `deny_on_issues` | bool | Deny on any simulation issue |
| `deny_on_stale` | bool | Deny when Xerberus flags the window stale |
| `max_data_age_seconds` | number | Oldest data window accepted |
| `require_intent_party_in_wallets` | bool | Bind the simulated portfolio to the transaction |
| `allow_stale_when_risk_reducing` | bool | Let pure removals through on stale or old data |

## Notes

- **Risk-reducing path.** With `allow_stale_when_risk_reducing` on, a change with removals and no additions is exempt from `stale_data` and `data_too_old`, so unavailable data never stops an agent reducing exposure. The delta checks still apply, and the exemption never covers additions.
- **Concentration only denies when it grows.** A trade that trims an already-concentrated book is not blocked by the level it is reducing.
- **The design scenario denies.** The live $1M wstETH what-if (concentration 50.9% → 53.5%, HHI +0.0128, 30-day ladder −4.32 pp, slowest exit +5.26 days) trips every portfolio limit at the design's reference thresholds, even though its standalone exit quote is under a week.
- `add` and `remove` are caller-supplied; the curator's intent builder is responsible for describing the real change.

## Prerequisites

```bash
newton-cli doctor
```

## Build

```bash
jco componentize ./xerberus_what_if/policy.js \
  --wit ./xerberus_what_if/newton-provider.wit \
  -n newton-provider \
  --disable http --disable random --disable fetch-event --disable stdio \
  -o ./xerberus_what_if/dist/policy.wasm
```

The `--disable` flags are mandatory — without them the WASM imports `wasi:http`, which the Newton runtime rejects. Verify with `jco print ./xerberus_what_if/dist/policy.wasm | grep wasi:http`: only the unused `(export ...)` line should appear, never an `(import ...)`.

## Simulate

```bash
newton-cli policy simulate \
  --wasm-args ./xerberus_what_if/configs/wasm_args.json \
  --intent-json ./xerberus_what_if/configs/intent.json \
  --policy-params-data ./xerberus_what_if/configs/params.json \
  --secrets-file ./xerberus_what_if/configs/secrets.json \
  --rego-file ./xerberus_what_if/policy.rego \
  --entrypoint xerberus_portfolio_what_if.allow \
  --wasm-file ./xerberus_what_if/dist/policy.wasm
```

Run the Rego unit tests with OPA:

```bash
opa test ./xerberus_what_if/policy.rego ./xerberus_what_if/policy_test.rego ./xerberus_what_if/wrapping_test.rego -v
```

## Deploy

See the Quick Start in the [root README](../README.md). This pack ships a reusable **PolicyData oracle**, not a blessed `NewtonPolicy` — curators deploy their own policy (single-pack or composite) referencing the oracle address.

## Deployments

Canonical addresses live in [`deployments.json`](../deployments.json).
