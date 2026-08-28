# arkham_entity

## Overview

This policy tiers a spending limit by **who the destination actually is**, using [Arkham Intelligence](https://arkm.com). Arkham connects on-chain addresses to real-world entities, so instead of a flat allow/deny this pack gives an autonomous wallet graduated authority:

- A **verified, approved-category** destination (exchange, custodian, established protocol) gets the full tier.
- An **unlabelled** destination gets a small introductory cap.
- A **low-confidence** attribution denies, so a human can approve it out of band.
- A **prohibited risk tag** denies outright, at any size.

Requires an Arkham API key (`ARKHAM_API_KEY`).

## How it works

### Data Oracle (policy.js)

Two GET requests against `https://api.arkm.com`, authenticated with the `API-Key` header:

1. `/intelligence/address_enriched/{address}/all?includeTags=true&includeEntityPredictions=true&includeClusters=true` — entity attribution, address label, populated tags, predictions.
2. `/risk/address/{address}` — headline risk level and score.

Arkham returns **per-chain** results, because the same address can carry different labels and activity on different networks. When `chain` is supplied the oracle takes that slice; otherwise it takes the first populated one and reports which, so the decision is traceable to a specific network rather than silently blending several.

| Field | Description |
|---|---|
| `address` | The queried destination address |
| `chain` | The chain slice actually used (echoed, may differ from the request when omitted) |
| `has_attribution` | True when Arkham has either a verified entity or a prediction |
| `entity_name` | Real-world entity behind the address, or `null` |
| `entity_category` | Arkham entity category (e.g. `cex`, `custodian`, `defi`), or `null` |
| `address_role` | The address's function — deposit address, hot wallet, cold wallet |
| `tags` | Behavioural/risk tags, lowercased and deduplicated |
| `attribution_type` | `verified`, `predicted`, or `none` |
| `attribution_confidence` | Confidence 0-1 for the match, or `null` when unknown |
| `risk_level` | Arkham headline risk level |
| `max_risk_score` | Highest category score driving the risk level, or `null` |
| `transaction_amount_usd` | Echoed from wasm_args — see the attestation note below |
| `data_age_seconds` | Age of the Arkham observation, or `null` |
| `timestamp` | When this snapshot was taken |

### Policy Rules (policy.rego)

Package `arkham_entity_wallet`. Denies when **any** of these hold:

| Deny reason | Condition | What it catches |
|---|---|---|
| `prohibited_tag` | any tag in `prohibited_tags` | Sanctioned/hacker/scam/mixer destinations, at any size |
| `no_attribution` | `deny_on_no_attribution` and no attribution | Unlabelled destinations, when the curator wants them refused outright |
| `no_attribution_over_limit` | unattributed and amount over `tier_unlabelled_max_usd` | An unknown address used for more than an introductory amount |
| `unapproved_entity_category` | attributed, category not approved, amount over the intro cap | A known but out-of-policy venue used at scale |
| `low_attribution_confidence` | confidence below `min_attribution_confidence` | Weak entity matches that need human review |
| `amount_over_verified_tier` | amount over `tier_verified_max_usd` | The hard ceiling, applied even to trusted destinations |
| `risk_score_above_max` | score over `max_risk_score` | Elevated headline risk |
| `stale_data` | age over `max_data_age_seconds` | Decisions made on stale intelligence |

`allow` is an explicit positive conjunction, not `count(deny) == 0`. Every deny rule silent-skips on an undefined field, so an error envelope would produce an empty deny set and a `count(deny) == 0` formulation would **fail open** on exactly the payload that most needs to fail closed. The `is_boolean(v.has_attribution)` / `is_number(amount)` groundedness checks are what enforce that.

### Policy Parameters

| Param | Type | Description |
|---|---|---|
| `prohibited_tags` | `string[]` | Tags that deny outright regardless of amount |
| `approved_entity_categories` | `string[]` | Categories qualifying for the full tier |
| `tier_verified_max_usd` | `number` | Hard per-transaction ceiling in USD |
| `tier_unlabelled_max_usd` | `number` | Introductory cap for unattributed / unapproved destinations |
| `min_attribution_confidence` | `number` | Minimum confidence 0-1 to act on an entity match |
| `deny_on_no_attribution` | `boolean` | Refuse unattributed destinations outright |
| `max_risk_score` | `number` | Maximum tolerated headline risk score 0-100 |
| `max_data_age_seconds` | `number` | Freshness ceiling |

## Notes

- **`transaction_amount_usd` is caller-supplied and NOT attested.** It arrives through `wasm_args`, so a caller controls it, and every tier rule rests on it. The attested alternative — `input.value` — is native-token wei rather than USD, and arrives as a *string*. A curator who needs a tamper-proof ceiling should pair this pack with a native-value cap in a composite rather than relying on the USD tiers alone.
- `null` is the oracle's "Arkham did not report this", and is deliberately distinct from `0`. Null optional fields fail-soft. A **missing** key (rather than an explicit null) leaves the groundedness checks undefined and correctly blocks `allow`.
- Tags are lowercased by the oracle; `prohibited_tags` is matched case-sensitively against that normalised form, so configure it in lowercase.

## Prerequisites

```bash
newton-cli doctor
```

## Build

```bash
jco componentize ./arkham_entity/policy.js \
  --wit ./arkham_entity/newton-provider.wit \
  -n newton-provider \
  --disable http --disable random --disable fetch-event --disable stdio \
  -o ./arkham_entity/dist/policy.wasm
```

The `--disable` flags are mandatory — without them the WASM imports `wasi:http`, which the Newton runtime rejects. Verify with `jco print ./arkham_entity/dist/policy.wasm | grep wasi:http`: only the unused `(export ...)` line should appear, never an `(import ...)`.

## Simulate

```bash
newton-cli policy simulate \
  --wasm-args ./arkham_entity/configs/wasm_args.json \
  --intent-json ./arkham_entity/configs/intent.json \
  --policy-params-data ./arkham_entity/configs/params.json \
  --secrets-file ./arkham_entity/configs/secrets.json \
  --rego-file ./arkham_entity/policy.rego \
  --entrypoint arkham_entity_wallet.allow \
  --wasm-file ./arkham_entity/dist/policy.wasm
```

Run the Rego unit tests with OPA:

```bash
opa test ./arkham_entity/policy.rego ./arkham_entity/policy_test.rego ./arkham_entity/wrapping_test.rego -v
```

## Deploy

See the Quick Start in the [root README](../README.md). This pack ships a reusable **PolicyData oracle**, not a blessed `NewtonPolicy` — curators deploy their own policy (single-pack or composite) referencing the oracle address.

## Deployments

Canonical addresses live in [`deployments.json`](../deployments.json).
