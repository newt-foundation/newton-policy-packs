# xerberus_what_if

## Overview

This policy catches transactions that look fine in isolation but make the **portfolio** riskier. Using [Xerberus](https://xerberus.io), it simulates the managed book before and after a proposed change and denies one that:

- pushes the largest position past a concentration limit while growing it,
- raises the token Herfindahl-Hirschman index too far,
- erodes the share of the book exitable within 30 days, or
- lengthens the portfolio's slowest exit.

Xerberus recomputes the book's exposure, concentration and per-pool health factors after the change; the pack rebuilds the liquidity clocks from Xerberus's per-token sale capacity at the same window.

Requires a Xerberus enterprise API key (`XERBERUS_API_KEY`).

## How it works

### Data Oracle (policy.js)

MCP `tools/call`s POSTed as JSON-RPC 2.0 to `https://mcp.xerberus.io/mcp` with the key in the `x-api-key` header. The transport is shared with the other `xerberus_*` packs; see [xerberus_liquidity_exit](../xerberus_liquidity_exit/README.md#data-oracle-policyjs).

1. `what_if` with `addresses` = `wallets` and the `legs` — the book before and after: `assets_usd`, `exposure_by_token`, `hhi_token`, per-pool health factors.
2. `portfolio_ladder` for the same wallets, pinned to the window `what_if` answered from — each held token's `max_sale_per_day_usd` at the impact band. A different window throws.
3. `liquidity_exit_quote` for any token in the after-book the ladder did not rung (a token the legs bring in), same window. A different window throws. With more than 8 such tokens the pack throws before any quote, since with steps 1 and 2 that would pass the enclave's 10 HTTP calls per run.

`what_if` no longer reports exit clocks, so the 30-day ladder and slowest exit are computed here, the way Xerberus's own ladder computes them: tokens sell in parallel, each at its per-day capacity; the 30-day ladder is `Σ min(usd, 30 × capacity) / book`, the slowest exit is `max(usd / capacity)`. A token with no depth curve exits nothing within 30 days and is left out of the slowest exit; when the legs increase such a token it is reported as an issue.

| Field | Description |
|---|---|
| `wallets` / `legs` | Echoed from wasm_args (addresses and market keys lowercased) |
| `is_risk_reducing` | `true` when every leg is a removal, debt does not grow, and no levered pool's health factor falls |
| `book_usd_before` / `book_usd_after` | Portfolio value either side of the change |
| `post_largest_token` / `post_largest_token_pct` | Largest position after the change and its share of the book, in percent |
| `pre_largest_token_pct` | That same token's share before the change (0 if not held) |
| `hhi_before` / `hhi_after` / `hhi_delta` | Token HHI (0–1 scale) and its change |
| `ladder_30d_before_pct` / `ladder_30d_after_pct` / `ladder_30d_delta_pp` | Share of the book exitable within 30 days, and its change in percentage points |
| `slowest_exit_days_before` / `slowest_exit_days_after` / `slowest_exit_delta_days` | Slowest token exit and its change |
| `weakest_health_factor_before` / `weakest_health_factor_after` | Lowest per-pool health factor either side (reported, not gated) |
| `issues` / `issues_count` | Xerberus's `notes`, plus any no-depth token the legs increase (first 10) and their count |
| `requested_window` / `data_window` / `latest_window` / `window_honored` / `is_stale` / `data_age_seconds` | Freshness, as in the other `xerberus_*` packs |

Position shares are `exposure_by_token[token] / assets_usd`, in percent. `hhi_delta` uses Xerberus's `delta.hhi_token` and falls back to `after − before`.

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

- **Risk-reducing path.** With `allow_stale_when_risk_reducing` on, a risk-reducing change is exempt from `stale_data` and `data_too_old`, so unavailable data never stops an agent reducing exposure. The delta checks still apply, and the exemption never covers additions. Pulling collateral out of a pool that carries debt lowers its health factor, so it does not count.
- **Concentration only denies when it grows.** A trade that trims an already-concentrated book is not blocked by the level it is reducing.
- **The design scenario denies.** Adding $1M of wstETH collateral to the treasury's crvUSD market (`crvusd:0x100d…`) on the 2026-10-29 12:00 UTC window takes wstETH from 48.0% to 51.0% of the book and token HHI up 0.0119, so `concentration_limit` and `hhi_delta_limit` deny at the design's reference thresholds. The 30-day ladder stays at 100% and the slowest exit grows 2.24 days, inside their limits. Removing the same $1M is allowed.
- **Legs name a market, not a token.** Xerberus simulates venue positions, so each leg is `{action, side, market_uid, usd}`. Find a wallet's market ids with Xerberus's `get_positions`.
- `legs` are caller-supplied; the curator's intent builder is responsible for describing the real change.

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
