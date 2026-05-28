# chainalysis

## Overview

Gates vault deposits using **Chainalysis** as the source of truth for sanctions and on-chain risk categorization. Chainalysis publishes two relevant APIs:

- **Sanctions Screening API** — public, free, no key required for many deployments. Returns identifications (OFAC, UK HMT, EU CFSP, etc.) for any address. https://docs.chainalysis.com/api/sanctions-screening/
- **Address Screening v2** — paid, key required. Returns a `risk` enum (`low|medium|high|severe`) plus a list of risk categories (e.g. `mixer`, `stolen_funds`, `ransomware`, `darknet_market`). https://docs.chainalysis.com/api/address-screening/

The pack calls both. Sanctions runs first and is mandatory for the gate to be useful; Address Screening is best-effort — if no key is configured, the screening fields are absent and only the sanctions branch can fire.

Use cases beyond vault deposits:
- Custodians (Fireblocks, Anchorage, BitGo) running automated DeFi flows for clients with regulatory obligations.
- Stablecoin issuers gating mint/redeem.
- Permissioned credit pools that need OFAC + category-level filtering.

## How it works

### Data Oracle (policy.js)

| Field | Description |
|-------|-------------|
| `address` | Address looked up |
| `sanctioned` | True if Sanctions Screening returned any identification |
| `sanctions_categories` | Names/categories of any sanctions hits |
| `screening_available` | True if Address Screening v2 succeeded |
| `risk_score` | Address Screening v2 risk enum (`low|medium|high|severe`) or `null` |
| `risk_categories` | Lowercased category strings from Address Screening |
| `is_high_risk` | Convenience boolean: `risk_score in {high, severe}` |
| `timestamp` | Snapshot timestamp (ms) |

The Sanctions Screening response shape varies (`identifications`, `identifiedAddresses`, or a top-level array); the oracle reads each defensively.

### Policy Rules (policy.rego)

| Deny Reason | Condition | What it catches |
|-------------|-----------|-----------------|
| `chainalysis_sanctioned` | `sanctioned` and `deny_on_sanctioned` | Sanctions Screening match |
| `high_risk_address` | `is_high_risk` and `deny_on_high_risk_category` | Address Screening rates address `high` or `severe` |
| `risk_category_blocklisted` | Any `risk_categories[i]` matches `risk_categories_blocklist` | Specific categories the operator wants to refuse |

### Policy Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `deny_on_sanctioned` | boolean | Deny on any Sanctions Screening hit |
| `deny_on_high_risk_category` | boolean | Deny when Address Screening risk enum is `high` / `severe` |
| `risk_categories_blocklist` | array<string> | Lowercased categories to refuse outright |

## Prerequisites

```bash
newton-cli doctor
```

Two API keys can be passed via `wasm_args` (and the runtime's `getSecret`):
- `CHAINALYSIS_SANCTIONS_KEY` — only needed if your Sanctions Screening deployment requires it.
- `CHAINALYSIS_SCREENING_KEY` — Address Screening v2 token. Optional — without it, only the sanctions branch runs.

## Build

```bash
newton-cli policy build -p ./chainalysis
```

## Test (Rego unit tests)

```bash
opa test ./chainalysis/policy.rego ./chainalysis/policy_test.rego -v
```

## Simulate

```bash
newton-cli policy simulate -p ./chainalysis
```

## Deploy

```bash
newton-cli policy deploy -p ./chainalysis
```

## Deployments

See [deployments.json](./deployments.json) for deployed contract addresses by chain.

## Notes

- Sanctions Screening API base: `https://public.chainalysis.com/api/v1/address/{address}`. Address Screening v2 base: `https://api.chainalysis.com/api/risk/v2/entities/{address}`.
- The Address Screening v2 response shape (`risk`, `riskReasons`, `exposures`) is parsed defensively. Reconfirm against live responses before mainnet.
