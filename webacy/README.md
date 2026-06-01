# webacy

## Overview

Gates vault deposits based on the **depositor's wallet reputation**. Vaults — especially permissioned RWA pools, institutional credit pools, and stablecoin issuers — face two flavors of risk from accepting deposits:

1. **Compliance / sanctions exposure.** A wallet on an OFAC list, downstream of a mixer, or directly tied to a named hack puts the operator in regulatory crosshairs.
2. **Reputational / contagion exposure.** Deposits from rug-pull or exploit-proceeds wallets taint the depositor base; sophisticated allocators won't share a vault with addresses that flag as "stolen funds."

Both share the same primitive: score the depositing wallet against a real-time risk database and refuse the deposit if the score is too high. Webacy's address-risk API returns a 0–100 DD Score, threat-category tags, and sanctions/exploit flags across 12+ chains.

Use cases beyond vault deposits:
- Permissioned institutional vaults (Maple, Centrifuge, RWA pools) with KYC/AML obligations.
- DEX LPs and stablecoin issuers refusing mints/redeems from sanctioned counterparties.
- Multisigs filtering counterparties on every outbound interaction.

## How it works

### Data Oracle (policy.js)

Calls `GET https://api.webacy.com/addresses/{address}` with `x-api-key`. Emits a normalized snapshot:

| Field | Description |
|-------|-------------|
| `address` | Wallet address looked up |
| `chain` | Chain filter passed to Webacy (or `null`) |
| `dd_score` | 0–100 DD Score (read from `medium`/`overallRisk`/`ddScore`/`score`, whichever Webacy returns) |
| `bucket` | One of `low` (≤23), `medium` (23–50), `high` (>50), `sanctioned` (any sanctions/OFAC/blocklist tag) |
| `sanctions_hits` | Count of issues whose tags match `sanction|ofac|blocklist` |
| `exploit_exposure_hits` | Count of issues whose tags match `exploit|hack|drainer|stolen` |
| `flag_count` | Total number of issues returned |
| `flag_categories` | Sorted, deduplicated list of all tag strings |
| `timestamp` | Snapshot timestamp (ms) |

The oracle reads the DD Score with `??` chains across `medium`/`overallRisk`/`ddScore`/`score` because Webacy's response field name has varied across versions.

### Policy Rules (policy.rego)

The Rego policy denies if **any** of these are true:

| Deny Reason | Condition | What it catches |
|-------------|-----------|-----------------|
| `sanctioned` | `bucket == "sanctioned"` and `deny_on_sanctioned` | Wallet on a sanctions / blocklist |
| `high_risk` | `bucket == "high"` and `deny_on_high_risk` | DD Score > 50 |
| `exploit_exposure` | `exploit_exposure_hits >= exploit_exposure_hits_max` | Wallet associated with a hack/exploit/drainer |
| `medium_risk_over_cap` | `bucket == "medium"` and `input.deposit_amount_usd > medium_risk_max_deposit_usd` | Medium-risk wallet trying to deposit above the soft cap |

`input.deposit_amount_usd` is read from the intent, so callers must pre-compute the USD value of the deposit and include it in the intent JSON.

### Policy Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `deny_on_sanctioned` | boolean | Deny on any sanctions/OFAC/blocklist hit |
| `deny_on_high_risk` | boolean | Deny when bucket is `high` |
| `exploit_exposure_hits_max` | number | Max allowed exploit-tag hits before denying (e.g. 1) |
| `medium_risk_max_deposit_usd` | number | Soft cap (USD) for medium-risk wallets |

## Prerequisites

```bash
newton-cli doctor
```

Webacy requires an API key. Sign up at https://developers.webacy.co/. For sandbox runs, place the key in `configs/wasm_args.json` as `WEBACY_API_KEY`. At deploy time the runtime injects it via `getSecret("WEBACY_API_KEY")`.

## Build

```bash
newton-cli policy build -p ./webacy
```

## Test (Rego unit tests)

```bash
opa test ./webacy/policy.rego ./webacy/policy_test.rego -v
```

## Simulate

```bash
newton-cli policy simulate -p ./webacy
```

Without a `WEBACY_API_KEY` set, the WASM oracle will return `{"error": "..."}` from the upstream call. Add the key to `configs/wasm_args.json` to exercise the live API.

## Deploy

```bash
newton-cli policy deploy -p ./webacy
```

## Deployments

See [deployments.json](./deployments.json) for deployed contract addresses by chain.

## Notes

- API reference: https://docs.webacy.com/reference/get_addresses-address. The DD Score field name has varied between `medium` and `overallRisk`; the oracle reads both defensively.
- Issue tag vocabulary is not fully documented; the bucketing logic uses regex matching on substrings (`/sanction|ofac|blocklist/`, `/exploit|hack|drainer|stolen/`) so it's robust to minor wording changes. Reconfirm against live responses before mainnet.
