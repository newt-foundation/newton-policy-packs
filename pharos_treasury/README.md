# pharos_treasury

## Overview

This policy admits a stablecoin into a treasury only when it is healthy on **all four** dimensions [Pharos](https://pharos.watch) measures — not on price alone:

- No **active depeg**, and current deviation within tolerance.
- **Stress** below threshold — the earlier, broader signal that rises before a full depeg.
- An **approved redemption** route, so the position has a credible exit at par.
- **Exit capacity** comfortably larger than the position being taken on.

Requires a Pharos API key (`PHAROS_API_KEY`).

## How it works

### Data Oracle (policy.js)

Five GET requests against `https://api.pharos.watch`, authenticated with the `X-API-Key` header. **Four of the five are scoped to a single asset** — the Notion brief pointed at bulk endpoints, but Pharos's OpenAPI spec exposes per-asset alternatives that are orders of magnitude smaller:

| Call | Size | Why this one |
|---|---|---|
| `/api/stablecoin-summary/{id}` | ~0.6 KB | Identity, `priceUsd`, peg type/mechanism, supply, chain count. Replaces `/api/stablecoin/{id}`, which is a 345 KB circulating-supply time series with no price in it. |
| `/api/depeg-events?stablecoin={id}&active=true&includePending=true` | ~0.3 KB | Confirmed active incidents. |
| `/api/stress-signals?stablecoin={id}&days={n}` | ~7.5 KB | Stress score, band, per-signal sub-scores. |
| `/api/dex-liquidity-history?stablecoin={id}&days=1` | ~47 KB | Liquidity score, TVL, and the `exitRouteObservations` capacity curves. Replaces `/api/dex-liquidity` (**2.98 MB**, all 377 assets, no query parameters) — a 63x reduction. |
| `/api/redemption-backstops` | 1.1 MB | The one endpoint with **no filter at all**. Its object for this coin is cut out of the raw text and only that ~3 KB is parsed — `JSON.parse` on the full document exhausts the WASM heap. |

**Reading exit capacity correctly.** Each observation's top-level `executableUsd` is capped at its `requestedNotionalUsd`, so a $1M simulation that fills completely reports $1M — which says nothing about the ceiling. The real ladder is `capacityCurve`: successive notionals (100k → 1M → 10M → 25M) each with the `executionCostBps` actually incurred (~9-12 bps for USDC). The oracle walks that curve and takes the largest rung within the caller's `max_cost_bps`. Note that an observation's own `maxCostBps` is the bound the *simulation ran under* (always 200), not the cost incurred — filtering on it would use the wrong number. Across routes it takes the **max**, not the sum: routes overlap (Pharos flags correlation via `commonModeKeys`), so summing double-counts shared liquidity.

| Field | Description |
|---|---|
| `stablecoin_id` / `symbol` / `name` | Asset identity |
| `peg_type` / `peg_mechanism` | e.g. `peggedUSD`, `fiat-backed` |
| `price` / `price_confidence` | Aggregated price and Pharos's confidence in it |
| `peg_target` / `peg_deviation_bps` | Target (1) and **signed** deviation; the Rego threshold is symmetric via `abs()`. `null` when no source could resolve a price — never `0`, which would read as a perfect peg |
| `depeg_active` / `depeg_severity` / `depeg_direction` | Confirmed incident state |
| `depeg_pending_count` | Unconfirmed threshold crossings; does NOT trip `depeg_active` |
| `supply_usd` / `supply_change_7d_usd` / `chain_count` | Market footprint |
| `stress_score` / `stress_band` / `stress_signals` | Stress posture; `stress_signals` is the raw `{name: 0-100}` map |
| `active_stress_indicators` | Convenience view of signals at or above 50. No rule depends on it |
| `liquidity_score` / `effective_tvl_usd` / `volume_24h_usd` / `pool_count` | Liquidity depth |
| `exit_capacity_usd` / `exit_capacity_multiple` | Capacity within `max_cost_bps`, and its ratio to the position |
| `redemption_available` / `redemption_route_family` / `redemption_access_model` / `redemption_route_status` / `redemption_score` | Redemption posture |
| `immediate_capacity_usd` | Redeemable right now |
| `price_data_age_seconds` / `stress_data_age_seconds` / `liquidity_data_age_seconds` / `redemption_data_age_seconds` | Per-source ages — these move on very different clocks |
| `data_age_seconds` | The **oldest** of the above, which is what `stale_data` gates on |
| `timestamp` | When this snapshot was taken |

### Policy Rules (policy.rego)

Package `pharos_treasury_risk`. Denies when **any** of these hold:

| Deny reason | Condition | What it catches |
|---|---|---|
| `active_depeg` | `deny_on_active_depeg` and an incident is active | A confirmed depeg in progress |
| `peg_deviation_above_max` | `abs(deviation)` over `max_peg_deviation_bps` | Drift off peg before an incident is declared |
| `stress_above_max` | stress over `max_stress_score` | Developing stress ahead of a depeg |
| `redemption_unavailable` | `require_redemption` and no route | No credible exit at par |
| `unapproved_redemption_route` | route family not approved | Redemption through an out-of-policy mechanism |
| `unapproved_access_model` | access model not approved | The wrong parties can redeem |
| `route_status_not_approved` | status is not `required_route_status` | A route reported as impaired or suspended |
| `insufficient_exit_capacity` | multiple below `min_exit_capacity_multiple` | A position that cannot realistically be exited |
| `liquidity_score_below_min` | score below `min_liquidity_score` | Thin or fragile DEX liquidity |
| `stale_data` | age over `max_data_age_seconds` | Decisions made on stale data |
| `missing_<field>` | the field is named in `deny_on_missing_fields` and the oracle reported it as `null` | A configured threshold quietly doing nothing because Pharos never reported the value |

`deny` is the single source of truth for every rule above, and `allow` consumes it: `not v.error`, the `is_boolean(v.depeg_active)` / `is_boolean(v.redemption_available)` / `is_number(v.peg_deviation_bps)` groundedness probes, then `count(deny) == 0`. The probes are load-bearing rather than decorative — every deny rule silent-skips on an undefined field, so an error envelope produces an **empty** deny set, and a bare `count(deny) == 0` would **fail open** on exactly the payload that most needs to fail closed. There is deliberately no parallel set of positive helper rules restating the deny conditions; that duplication is how the two drift apart.

### Policy Parameters

| Param | Type | Description |
|---|---|---|
| `deny_on_active_depeg` | `boolean` | Deny outright during a confirmed depeg. Contrast `pharos_safe_mode`'s `safe_mode_on_active_depeg`, which only engages safe mode |
| `max_peg_deviation_bps` | `number` | Symmetric deviation tolerance in bps |
| `max_stress_score` | `number` | Stress ceiling 0-100 |
| `require_redemption` | `boolean` | Require a working redemption route |
| `approved_redemption_route_families` | `string[]` | Acceptable route families |
| `approved_access_models` | `string[]` | Acceptable access models |
| `required_route_status` | `string` | Status a working route must report. Pharos reports **`open`**, not `active` |
| `min_exit_capacity_multiple` | `number` | Required exit capacity as a multiple of the position |
| `min_liquidity_score` | `number` | Liquidity score floor 0-100 |
| `max_data_age_seconds` | `number` | Freshness ceiling on the oldest source. See the note below before tightening it |
| `deny_on_missing_fields` | `string[]` | Field names whose unreported (`null`) value denies. Listing `exit_capacity_multiple` requires every call to supply a position size |

## Notes

- **`transaction_amount_usd` is caller-supplied and NOT attested.** It arrives through `wasm_args`. The attested alternative, `input.value`, is native-token wei (and a *string*), not USD. Pair with a native-value cap in a composite if you need a tamper-proof ceiling.
- **Peg deviation is signed.** A drop below peg trips the same threshold as a rise above it, via `abs()` in the Rego. A naive unsigned comparison would miss the direction that matters most.
- **`route_status` is `open`, not `active`.** Configuring `required_route_status: "active"` — the intuitive guess — denies every healthy asset. There is a test pinning this trap.
- **Freshness ceilings need care.** The four sources move on very different clocks: price and stress refresh in minutes, `dex-liquidity-history` is a **daily bucket** (up to ~24h old by construction), and redemption-backstops lags by hours. `data_age_seconds` is the oldest of them, so a ceiling below ~24h denies permanently. The per-source ages are emitted separately so you can see which feed is actually driving it.
- `null` is the oracle's "not reported", deliberately distinct from `0`. Null optional fields fail-soft; a **missing** key leaves the groundedness checks undefined and correctly blocks `allow`.
- Passing no `transaction_amount_usd` leaves `exit_capacity_multiple` as `null` rather than infinity, so the rule fail-softs rather than reading an unbounded ratio as safe.
- **`deny_on_missing_fields` turns those fail-softs into denies**, per field, emitting a `missing_<field>` reason. Because `exit_capacity_multiple` is null whenever the caller passes no position size, listing it requires every call to supply one — and because the list is per field, you can require the rest without that.
- **`peg_deviation_bps` is the exception: it denies unconditionally when `null`**, as `missing_peg_deviation_bps`. It is not a `deny_on_missing_fields` entry and cannot be opted out of — the peg rule is built on it, and the oracle emitting `0` for an unresolvable price would read as the safest possible input.
- This is the heaviest pack in the repo. Self-serve Pharos keys are rate limited to **30 requests/minute**, and this pack spends 5 of them per evaluation.

- **This pack rides within about 40% of a hard runtime limit.** `/api/redemption-backstops` has no filter, so the oracle downloads all ~1.14MB and slices this coin's ~3KB object out of the raw text. Holding a document and slicing it works to roughly 1.6MB on this runtime; at ~3.5KB per coin that is around 130 more coins of headroom. A `MAX_SLICEABLE_BYTES` guard trips first and returns a readable error (which fails closed) rather than trapping the component with no verdict. The durable fix is a per-asset endpoint from Pharos.

## Prerequisites

```bash
newton-cli doctor
```

## Build

```bash
jco componentize ./pharos_treasury/policy.js \
  --wit ./pharos_treasury/newton-provider.wit \
  -n newton-provider \
  --disable http --disable random --disable fetch-event --disable stdio \
  -o ./pharos_treasury/dist/policy.wasm
```

The `--disable` flags are mandatory — without them the WASM imports `wasi:http`, which the Newton runtime rejects. Verify with `jco print ./pharos_treasury/dist/policy.wasm | grep wasi:http`: only the unused `(export ...)` line should appear, never an `(import ...)`.

## Simulate

```bash
newton-cli policy simulate \
  --wasm-args ./pharos_treasury/configs/wasm_args.json \
  --intent-json ./pharos_treasury/configs/intent.json \
  --policy-params-data ./pharos_treasury/configs/params.json \
  --secrets-file ./pharos_treasury/configs/secrets.json \
  --rego-file ./pharos_treasury/policy.rego \
  --entrypoint pharos_treasury_risk.allow \
  --wasm-file ./pharos_treasury/dist/policy.wasm
```

Run the Rego unit tests with OPA:

```bash
opa test ./pharos_treasury/policy.rego ./pharos_treasury/policy_test.rego ./pharos_treasury/wrapping_test.rego -v
```

## Deploy

See the Quick Start in the [root README](../README.md). This pack ships a reusable **PolicyData oracle**, not a blessed `NewtonPolicy` — curators deploy their own policy (single-pack or composite) referencing the oracle address.

## Deployments

Canonical addresses live in [`deployments.json`](../deployments.json).
