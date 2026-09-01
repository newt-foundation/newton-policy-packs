# arkham_counterparty

## Overview

This policy judges a payment against **the sending wallet's own history**, using [Arkham Intelligence](https://arkm.com). Routine payments to established counterparties clear automatically; anything that breaks the wallet's established pattern stops for human approval:

- A **new recipient** is capped at an introductory amount.
- An **unusually large** payment relative to prior transactions with that counterparty denies.
- A **concentration spike** — one counterparty suddenly dominating activity — denies.
- **Total outflow** running well above the wallet's normal daily level denies.

Requires an Arkham API key (`ARKHAM_API_KEY`).

## How it works

### Data Oracle (policy.js)

Two GET requests against `https://api.arkm.com`, authenticated with the `API-Key` header:

1. `/counterparties/address/{sender}` — counterparties aggregated by USD volume, with transaction counts and labels.
2. `/flow/address/{sender}` — inflow/outflow time series used to derive the outflow baseline.

The baseline deliberately excludes the most recent bucket: that bucket is what is being judged, and including it would let a single anomalous day inflate its own baseline and hide itself.

| Field | Description |
|---|---|
| `sender_address` / `destination_address` | Echoed from wasm_args |
| `chains` | Chain scope used, or `null` for all |
| `is_known_counterparty` | Whether the destination appears in the sender's history |
| `counterparty_transaction_count` | Prior transactions with this counterparty |
| `counterparty_total_usd` | Cumulative USD transacted with them |
| `counterparty_avg_usd` | Average prior transaction size, or `null` when there is no history to average |
| `counterparty_last_seen_days` | Always `null` — Arkham's counterparties endpoint returns no per-relationship timestamp |
| `counterparty_concentration_pct` | This counterparty's share (0-100) of recent activity |
| `normal_daily_outflow_usd` | Mean daily outflow across the window, excluding the latest bucket |
| `recent_daily_outflow_usd` | Latest bucket's outflow |
| `outflow_ratio` | `recent / normal`, or `null` when no baseline exists |
| `transaction_amount_usd` | Echoed from wasm_args — see the attestation note below |
| `timestamp` | When this snapshot was taken |

### Policy Rules (policy.rego)

Package `arkham_counterparty_activity`. Denies when **any** of these hold:

| Deny reason | Condition | What it catches |
|---|---|---|
| `unknown_counterparty` | `require_known_counterparty` and unknown | New recipients, when the curator forbids them outright |
| `new_counterparty_over_limit` | unknown and amount over `max_new_counterparty_usd` | A first payment larger than the introductory cap |
| `counterparty_too_new` | known but fewer than `min_counterparty_transactions` prior txs | A relationship too thin to count as established |
| `stale_relationship` | last seen over `max_counterparty_last_seen_days` ago | A dormant counterparty reactivating. **Currently inert** — see Notes |
| `amount_anomaly` | amount over `max_amount_vs_avg_multiple` x the historical average | A payment wildly out of scale with the relationship |
| `concentration_spike` | share over `max_counterparty_concentration_pct` | One destination suddenly dominating outflow |
| `outflow_above_baseline` | ratio over `max_outflow_vs_baseline_multiple` | The wallet draining faster than it normally does |
| `stale_data` | age over `max_data_age_seconds` | Decisions made on stale intelligence |
| `misconfigured_max_amount_vs_avg_multiple` | `max_amount_vs_avg_multiple` is absent or not > 0 | A multiplier that would silently disable the anomaly rule instead of tightening it |
| `missing_<field>` | the field is named in `deny_on_missing_fields` and the oracle reported it as `null` | A configured threshold quietly doing nothing because Arkham never reported the value |

`deny` is the single source of truth for every rule above, and `allow` consumes it: `not v.error`, the `is_boolean(v.is_known_counterparty)` / `is_number(amount)` groundedness probes, then `count(deny) == 0`. The probes are load-bearing rather than decorative — every deny rule silent-skips on an undefined field, so an error envelope produces an **empty** deny set, and a bare `count(deny) == 0` would **fail open** on exactly the payload that most needs to fail closed. There is deliberately no parallel set of positive helper rules restating the deny conditions; that duplication is how the two drift apart.

### Policy Parameters

| Param | Type | Description |
|---|---|---|
| `require_known_counterparty` | `boolean` | Refuse any destination absent from history |
| `max_new_counterparty_usd` | `number` | Introductory cap for a first payment |
| `min_counterparty_transactions` | `number` | Prior transactions before a relationship is established |
| `max_counterparty_last_seen_days` | `number` | Recency ceiling for the relationship |
| `max_amount_vs_avg_multiple` | `number` | Amount ceiling as a multiple of the historical average |
| `max_counterparty_concentration_pct` | `number` | Concentration ceiling 0-100 |
| `max_outflow_vs_baseline_multiple` | `number` | Outflow ceiling as a multiple of normal |
| `max_data_age_seconds` | `number` | Freshness ceiling |
| `deny_on_missing_fields` | `string[]` | Field names whose unreported (`null`) value denies. **Two entries deny everything today** — see Notes |

## Notes

- **`transaction_amount_usd` is caller-supplied and NOT attested.** It arrives through `wasm_args`, so a caller controls it. The attested alternative — `input.value` — is native-token wei rather than USD, and arrives as a *string*. A curator needing a tamper-proof ceiling should pair this pack with a native-value cap in a composite.
- `null` is the oracle's "not reported", deliberately distinct from `0`. By default a null optional field fails soft; a **missing** key leaves the groundedness probes undefined and correctly blocks `allow`.
- **`deny_on_missing_fields` turns that fail-soft into a deny, per field.** List any of `counterparty_last_seen_days`, `counterparty_avg_usd`, `counterparty_concentration_pct`, `outflow_ratio`, `data_age_seconds` and a `null` on that field emits `missing_<field>`. ⚠️ **`counterparty_last_seen_days` and `data_age_seconds` are always null today** (see the next two bullets), so listing either denies *every* transaction until Arkham exposes them. The list is per field precisely so that does not hold the others hostage: you can require `outflow_ratio` and `counterparty_avg_usd` and leave the two inert fields out.
- A **zero or null historical average** does not deny. A zero average would make every payment infinitely anomalous, so `counterparty_avg_usd` is emitted as `null` when there is no history and the anomaly rule skips. That leaves a real gap: a counterparty whose average is a genuine `0` admits any amount through `amount_anomaly`, gated only by the other rules. Closing it needs a notion of "expected size" this API does not provide, so it is deliberately out of scope — lean on `max_new_counterparty_usd` and `max_outflow_vs_baseline_multiple` instead.
- **`max_amount_vs_avg_multiple` must be greater than zero.** A `0` would silently disable the anomaly rule rather than tightening it, so an absent or non-positive value denies with `misconfigured_max_amount_vs_avg_multiple`. The check lives in Rego rather than `params_schema.json` because `exclusiveMinimum` is outside the regorus-clean keyword set the AVS-side schema sticks to.
- `data_age_seconds` is currently always `null` — the Arkham counterparties and flow endpoints do not expose an observation timestamp. The `stale_data` rule is wired and will activate as soon as one is available.

- **`chains` is required.** Unscoped, `/flow/address` returns every chain's full daily history — over 1MB for an active wallet, which exhausts the WASM heap. Scoping to one chain brings it to roughly 270KB.
- **The `stale_relationship` rule is currently inert.** Arkham's counterparties endpoint exposes no per-relationship timestamp, so `counterparty_last_seen_days` is always `null` and the rule fail-softs. The field and rule are kept so it activates automatically if Arkham adds timing; the param is documented but has no effect today — and naming the field in `deny_on_missing_fields` would deny on it unconditionally.
- **`history_window_days` materially changes the counterparty set.** A 90-day window on a wallet whose large relationships are older returns only small, recent ones — so an "established" counterparty can read as new. Widen the window to match the relationships you intend to recognise.
- Aggregation deliberately uses plain objects and indexed loops rather than `Map`: a `Map` over the ~1,950-day flow series crashes the WASM component outright. See [`docs/CONTRIBUTING.md`](../docs/CONTRIBUTING.md#do-not-use-map-or-set-for-anything-large).

## Prerequisites

```bash
newton-cli doctor
```

## Build

```bash
jco componentize ./arkham_counterparty/policy.js \
  --wit ./arkham_counterparty/newton-provider.wit \
  -n newton-provider \
  --disable http --disable random --disable fetch-event --disable stdio \
  -o ./arkham_counterparty/dist/policy.wasm
```

The `--disable` flags are mandatory — without them the WASM imports `wasi:http`, which the Newton runtime rejects. Verify with `jco print ./arkham_counterparty/dist/policy.wasm | grep wasi:http`: only the unused `(export ...)` line should appear, never an `(import ...)`.

## Simulate

```bash
newton-cli policy simulate \
  --wasm-args ./arkham_counterparty/configs/wasm_args.json \
  --intent-json ./arkham_counterparty/configs/intent.json \
  --policy-params-data ./arkham_counterparty/configs/params.json \
  --secrets-file ./arkham_counterparty/configs/secrets.json \
  --rego-file ./arkham_counterparty/policy.rego \
  --entrypoint arkham_counterparty_activity.allow \
  --wasm-file ./arkham_counterparty/dist/policy.wasm
```

Run the Rego unit tests with OPA:

```bash
opa test ./arkham_counterparty/policy.rego ./arkham_counterparty/policy_test.rego ./arkham_counterparty/wrapping_test.rego -v
```

## Deploy

See the Quick Start in the [root README](../README.md). This pack ships a reusable **PolicyData oracle**, not a blessed `NewtonPolicy` — curators deploy their own policy (single-pack or composite) referencing the oracle address.

## Deployments

Canonical addresses live in [`deployments.json`](../deployments.json).
