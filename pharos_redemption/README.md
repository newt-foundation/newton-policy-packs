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

1. `/api/redemption-backstops` — the redemption map. This endpoint takes **no query parameters at all** (confirmed against Pharos's OpenAPI spec) and returns all ~328 coins as a 1.1 MB document. `JSON.parse` on that exhausts the WASM heap, so this coin's object is cut out of the **raw text** and only that ~3 KB is parsed. See [`docs/CONTRIBUTING.md`](../docs/CONTRIBUTING.md#slicing-a-bulk-document-you-cannot-filter).
2. `/api/stablecoin-reserves/{id}` — ~1.4 KB, reserve composition and provenance.

"Available" means Pharos actually reported a route for this asset — an absent entry is a genuine "no redemption path", not a soft null.

| Field | Description |
|---|---|
| `stablecoin_id` / `symbol` / `issuer` | Identity, derived from the `ticker-issuer` id |
| `redemption_available` | Whether a route was reported at all |
| `route_family` / `access_model` / `settlement_model` / `execution_model` | How redemption works, who may use it, how it settles |
| `route_status` | Route health. Pharos reports **`open`** for a working route, not `active` |
| `holder_eligibility` / `provider` / `source_mode` | Who qualifies, and who Pharos attributes the route to |
| `immediate_capacity_usd` / `modeled_exit_size_usd` | What can be redeemed now, and the size Pharos modelled |
| `capacity_multiple` | `immediate_capacity_usd / transaction_amount_usd`, or `null` when no amount was supplied |
| `capacity_confidence` | Qualitative band (e.g. `documented-bound`) — a **string**, not a number |
| `route_score` / `access_score` / `settlement_score` / `capacity_score` | Pharos's 0-100 quality measures |
| `fee_bps` / `queue_enabled` | Cost and whether redemptions queue |
| `reserve_composition` | `{slice name: percentage}` |
| `reserve_elevated_risk_pct` | Share of reserves Pharos rates worse than low risk |
| `reserve_mode` / `reserve_source` / `reserve_sync_status` / `reserve_stale` | Backing provenance |
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
| `position_exceeds_capacity` | multiple below `min_capacity_multiple` | A position larger than what can actually be redeemed now |
| `low_route_score` | score below `min_route_score` | A route Pharos rates poorly |
| `unapproved_capacity_confidence` | band not in `approved_capacity_confidence` | Capacity Pharos cannot evidence |
| `reserve_risk_above_max` | elevated-risk share over `max_reserve_elevated_risk_pct` | Backing concentrated in riskier assets |
| `stale_data` | age over `max_data_age_seconds` | Decisions made on stale data |

`allow` is an explicit positive conjunction, not `count(deny) == 0`. Every deny rule silent-skips on an undefined field, so an error envelope would produce an empty deny set and a `count(deny) == 0` formulation would **fail open** on exactly the payload that most needs to fail closed. The groundedness checks at the top of `allow` are what enforce that.

### Policy Parameters

| Param | Type | Description |
|---|---|---|
| `require_redemption_available` | `boolean` | Require a working redemption route |
| `approved_route_families` | `string[]` | Acceptable route families (observed: `offchain-issuer`) |
| `approved_access_models` | `string[]` | Acceptable access models (observed: `issuer-api`) |
| `approved_settlement_models` | `string[]` | Acceptable settlement models (observed: `same-day`) |
| `required_route_status` | `string` | Status a working route must report — **`open`**, not `active` |
| `min_route_score` | `number` | Minimum 0-100 route score |
| `approved_capacity_confidence` | `string[]` | Acceptable confidence bands; empty array disables the check |
| `min_capacity_multiple` | `number` | Required immediate capacity as a multiple of the position |
| `max_reserve_elevated_risk_pct` | `number` | Max share of reserves rated worse than low risk |
| `max_data_age_seconds` | `number` | Freshness ceiling; the feed lags hours, so keep this generous |

## Notes

- **Pharos publishes no daily limit and no redemption minimum.** The Notion brief mentioned `dailyLimitUsd` and `minRedeemUsd`; neither field exists on this endpoint. Sizing is therefore against `immediateCapacityUsd`, and there is no `below_min_redeem` rule.
- **There is no numeric confidence either.** `capacityConfidence` is a qualitative band (`documented-bound`), so route quality is gated on the 0-100 `route_score`.
- **`route_status` is `open`, not `active`** — configuring `active` denies every healthy asset. A test pins this.
- **`transaction_amount_usd` is caller-supplied and NOT attested.** See the treasury pack's README for the same caveat.
- `null` is the oracle's "not reported", distinct from `0`. Null optional fields fail-soft; a **missing** key blocks `allow`.
- Passing no amount leaves `capacity_multiple` as `null` and the sizing rule fail-softs.

- **This pack rides within about 40% of a hard runtime limit.** `/api/redemption-backstops` has no filter, so the oracle downloads all ~1.14MB and slices this coin's ~3KB object out of the raw text. Holding a document and slicing it works to roughly 1.6MB on this runtime; at ~3.5KB per coin that is around 130 more coins of headroom. A `MAX_SLICEABLE_BYTES` guard trips first and returns a readable error (which fails closed) rather than trapping the component with no verdict. The durable fix is a per-asset endpoint from Pharos.

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
