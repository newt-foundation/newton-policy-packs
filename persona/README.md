# persona

## Overview

This policy gates deposits into permissioned vaults (RWA, regulated lending markets, KYC'd yield products) using [Persona](https://withpersona.com) identity verification. Before a wallet can deposit, the WASM oracle looks up the most recent approved Persona inquiry whose `reference-id` matches the sending wallet address. The Rego policy then checks that the inquiry is fresh, the user's country is on the allowed list, the user is old enough, and the relevant verification checks (government ID, selfie, watchlist) have all passed.

KYC enforcement happens at the **transaction-authorization layer** rather than only in the frontend, so a user with a stale, declined, or country-restricted inquiry cannot bypass the gate by hitting the contract directly.

Use cases:
- Restricting a permissioned vault to KYC'd users in approved jurisdictions
- Enforcing minimum-age requirements on regulated yield products
- Blocking deposits from wallets that hit a watchlist or whose government-ID check failed
- Forcing periodic KYC re-verification by capping the age of accepted inquiries

## How it works

### Data Oracle (policy.js)

The WASM oracle calls the Persona v1 API in two steps:

1. `GET /api/v1/inquiries?filter[reference-id]={walletAddress}&page[size]=10`
2. Pick the most recent inquiry with status `approved` or `completed`, then `GET /api/v1/inquiries/{id}?include=verifications`

It returns a JSON snapshot:

| Field | Description |
|-------|-------------|
| `has_inquiry` | Whether an approved inquiry was found for this wallet |
| `status` | Status of the latest approved inquiry (`approved` or `completed`) |
| `age_days` | Days since the inquiry's `completed-at` (falling back to `updated-at`) |
| `country_code` | ISO country code from `attributes["country-code"]`, falling back to `address-country-code`, then `country-of-birth`. `null` if none are present. |
| `age_years` | User age in years computed from `attributes["birthdate"]`. `null` if no birthdate. |
| `government_id_status` | Status of the `verification/government-id` record (`passed`, `failed`, etc.) |
| `selfie_status` | Status of the `verification/selfie` record |
| `watchlist_status` | Status of the `verification/watchlist` record |
| `inquiry_id` | Persona inquiry id for audit/debugging |
| `timestamp` | When this snapshot was taken |

If no approved inquiry is found, every status field is `null` and `has_inquiry` is `false`.

### Policy Rules (policy.rego)

Package: `persona_kyc`. The policy denies the action if **any** of these conditions hold:

| Deny Reason | Condition | What it catches |
|-------------|-----------|-----------------|
| `no_inquiry` | `not has_inquiry` | Wallet has never completed KYC, or the inquiry was never bound to this wallet via `reference-id` |
| `inquiry_not_approved` | Inquiry status is not in `{approved, completed}` | The inquiry exists but is declined / pending / expired |
| `kyc_stale` | `age_days > max_age_days` | The most recent approved inquiry is older than the operator's freshness window |
| `country_not_allowed` | `country_code` is set and not in `allowed_countries` | User is in a restricted jurisdiction |
| `underage` | `age_years` is set and `< min_age_years` | User does not meet minimum-age requirement |
| `id_not_passed` | `government_id_status != "passed"` | Government-ID verification did not pass |
| `selfie_not_passed` | `require_selfie` and `selfie_status != "passed"` | Selfie/liveness check did not pass |
| `watchlist_hit` | `require_watchlist_pass` and `watchlist_status != "passed"` | Sanctions/PEP/watchlist check did not pass |

Both `country_code` and `age_years` rules **fail soft** when the underlying field is `null` — the `no_inquiry` rule already handles the "we don't know who this is" case, and a present-but-incomplete inquiry should not silently be treated as an evasion.

`allow` is true only when `count(deny) == 0`.

### Policy Parameters

Configured by the operator on-chain:

| Parameter | Type | Description |
|-----------|------|-------------|
| `max_age_days` | number | Maximum age in days for the most recent approved inquiry (e.g., `365`) |
| `allowed_countries` | array&lt;string&gt; | ISO 3166-1 alpha-2 codes allowed to deposit (e.g., `["US","GB","CA"]`) |
| `min_age_years` | number | Minimum user age in years (e.g., `18`) |
| `require_selfie` | boolean | Whether to require a passing selfie verification |
| `require_watchlist_pass` | boolean | Whether to require a passing watchlist verification |

## Prerequisites

```bash
newton-cli doctor
```

Set `PERSONA_API_KEY` in your environment (it is forwarded into the WASM oracle as a secret). For simulation, fill the `PERSONA_API_KEY` field in `configs/wasm_args.json` with a Persona sandbox key.

## Build

```bash
newton-cli policy build -p ./persona
```

## Test

```bash
opa test ./persona/policy.rego ./persona/policy_test.rego -v
```

## Simulate

```bash
# Test full policy (WASM + Rego)
newton-cli policy simulate -p ./persona

# With custom args
newton-cli policy simulate -p ./persona \
  --wasm-args ./persona/configs/wasm_args.json \
  --intent-json ./persona/configs/intent.json \
  --policy-params-data ./persona/configs/params.json
```

Note: simulation will fail with an HTTP error unless `PERSONA_API_KEY` in `configs/wasm_args.json` is a real Persona key with access to an inquiry whose `reference-id` matches the `walletAddress`.

## Deploy

```bash
newton-cli policy deploy -p ./persona
```

## Deployments

See [deployments.json](./deployments.json) for deployed contract addresses by chain.

## Notes

**Operator integration requirement.** This policy only works if the integrating frontend creates each Persona Inquiry with `reference-id = wallet_address` (the lowercase 0x-prefixed EVM address that will sign deposit transactions). Without this binding, the oracle has no way to map an inquiry back to the wallet and every deposit will be denied with `no_inquiry`. Use Persona's hosted flow `reference-id` query parameter, or set `attributes.reference-id` when creating an inquiry via the API.

**Country code fallback chain.** Persona surfaces country in several places depending on the inquiry template. The oracle reads `attributes["country-code"]` first, then `attributes["address-country-code"]`, then `attributes["country-of-birth"]`. If none are populated, `country_code` is emitted as `null` and the `country_not_allowed` rule does not fire — operators who require a hard country gate should configure their inquiry template to always populate one of these fields.

**Pagination.** The oracle requests `page[size]=10` of the most recent inquiries for the wallet. If a wallet has more than 10 in-flight inquiries, only the latest page is considered. Approved inquiries are sorted by `completed-at` (then `updated-at`, then `created-at`) and the most recent is used.
