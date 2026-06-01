# sumsub

## Overview

This policy gates vault deposits behind a [SumSub](https://sumsub.com) KYC check at the transaction-authorization layer. Before a wallet can deposit, the WASM oracle looks up the wallet address as an `externalUserId` in SumSub, fetches the applicant's review status, and emits a snapshot. The Rego policy then evaluates that snapshot against on-chain configurable thresholds (allowed countries, minimum age, freshness, required review answer) and blocks the transaction if any check fails.

Use cases:
- Restrict permissioned vaults to KYC'd users
- Enforce per-jurisdiction allow-lists at deposit time
- Prevent stale KYC from indefinitely satisfying policy
- Block deposits from rejected (`RED`) or still-pending applicants

## How it works

### Data Oracle (policy.js)

The WASM oracle makes two HMAC-signed `GET` calls to `api.sumsub.com`:

1. `/resources/applicants/-;externalUserId={walletAddress}/one` — find the applicant
2. `/resources/applicants/{applicantId}/status` — fetch their review state

It returns:

| Field | Description |
|-------|-------------|
| `has_applicant` | Whether SumSub has an applicant for this wallet |
| `applicant_id` | SumSub applicant id (string, or null) |
| `review_status` | `init` / `pending` / `prechecked` / `queued` / `completed` / `onHold` |
| `review_answer` | `GREEN` (passed) / `RED` (rejected) / null (not yet reviewed) |
| `applicant_age_days` | Days since the applicant record was created |
| `country_code` | ISO 3166-1 alpha-2 from the applicant info, or null |
| `age_years` | Whole years derived from applicant date-of-birth, or null |
| `timestamp` | When this snapshot was taken |

### Policy Rules (policy.rego)

Package: `sumsub_kyc`. Set-based deny — `allow` only if `count(deny) == 0`.

| Deny Reason | Condition | What it catches |
|-------------|-----------|-----------------|
| `no_applicant` | `not has_applicant` | Wallet has never been onboarded with SumSub |
| `review_status_not_passing` | `review_answer != required_review_answer` | RED rejection or unreviewed applicant |
| `kyc_stale` | `applicant_age_days > max_age_days` | Verification is older than the configured limit |
| `country_not_allowed` | `country_code not in allowed_countries` | Applicant's jurisdiction is outside the allow-list |
| `underage` | `age_years < min_age_years` | Applicant below required age |
| `pending_review` | `deny_on_pending` and `review_status in {init,pending,prechecked,queued}` | Applicant submitted but not yet reviewed |

### Policy Parameters

Configured by the wallet owner on-chain:

| Parameter | Type | Description |
|-----------|------|-------------|
| `max_age_days` | number | Maximum allowed applicant record age in days |
| `allowed_countries` | array<string> | ISO alpha-2 country allow-list |
| `min_age_years` | number | Minimum applicant age in whole years |
| `required_review_answer` | string | Required `reviewAnswer`, typically `"GREEN"` |
| `deny_on_pending` | boolean | If true, deny while review is still in flight |

### Secrets

Two secrets, both required and injected via `wasm_args`:

| Secret | Purpose |
|--------|---------|
| `SUMSUB_APP_TOKEN` | Sent in the `X-App-Token` header |
| `SUMSUB_SECRET_KEY` | HMAC-SHA256 key used to sign every request |

## Notes

- **Pure-JS HMAC-SHA256.** SumSub authenticates every request with `HMAC-SHA256(secretKey, tsSeconds + method + path + body)`. componentize-js does not reliably expose `crypto.subtle` or `crypto.createHmac`, so SHA-256 (FIPS 180-4) and HMAC are implemented inline in `policy.js`.
- **Self-test at module load.** A single RFC 4231 (test case 1) HMAC-SHA256 vector runs the moment the WASM is instantiated. If the implementation is broken the WASM throws immediately rather than silently signing requests with an incorrect signature. The expected hex is `b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7`.
- **This is the riskiest mechanic in the pack.** A subtle bug in the SHA-256 round, padding, or key-block handling would cause every SumSub request to 401, or — worse, in theory — cause signatures to collide unexpectedly. Sandbox-test against a real SumSub test environment before pointing this at mainnet traffic.
- **404 means "no applicant".** SumSub returns `404` with a JSON body when no applicant exists for the given `externalUserId`. The oracle treats that specifically and emits `has_applicant: false`. Other non-2xx statuses are surfaced as errors.

## Prerequisites

```bash
newton-cli doctor
```

## Build

```bash
newton-cli policy build -p ./sumsub
```

## Simulate

```bash
# Test full policy (WASM + Rego)
newton-cli policy simulate -p ./sumsub

# With custom args
newton-cli policy simulate -p ./sumsub --wasm-args ./sumsub/configs/wasm_args.json --intent-json ./sumsub/configs/intent.json --policy-params-data ./sumsub/configs/params.json
```

## Deploy

```bash
newton-cli policy deploy -p ./sumsub
```
