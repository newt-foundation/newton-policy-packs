# arkham_risk

## Overview

This policy denies **risk exposure you can explain**, using [Arkham Intelligence](https://arkm.com). Rather than collapsing everything into one score, it reasons about the actual transaction routes connecting an address to a risky source:

- Direct or near-hop exposure to a **severe** category denies on presence alone.
- More distant exposure denies only when **materially large** or **recent**.
- **Dust** is ignored outright, so a dusting attack cannot brick a wallet.
- The deny set names the offending route, so a reviewer can see *why*.

Requires an Arkham API key (`ARKHAM_API_KEY`).

## How it works

### Data Oracle (policy.js)

Two GET requests against `https://api.arkm.com`, authenticated with the `API-Key` header:

1. `/risk/address/{address}` — risk level, per-category scores, seed status.
2. `/risk/address/{address}/paths` — up to ten paths to risky sources, ranked by contributed USD.

The oracle deliberately emits Arkham's **raw** paths rather than a precomputed verdict. "Severe" is a curator notion that lives in `data.params`, and the Rego filters on it — anything collapsed in the WASM would be a decision the curator can no longer see or tune.

| Field | Description |
|---|---|
| `address` / `chain` | Echoed from wasm_args |
| `risk_level` | Arkham headline risk level |
| `max_score` | Highest category score, or `null` |
| `category_scores` | `{category: score}` map, harvested from Arkham's flat `<name>_score` sibling keys (`hacker_score`, `privacy_score`, `sanctioned_1hop_score`, ...). The aggregate `max_score*` keys are excluded |
| `top_risk_category` | Category driving the headline score |
| `is_seed` | Whether the address is itself a known risky source, not merely exposed to one |
| `hop_distance` / `risk_weighted_incoming_usd` / `risk_weighted_outgoing_usd` | Additional Arkham risk context |
| `paths[]` | `category` (from `risk_category`), `direction`, `hop_distance`, `seed_address`, `score`, `contributed_usd` (from `contribution_usd`), `nodes[]` (flattened from `path_nodes[].address`). `contributed_pct`, `first_seen_days` and `last_seen_days` are always `null` — Arkham does not return them |
| `data_age_seconds` | Age of the Arkham observation, or `null` |
| `timestamp` | When this snapshot was taken |

### Policy Rules (policy.rego)

Package `arkham_risk_exposure`. Paths are filtered in three stages — dust floor, then severity, then distance — and denied as:

| Deny reason | Condition | What it catches |
|---|---|---|
| `seed_address` | `deny_on_seed` and the address is a seed | The address IS the risky source |
| `severe_exposure_within_hops` | severe category within `max_severe_hop_distance` | Direct and near-hop exposure, at any size above dust |
| `material_distant_exposure` | severe, beyond the hop limit, over `material_exposure_usd` | Large exposure further out in the graph |
| `recent_distant_exposure` | severe, beyond the hop limit, within `recent_exposure_days` | Fresh exposure further out. **Currently inert** — see Notes |
| `risk_score_above_max` | score over `max_risk_score` | Elevated headline risk, independent of paths |
| `stale_data` | age over `max_data_age_seconds` | Decisions made on stale intelligence |
| `missing_<field>` | the field is named in `deny_on_missing_fields` and the oracle reported it as `null` | A configured threshold quietly doing nothing because Arkham never reported the value |
| `missing_path_last_seen_days` | `path_last_seen_days` is named in `deny_on_missing_fields` and a severe distant path has no date | Undated exposure slipping past the recency rule entirely |

`deny` is the single source of truth for every rule above, and `allow` consumes it: `not v.error`, the `is_boolean(v.is_seed)` / `is_array(v.paths)` groundedness probes, then `count(deny) == 0`. The probes are load-bearing rather than decorative — every deny rule silent-skips on an undefined field, so an error envelope produces an **empty** deny set, and a bare `count(deny) == 0` would **fail open** on exactly the payload that most needs to fail closed. There is deliberately no parallel set of positive helper rules restating the deny conditions; that duplication is how the two drift apart.

`is_array(v.paths)` is the load-bearing groundedness check here: an error envelope has no `paths` key, every path rule then yields an empty set, and a `count(deny) == 0` formulation would fail open.

**Explainability.** A separate `risk_paths` rule renders each offending route as `"<category> exposure via <seed> at <n> hop(s), $<usd> contributed"`. This is **not** evaluated on-chain — the AVS entrypoint is `arkham_risk_exposure.allow` and nothing else. It exists for `opa eval`, local simulation, and composites that want to surface a reason to an operator.

### Policy Parameters

| Param | Type | Description |
|---|---|---|
| `severe_categories` | `string[]` | Categories treated as severe (e.g. `sanctions`, `hacker`, `mixer`) |
| `max_severe_hop_distance` | `number` | Hops within which severe exposure denies outright |
| `material_exposure_usd` | `number` | USD threshold for distant exposure |
| `recent_exposure_days` | `number` | Recency window for distant exposure |
| `dust_tolerance_usd` | `number` | Paths at or below this are ignored entirely |
| `deny_on_seed` | `boolean` | Deny when the address is itself a risky source |
| `max_risk_score` | `number` | Maximum tolerated headline score 0-100 |
| `max_data_age_seconds` | `number` | Freshness ceiling |
| `deny_on_missing_fields` | `string[]` | Field names whose unreported (`null`) value denies. `path_last_seen_days` is its own entry, covering undated exposure paths |

## Notes

- `null` is the oracle's "not reported", deliberately distinct from `0`. Null optional fields fail-soft; a **missing** key leaves the groundedness checks undefined and correctly blocks `allow`.
- **`deny_on_missing_fields` turns that fail-soft into a deny**, per field. `max_score` and `data_age_seconds` emit `missing_<field>`; `path_last_seen_days` is a separate entry that emits `missing_path_last_seen_days` for a severe distant path Arkham gave no date for — exposure that otherwise slips past the recency rule entirely. ⚠️ `last_seen_days` is always null today (see below), so listing `path_last_seen_days` denies any address with a severe path beyond the hop limit. Because the list is per field, you can require `max_score` without taking that on.
- **Dust tolerance is a strict `>` comparison**, so a path contributing exactly `dust_tolerance_usd` counts as dust and is ignored. Set it to `0` to consider every path.
- A category outside `severe_categories` never trips the hop, materiality or recency rules, however large or direct. Only `max_risk_score` constrains it.
- Path categories and seed addresses are lowercased by the oracle; configure `severe_categories` in lowercase.

- **The `recent_distant_exposure` rule is currently inert.** Arkham's `/risk/address/{a}/paths` returns no first/last transaction timestamps, so `last_seen_days` is always `null` and the rule fail-softs. The field and rule are kept so it activates automatically if Arkham adds timing; `recent_exposure_days` has no effect today. Distant exposure is still caught by `material_distant_exposure` on value.
- **`contributed_pct` is also unavailable**, so size-relative thresholds must use `contributed_usd`.
- **`updated_at` is an ISO-8601 string**, not a unix number, so it is date-parsed rather than passed to `Number()`.
- Arkham reports `risk_level` and category names in mixed case; the oracle lowercases both, so configure `severe_categories` in lowercase.

## Prerequisites

```bash
newton-cli doctor
```

## Build

```bash
jco componentize ./arkham_risk/policy.js \
  --wit ./arkham_risk/newton-provider.wit \
  -n newton-provider \
  --disable http --disable random --disable fetch-event --disable stdio \
  -o ./arkham_risk/dist/policy.wasm
```

The `--disable` flags are mandatory — without them the WASM imports `wasi:http`, which the Newton runtime rejects. Verify with `jco print ./arkham_risk/dist/policy.wasm | grep wasi:http`: only the unused `(export ...)` line should appear, never an `(import ...)`.

## Simulate

```bash
newton-cli policy simulate \
  --wasm-args ./arkham_risk/configs/wasm_args.json \
  --intent-json ./arkham_risk/configs/intent.json \
  --policy-params-data ./arkham_risk/configs/params.json \
  --secrets-file ./arkham_risk/configs/secrets.json \
  --rego-file ./arkham_risk/policy.rego \
  --entrypoint arkham_risk_exposure.allow \
  --wasm-file ./arkham_risk/dist/policy.wasm
```

Run the Rego unit tests with OPA:

```bash
opa test ./arkham_risk/policy.rego ./arkham_risk/policy_test.rego ./arkham_risk/wrapping_test.rego -v
```

## Deploy

See the Quick Start in the [root README](../README.md). This pack ships a reusable **PolicyData oracle**, not a blessed `NewtonPolicy` — curators deploy their own policy (single-pack or composite) referencing the oracle address.

## Deployments

Canonical addresses live in [`deployments.json`](../deployments.json).
