# pharos_redemption

## Overview

This policy admits a stablecoin only when it can actually be **redeemed at par**, using [Pharos](https://pharos.watch). Market price says nothing about whether a holder can convert back to the underlying; this pack gates on the redemption path itself:

- Direct redemption must be **available**.
- The **provider and mechanism** must be approved.
- Applicable **limits** must support the intended position size.
- The oracle response must be **current**.

Requires a Pharos API key (`PHAROS_API_KEY`).

## How it works

### Data Oracle (policy.js)

Two GET requests against `https://api.pharos.watch`, authenticated with the `X-API-Key` header:

1. `/api/redemption-backstops` — stablecoin-keyed redemption map.
2. `/api/stablecoin-reserves/{id}` — reserve composition and provenance.

"Available" means Pharos actually reported a route for this asset — an absent entry is a genuine "no redemption path", not a soft null.

| Field | Description |
|---|---|
| `stablecoin_id` / `symbol` | Asset identity |
| `redemption_available` | Whether a route was reported at all |
| `route_family` / `access_model` / `settlement_model` | How redemption works, who may use it, how it settles |
| `route_status` | Route health (`active`, `impaired`, ...) |
| `holder_eligibility` | Who qualifies to redeem |
| `immediate_capacity_usd` / `daily_limit_usd` / `min_redeem_usd` | Capacity and limits |
| `daily_limit_multiple` | `daily_limit_usd / transaction_amount_usd`, or `null` when no amount was supplied |
| `fees_bps` / `confidence` | Cost and Pharos's confidence in the route |
| `reserve_composition` / `reserve_source_mode` / `reserve_sync_status` | Backing evidence |
| `data_age_seconds` | Oldest age across both responses |
| `timestamp` | When this snapshot was taken |

### Policy Rules (policy.rego)

Package `pharos_redemption_backing`. Denies when **any** of these hold:

| Deny reason | Condition | What it catches |
|---|---|---|
| `redemption_unavailable` | `require_redemption_available` and no route | No redemption path at all |
| `unapproved_route_family` | family not approved | Redemption through an out-of-policy mechanism |
| `unapproved_access_model` | access model not approved | The wrong parties can redeem |
| `unapproved_settlement_model` | settlement model not approved | Settlement slower than the curator accepts |
| `route_status_not_approved` | status is not `required_route_status` | An impaired or suspended route |
| `below_min_redeem` | position below `min_redeem_usd` | A position too small to ever be redeemed |
| `position_exceeds_daily_limit` | multiple below `min_daily_limit_multiple` | A position that cannot be exited without queueing across days |
| `low_confidence` | confidence below `min_confidence` | A route Pharos is unsure about |
| `stale_data` | age over `max_data_age_seconds` | Decisions made on stale data |

`allow` is an explicit positive conjunction, not `count(deny) == 0`. Every deny rule silent-skips on an undefined field, so an error envelope would produce an empty deny set and a `count(deny) == 0` formulation would **fail open** on exactly the payload that most needs to fail closed. The groundedness checks at the top of `allow` are what enforce that.

### Policy Parameters

| Param | Type | Description |
|---|---|---|
| `require_redemption_available` | `boolean` | Require a working redemption route |
| `approved_route_families` | `string[]` | Acceptable route families |
| `approved_access_models` | `string[]` | Acceptable access models |
| `approved_settlement_models` | `string[]` | Acceptable settlement models |
| `required_route_status` | `string` | The status a route must report, typically `active` |
| `min_confidence` | `number` | Confidence floor 0-1 |
| `min_daily_limit_multiple` | `number` | Daily limit required as a multiple of the position |
| `max_data_age_seconds` | `number` | Freshness ceiling |

## Notes

- **`transaction_amount_usd` is caller-supplied and NOT attested.** It arrives through `wasm_args`, so a caller controls it. The attested alternative — `input.value` — is native-token wei rather than USD, and arrives as a *string*. A curator needing a tamper-proof ceiling should pair this pack with a native-value cap in a composite.
- `null` is the oracle's "not reported", deliberately distinct from `0`. Null optional fields fail-soft; a **missing** key leaves the groundedness checks undefined and correctly blocks `allow`.
- **A position below `min_redeem_usd` denies**, because it could never be redeemed — the failure this pack exists to prevent, in miniature.
- Passing no `transaction_amount_usd` leaves both size rules undefined and fail-soft, rather than reading a zero position as "below the minimum".

## Prerequisites

```bash
newton-cli doctor
```

## Build

```bash
jco componentize ./pharos_redemption/policy.js \
  --wit ./pharos_redemption/newton-provider.wit \
  -n newton-provider \
  --disable http --disable random --disable fetch-event --disable stdio \
  -o ./pharos_redemption/dist/policy.wasm
```

The `--disable` flags are mandatory — without them the WASM imports `wasi:http`, which the Newton runtime rejects. Verify with `jco print ./pharos_redemption/dist/policy.wasm | grep wasi:http`: only the unused `(export ...)` line should appear, never an `(import ...)`.

## Simulate

```bash
newton-cli policy simulate \
  --wasm-args ./pharos_redemption/configs/wasm_args.json \
  --intent-json ./pharos_redemption/configs/intent.json \
  --policy-params-data ./pharos_redemption/configs/params.json \
  --secrets-file ./pharos_redemption/configs/secrets.json \
  --rego-file ./pharos_redemption/policy.rego \
  --entrypoint pharos_redemption_backing.allow \
  --wasm-file ./pharos_redemption/dist/policy.wasm
```

Run the Rego unit tests with OPA:

```bash
opa test ./pharos_redemption/policy.rego ./pharos_redemption/policy_test.rego ./pharos_redemption/wrapping_test.rego -v
```

## Deploy

See the Quick Start in the [root README](../README.md). This pack ships a reusable **PolicyData oracle**, not a blessed `NewtonPolicy` — curators deploy their own policy (single-pack or composite) referencing the oracle address.

## Deployments

Canonical addresses live in [`deployments.json`](../deployments.json).
