# webacy

## Overview

Gates transactions touching **pegged tokens** based on whether the token has been **depegged recently**. Stablecoin issuers, RWA pools, perps backed by yield-bearing stables, and any vault that holds pegged exposure all share the same risk: the peg breaks. Detecting that early — before a slow drift turns into a collapse — keeps depositors out of a sinking ship.

Webacy's depeg-monitor API tracks pegged-asset price vs. expected reference, surfaces structured depeg events, and flags terminal collapses. This pack queries that API for a configurable lookback window and denies when the token shows signs of recent or ongoing depeg.

## How it works

### Data Oracle (policy.js)

Calls `GET https://api.webacy.com/rwa/{address}?hours=N` with `x-api-key`. The lookback window is `lookback_days * 24` hours (default 7 days, capped at 30). Emits a normalized snapshot:

| Field | Description |
|-------|-------------|
| `address` | Token contract address looked up |
| `chain` | Chain filter passed to Webacy (or `null`) |
| `symbol` | Token symbol from the API |
| `is_collapsed` | True if Webacy marks the token as structurally collapsed |
| `lookback_hours` | Window passed to the API |
| `recent_depeg_event_count` | Length of `depegEvents[]` in the window |
| `max_recent_deviation_pct` | Max `deviationPct` across the events (0 if none) |
| `consecutive_days_below_peg` | From `history.consecutive_days_below_peg` |
| `within_expected_range` | From `snapshot.within_expected_range` (defaults true if absent) |
| `abs_dev_clean` | Current absolute deviation from peg |
| `stale` | Webacy's data-freshness flag |
| `timestamp` | Snapshot timestamp (ms) |

### Policy Rules (policy.rego)

The Rego policy denies if **any** of these are true:

| Deny Reason | Condition | What it catches |
|-------------|-----------|-----------------|
| `token_collapsed` | `is_collapsed == true` and `deny_on_collapsed` | Terminal collapse |
| `recent_depeg_events` | `recent_depeg_event_count > max_recent_depeg_events` | Active or freshly-resolved depeg events |
| `consecutive_days_below_peg` | `consecutive_days_below_peg > max_consecutive_days_below_peg` | Sustained drift below peg |
| `stale_oracle_data` | `stale == true` and `deny_on_stale_data` | Webacy flagged the snapshot as stale |

`allow` is structured positively (`allow if { ...positive predicates... }`) so an oracle error / empty payload leaves `allow` at its `default false` instead of fail-opening.

### Policy Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `deny_on_collapsed` | boolean | Deny when the token is structurally collapsed |
| `max_recent_depeg_events` | number | Max depeg events tolerated in the window. 0 = any event denies |
| `max_consecutive_days_below_peg` | number | Max streak tolerated. 0 = any day below peg denies |
| `deny_on_stale_data` | boolean | Deny when Webacy flags `stale: true` |

### WASM Args

| Field | Description |
|-------|-------------|
| `address` | Pegged-token contract address |
| `chain` | Optional Webacy chain identifier (`eth`, `bsc`, `polygon`, ...) |
| `lookback_days` | 1–30 day window for depeg-event counting (default 7) |

## Prerequisites

```bash
newton-cli doctor
```

Webacy requires an API key. Sign up at https://developers.webacy.co/. For sandbox runs, place the key in `configs/wasm_args.json` as `WEBACY_API_KEY`. At deploy time the runtime injects it via `getSecret("WEBACY_API_KEY")`.

## Test (Rego unit tests)

```bash
opa test ./webacy/policy.rego ./webacy/policy_test.rego -v
```

## Build

```bash
jco componentize ./webacy/policy.js \
  --wit ./webacy/newton-provider.wit \
  -n newton-provider \
  --disable http --disable random --disable fetch-event --disable stdio \
  -o ./webacy/dist/policy.wasm
```

## Simulate

```bash
newton-cli policy simulate \
  --wasm-args ./webacy/configs/wasm_args.json \
  --intent-json ./webacy/configs/intent.json \
  --policy-params-data ./webacy/configs/params.json \
  --policy-file ./webacy/policy.rego \
  --wasm-file ./webacy/dist/policy.wasm
```

Without a `WEBACY_API_KEY` set, the WASM oracle will return `{"error": "..."}` from the upstream call and the Rego will deny — exactly as intended (fail closed on missing data).

## Deployments

See [`deployments.json`](../deployments.json) at the repo root for deployed contract addresses (`packs.webacy.<chain_id>.policy` / `policyData`).

## Notes

- API reference: https://docs.webacy.com/api-reference/depeg-monitor/get-depeg-risk-detail-for-a-pegged-token
- The lookback window is set in the WASM (because it's a query-string param on the API), and the threshold for "how many events are too many" is set in Rego params. Operators tuning sensitivity at policy-binding time edit the params; widening or narrowing the observation window itself requires updating `wasm_args`.
