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

### Testing on a non-production network (data-source override)

Guardrail's data source — its alert/health API — indexes production protocols
and vaults. A curator testing on a network the API doesn't cover would get no
data and the policy would fail closed. To exercise the pack on a testnet, the
SDK's `prepareQuery` accepts two optional overrides (from `PrepareQueryArgs`)
that point the lookup at a real production target while the Shield still
executes on the testnet:

| Override | Effect |
|----------|--------|
| `dataSourceChainId` | resolve the data source against this chain instead of the execution chain |
| `dataSourceSubject` | use this address as the data-source key instead of the executed `subject` |

This **decouples the data Guardrail evaluates from the vault the Shield actually
gates**, so it is a **testing/demo affordance only**. In production, leave both
unset so the alert/health check describes the same vault the Shield executes
against. See [`docs/CONTRIBUTING.md`](../docs/CONTRIBUTING.md#preparequery-the-subject-and-the-data-source)
for the shared-interface definition of `subject` and "data source".

## Prerequisites

```bash
newton-cli doctor
```

## Build

```bash
jco componentize ./guardrail/policy.js \
  --wit ./guardrail/newton-provider.wit \
  -n newton-provider \
  --disable http --disable random --disable fetch-event --disable stdio \
  -o ./guardrail/dist/policy.wasm
```

## Test (Rego unit tests)

```bash
opa test ./guardrail/policy.rego ./guardrail/policy_test.rego -v
```

## Simulate

```bash
newton-cli policy simulate \
  --wasm-args ./guardrail/configs/wasm_args.json \
  --intent-json ./guardrail/configs/intent.json \
  --policy-params-data ./guardrail/configs/params.json \
  --policy-file ./guardrail/policy.rego \
  --wasm-file ./guardrail/dist/policy.wasm
```

## Deploy

This pack ships a reusable **PolicyData oracle** (the WASM built above), not a blessed `NewtonPolicy`. The `policy.rego` here is a **reference implementation** — copy it as the starting point for your own policy and adapt the deny rules to your vault. Publishing the oracle follows the deploy flow in the [root README Quick Start](../README.md#quick-start) (`generate-cids` → `policy-data deploy`). To gate a vault, deploy your own `NewtonPolicy` (single-pack or composite) referencing this pack's `policyData` — see [`docs/writing-composite-policies.md`](../docs/writing-composite-policies.md).

## Deployments

See [`deployments.json`](../deployments.json) at the repo root for deployed contract addresses (`packs.guardrail.<chain_id>.<env>.policyData` — the reusable oracle; you deploy your own policy referencing it).

## Notes

- **API surface unverified.** Guardrail.so does not publish a stable public REST spec. The base URL (`https://api.guardrail.so`), endpoint paths (`/v1/alerts`, `/v1/health`), auth header (Bearer + `x-api-key` both sent), and response shapes (top-level array vs `{data:[]}` vs `{alerts:[]}`) are best-guess placeholders. Reconfirm against the live dashboard's network calls or with the Guardrail team before mainnet use. The oracle reads each shape defensively so the pack will degrade rather than crash when an assumption is wrong.
- The pack treats a missing/failing health endpoint as "health unavailable" and only fires the alert-branch rules in that case.
