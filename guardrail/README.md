# guardrail

## Overview

Gates vault deposits using **Guardrail.so**'s on-chain monitoring. Guardrail watches DeFi protocols in real time and surfaces alerts (governance attacks, oracle drift, exploit chatter, admin-key rotations) plus a per-protocol health score. The pack queries the active alerts for a target vault/protocol and denies the deposit if a high-severity alert is open or the health score is below floor.

Where Blockaid evaluates the *transaction*, vaults.fyi evaluates the *vault metadata*, and Webacy/Chainalysis evaluate the *depositor*, Guardrail evaluates the *protocol's run-time state*. They compose, but solve different problems.

## How it works

### Data Oracle (policy.js)

Calls Guardrail's alerts endpoint (and optionally a health endpoint) for the target. Emits:

| Field | Description |
|-------|-------------|
| `target` | Address or protocol id queried |
| `chain_id` | Chain id passed to Guardrail (or `null`) |
| `active_alert_count` | Number of open alerts for the target |
| `alert_severities` | Sorted, deduplicated list of severity strings |
| `alerts` | Normalized alert array (`id`, `severity`, `type`, `timestamp`, `ageSeconds`) |
| `oldest_alert_age_seconds` | Age of the oldest active alert, in seconds (`null` if no alerts) |
| `health_available` | True if the health endpoint returned a usable score |
| `health_score` | Numeric health score, or `null` if not available |
| `timestamp` | Snapshot timestamp (ms) |

### Policy Rules (policy.rego)

| Deny Reason | Condition | What it catches |
|-------------|-----------|-----------------|
| `guardrail_active_alert` | Any `alert_severities[i]` is in `deny_alert_severities` and `deny_on_active_alert` | A live high-severity alert on the target |
| `guardrail_health_below_floor` | `health_available` and `health_score < min_health_score` | Protocol health has degraded |
| `guardrail_alert_stale_data` | `oldest_alert_age_seconds > max_alert_age_seconds` | The alerting data itself is too old to trust |

### Policy Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `deny_on_active_alert` | boolean | Toggle for the active-alert branch |
| `deny_alert_severities` | array<string> | Severities that count as deny-worthy (e.g. `["critical","high"]`) |
| `max_alert_age_seconds` | number | Max allowed age of the oldest alert |
| `min_health_score` | number | Floor on the protocol health score |

## Prerequisites

```bash
newton-cli doctor
```

## Build

```bash
newton-cli policy build -p ./guardrail
```

## Test (Rego unit tests)

```bash
opa test ./guardrail/policy.rego ./guardrail/policy_test.rego -v
```

## Simulate

```bash
newton-cli policy simulate -p ./guardrail
```

## Deploy

```bash
newton-cli policy deploy -p ./guardrail
```

## Deployments

See [`deployments.json`](../deployments.json) at the repo root for deployed contract addresses (`packs.guardrail.<chain_id>.policy` / `policyData`).

## Notes

- **API surface unverified.** Guardrail.so does not publish a stable public REST spec. The base URL (`https://api.guardrail.so`), endpoint paths (`/v1/alerts`, `/v1/health`), auth header (Bearer + `x-api-key` both sent), and response shapes (top-level array vs `{data:[]}` vs `{alerts:[]}`) are best-guess placeholders. Reconfirm against the live dashboard's network calls or with the Guardrail team before mainnet use. The oracle reads each shape defensively so the pack will degrade rather than crash when an assumption is wrong.
- The pack treats a missing/failing health endpoint as "health unavailable" and only fires the alert-branch rules in that case.
