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

Five GET requests against `https://api.pharos.watch`, authenticated with the `X-API-Key` header:

1. `/api/stablecoin/{id}` — identity, price, peg target, supply, chains.
2. `/api/depeg-events?stablecoin={id}&active=true&includePending=true` — confirmed active incidents.
3. `/api/stress-signals?stablecoin={id}&days={n}` — stress score, band, active signals.
4. `/api/dex-liquidity` — stablecoin-keyed liquidity map.
5. `/api/redemption-backstops` — stablecoin-keyed redemption map.

This is the heaviest pack in the repo at five serial calls per evaluation. It is deliberately not split: this is the one policy that genuinely spans every Pharos signal family. Note that self-serve Pharos keys are rate-limited to 30 requests/minute.

`exit_capacity_usd` reads only observations at or below the caller's `max_slippage_bps`. Including looser observations would overstate exit capacity — precisely the failure this pack exists to catch.

| Field | Description |
|---|---|
| `stablecoin_id` / `symbol` / `issuer` | Asset identity |
| `price` / `peg_target` | Market price and the value the asset targets |
| `peg_deviation_bps` | **Signed** deviation in bps (negative = below peg); the Rego threshold is symmetric via `abs()` |
| `depeg_active` / `depeg_severity` / `depeg_direction` | Active incident state |
| `supply` / `market_cap_usd` / `chains` | Market footprint |
| `stress_score` / `stress_band` / `active_stress_indicators` | Stress posture |
| `liquidity_score` / `effective_tvl_usd` / `pool_count` / `chain_count` / `liquidity_concentration` | Liquidity depth and diversity |
| `exit_capacity_usd` | USD sellable within the slippage tolerance |
| `exit_capacity_multiple` | `exit_capacity_usd / transaction_amount_usd`, or `null` when no amount was supplied |
| `redemption_available` / `redemption_route_family` / `redemption_access_model` / `redemption_route_status` | Redemption posture |
| `daily_limit_usd` / `immediate_capacity_usd` | Redemption capacity |
| `data_age_seconds` | **Oldest** age across all five responses — the weakest link, not the freshest |
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
| `route_status_impaired` | status is not `active` | A route reported as impaired or suspended |
| `insufficient_exit_capacity` | multiple below `min_exit_capacity_multiple` | A position that cannot realistically be exited |
| `liquidity_score_below_min` | score below `min_liquidity_score` | Thin or fragile DEX liquidity |
| `stale_data` | age over `max_data_age_seconds` | Decisions made on stale data |

`allow` is an explicit positive conjunction, not `count(deny) == 0`. Every deny rule silent-skips on an undefined field, so an error envelope would produce an empty deny set and a `count(deny) == 0` formulation would **fail open** on exactly the payload that most needs to fail closed. The groundedness checks at the top of `allow` are what enforce that.

### Policy Parameters

| Param | Type | Description |
|---|---|---|
| `deny_on_active_depeg` | `boolean` | Deny during a confirmed depeg |
| `max_peg_deviation_bps` | `number` | Symmetric deviation tolerance in bps |
| `max_stress_score` | `number` | Stress ceiling 0-100 |
| `require_redemption` | `boolean` | Require a working redemption route |
| `approved_redemption_route_families` | `string[]` | Acceptable route families |
| `approved_access_models` | `string[]` | Acceptable access models |
| `min_exit_capacity_multiple` | `number` | Required exit capacity as a multiple of the position |
| `min_liquidity_score` | `number` | Liquidity score floor 0-100 |
| `max_data_age_seconds` | `number` | Freshness ceiling |

## Notes

- **`transaction_amount_usd` is caller-supplied and NOT attested.** It arrives through `wasm_args`, so a caller controls it. The attested alternative — `input.value` — is native-token wei rather than USD, and arrives as a *string*. A curator needing a tamper-proof ceiling should pair this pack with a native-value cap in a composite.
- `null` is the oracle's "not reported", deliberately distinct from `0`. Null optional fields fail-soft; a **missing** key leaves the groundedness checks undefined and correctly blocks `allow`.
- **Peg deviation is signed.** A drop below peg trips the same threshold as a rise above it, via `abs()` in the Rego. A naive unsigned comparison would miss exactly the direction that matters most.
- Passing no `transaction_amount_usd` leaves `exit_capacity_multiple` as `null` rather than infinity, so the exit-capacity rule fail-softs instead of reading an unbounded ratio as safe.

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
