# xerberus_common_cause

## Overview

This policy catches **false diversification**. Positions in Fluid, Morpho and Compound look independent, but they can all depend on the same oracle, hold the same collateral, or lack the same safeguard — and a failure in that shared piece hits them together. Using [Xerberus](https://xerberus.io), it compares the venues a portfolio holds and denies when their shared failure mechanisms exceed curator limits.

Requires a Xerberus enterprise API key (`XERBERUS_API_KEY`).

## How it works

### Data Oracle (policy.js)

One MCP `tools/call` of `common_cause`, POSTed as JSON-RPC 2.0 to `https://mcp.xerberus.io/enterprise/mcp` with the key in the `x-api-key` header. The transport is shared with the other `xerberus_*` packs; see [xerberus_liquidity_exit](../xerberus_liquidity_exit/README.md#data-oracle-policyjs).

| Field | Description |
|---|---|
| `wallets` | Echoed from wasm_args, lowercased |
| `subjects_compared_count` / `scored_subjects_count` | Venues compared, and how many Xerberus could score |
| `total_exposure_usd` | Sum of exposure across the compared venues |
| `unscored_subjects[]` | `{subject, exposure_usd}` for venues Xerberus could not score, largest first |
| `shared_gaps[]` | `{tag, failure_class, subject_count, combined_exposure_usd}` — missing safeguards shared across venues, largest first |
| `largest_shared_gap_exposure_usd` | Largest combined exposure behind one shared gap |
| `shared_dependencies[]` | `{target, connection_types, subject_count}` — declared dependencies shared across venues |
| `shared_collateral[]` | `{token, symbol, subject_count, combined_exposure_usd}` — collateral tokens shared across venues |
| `largest_shared_collateral_exposure_usd` | Largest combined exposure behind one shared collateral token |
| `basis` | Xerberus's basis for the comparison |
| `requested_window` / `data_window` / `window_honored` / `is_stale` / `data_age_seconds` | Freshness, as in the other `xerberus_*` packs |

Arrays are capped at 25 entries, largest first. Failure classes, dependency targets and collateral addresses are lowercased.

### Policy Rules (policy.rego)

Package `xerberus_common_cause`. Deny reasons:

| Deny reason | Fires when |
|---|---|
| `oracle_error` / `malformed_oracle_output` | Oracle error, or a field the rules read is missing |
| `stale_data` | `deny_on_stale` and Xerberus flags the window stale |
| `data_too_old` | `data_age_seconds > max_data_age_seconds` |
| `window_not_honored` | A window was pinned and Xerberus answered from another |
| `shared_gap_limit` | An in-scope shared gap carries more than `max_shared_gap_exposure_usd` |
| `shared_dependency_limit` | A `forbidden_shared_dependencies` target is shared by at least `min_venues_for_shared_dependency` venues |
| `shared_collateral_limit` | One shared collateral token exceeds `max_shared_collateral_pct_of_book` of `total_exposure_usd` |
| `unscored_material_subject` | `deny_on_unscored` and an unscored venue holds at least `material_subject_usd` |
| `insufficient_venues` | Fewer than `min_subjects_compared` venues were compared |
| `wallets_not_bound_to_intent` | `require_intent_party_in_wallets` and neither the intent's sender nor target is an analysed wallet |

The `shared_risks` rule explains what tripped (for example `forbidden dependency protocol:chainlink shared by 3 venues`). It is for `opa eval`, local simulation and composites; the AVS only evaluates `allow`.

### Policy Parameters

| Param | Type | Description |
|---|---|---|
| `max_shared_gap_exposure_usd` | number | Exposure ceiling behind one shared gap. Design reference: 5,000,000 |
| `gap_failure_classes` | string[] | Failure classes the gap limit applies to; empty means all |
| `forbidden_shared_dependencies` | string[] | Dependency targets that must not be shared (e.g. `protocol:chainlink`) |
| `min_venues_for_shared_dependency` | number | Venues that must share a forbidden dependency before it denies. Design reference: 2 |
| `max_shared_collateral_pct_of_book` | number | Shared-collateral ceiling, percent. Design reference: 25 |
| `material_subject_usd` | number | Exposure at which an unscored venue matters |
| `deny_on_unscored` | bool | Deny on material unscored venues |
| `min_subjects_compared` | number | Venues needed for a meaningful comparison. Design reference: 2 |
| `deny_on_stale` | bool | Deny when Xerberus flags the window stale |
| `max_data_age_seconds` | number | Oldest data window accepted |
| `require_intent_party_in_wallets` | bool | Bind the analysed portfolio to the transaction |

## Notes

- **New venues are invisible.** `common_cause` only sees positions that already exist in the supplied wallets, so a transaction entering a brand-new venue cannot be evaluated for shared risk until after it lands. Gate first-time venue entry separately — with a destination-protocol check or manual approval.
- **Collateral share is measured against compared exposure.** `total_exposure_usd` is the exposure across the venues Xerberus compared, which can be smaller than the whole book. That makes the check stricter than a whole-portfolio denominator: in the design scenario WBTC's $3.80M is ~21% of the $17.8M book but ~41% of the $9.31M compared. A composite that also runs `xerberus_what_if` can measure against `book_usd_before` instead.
- **Two venues minimum.** Cross-venue analysis needs at least two Xerberus register-mapped venues; `insufficient_venues` stops a single-venue result from reading as "no shared risk".

## Prerequisites

```bash
newton-cli doctor
```

## Build

```bash
jco componentize ./xerberus_common_cause/policy.js \
  --wit ./xerberus_common_cause/newton-provider.wit \
  -n newton-provider \
  --disable http --disable random --disable fetch-event --disable stdio \
  -o ./xerberus_common_cause/dist/policy.wasm
```

The `--disable` flags are mandatory — without them the WASM imports `wasi:http`, which the Newton runtime rejects. Verify with `jco print ./xerberus_common_cause/dist/policy.wasm | grep wasi:http`: only the unused `(export ...)` line should appear, never an `(import ...)`.

## Simulate

```bash
newton-cli policy simulate \
  --wasm-args ./xerberus_common_cause/configs/wasm_args.json \
  --intent-json ./xerberus_common_cause/configs/intent.json \
  --policy-params-data ./xerberus_common_cause/configs/params.json \
  --secrets-file ./xerberus_common_cause/configs/secrets.json \
  --rego-file ./xerberus_common_cause/policy.rego \
  --entrypoint xerberus_common_cause.allow \
  --wasm-file ./xerberus_common_cause/dist/policy.wasm
```

Run the Rego unit tests with OPA:

```bash
opa test ./xerberus_common_cause/policy.rego ./xerberus_common_cause/policy_test.rego ./xerberus_common_cause/wrapping_test.rego -v
```

## Deploy

See the Quick Start in the [root README](../README.md). This pack ships a reusable **PolicyData oracle**, not a blessed `NewtonPolicy` — curators deploy their own policy (single-pack or composite) referencing the oracle address.

## Deployments

Canonical addresses live in [`deployments.json`](../deployments.json).
