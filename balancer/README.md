# balancer

## Overview

This policy gates vault deposits into [Balancer](https://balancer.fi) v3 pools using the public Balancer GraphQL API. Balancer is itself a vault venue, so before a curator can deposit into a pool, the WASM oracle pulls the live state of the target pool and the Rego policy refuses the deposit if any of three risk dimensions fail:

- **Composition** — the pool is too concentrated in a single token, or contains tokens that aren't on the operator's allow-list.
- **Underlying yield source** — for boosted pools, surfaces nested/wrapped tokens (Aave, Morpho, etc.) and lets the operator deny when underlying-protocol risk is unacceptable.
- **TVL freshness** — current TVL must be above a floor, and 24h/7d drawdowns must be within bounds.

No API key is required.

## How it works

### Data Oracle (policy.js)

The WASM oracle runs two GraphQL queries against `https://api-v3.balancer.fi/`:

1. `poolGetPool(id, chain)` — current pool state (composition, weights, balances, boosted/underlying tokens, current TVL).
2. `poolGetSnapshots(id, chain, range: THIRTY_DAYS)` — daily TVL history. If unavailable for the pool, drawdown fields are returned as `null` and the rules fail-soft.

It returns:

| Field | Description |
|-------|-------------|
| `pool_id` | Pool address / id (lowercased hex string) |
| `chain` | Chain name (e.g. `MAINNET`) |
| `pool_type` | Balancer pool type (e.g. `WEIGHTED`, `STABLE`, `COMPOSABLE_STABLE`) |
| `tvl_usd` | Current pool TVL in USD (from `dynamicData.totalLiquidity`) |
| `tvl_drawdown_24h_pct` | Percentage TVL decrease over the last 24h (or `null` if snapshots unavailable) |
| `tvl_drawdown_7d_pct` | Percentage TVL decrease over the last 7d (or `null`) |
| `token_count` | Number of tokens in the pool |
| `max_token_weight_pct` | Highest single-token weight 0-100. For non-weighted pools, derived from balance proportions |
| `non_allowlisted_tokens` | Pool tokens that are NOT in the wasm-args `allowed_token_addresses` list (lowercased, deduplicated). Empty when the allow-list is empty (rule disabled) |
| `has_boosted_tokens` | True if any token has `hasNestedPool` or an `underlyingToken` |
| `underlying_protocols` | Best-effort identifiers (symbols) of nested/underlying tokens |
| `timestamp` | When this snapshot was taken |

### Policy Rules (policy.rego)

The Rego policy blocks the deposit if **any** of these conditions are true:

| Deny Reason | Condition | What it catches |
|-------------|-----------|-----------------|
| `token_weight_drift` | `max_token_weight_pct > max_token_weight_pct` (param) | Pool too concentrated in one token |
| `non_allowlisted_token_in_pool` | `count(non_allowlisted_tokens) > 0` | Pool contains tokens outside the operator's allow-list |
| `underlying_protocol_risk` | `has_boosted_tokens` + `deny_on_underlying_risk` | Boosted/wrapped tokens introduce additional protocol risk |
| `tvl_below_floor` | `tvl_usd < min_tvl_usd` | Pool too small to absorb a deposit safely |
| `tvl_drawdown_24h` | `tvl_drawdown_24h_pct > tvl_drawdown_24h_max_pct` | Sudden TVL collapse |
| `tvl_drawdown_7d` | `tvl_drawdown_7d_pct > tvl_drawdown_7d_max_pct` | Sustained TVL bleed |

### Policy Parameters

Configured by the wallet owner on-chain:

| Parameter | Type | Description |
|-----------|------|-------------|
| `max_token_weight_pct` | number | Maximum allowed single-token concentration 0-100 (e.g. 80 to allow 80/20 pools) |
| `deny_on_underlying_risk` | boolean | Block on boosted-pool / nested-protocol risk |
| `min_tvl_usd` | number | Minimum acceptable pool TVL in USD |
| `tvl_drawdown_24h_max_pct` | number | Maximum allowed 24h TVL drawdown percentage |
| `tvl_drawdown_7d_max_pct` | number | Maximum allowed 7d TVL drawdown percentage |

The token allow-list (`allowed_token_addresses`) is **not** a parameter — it lives in `wasm_args` because it's a per-evaluation input, not a long-lived threshold. An empty list disables the allow-list rule.

## Notes

- Balancer v3 GraphQL API: `https://api-v3.balancer.fi/`. No API key required.
- The `allowed_token_addresses` allow-list lives in `wasm_args` (per-evaluation), not in `params`, since the relevant token set typically depends on which pool is being evaluated. Addresses are lowercased before comparison.
- TVL history may not be available for every pool. When the snapshots query returns nothing (or fails), `tvl_drawdown_24h_pct` and `tvl_drawdown_7d_pct` are emitted as `null` and the corresponding rules fail-soft (do not deny). The `tvl_below_floor` check still applies.
- For non-weighted pools (e.g. composable stable), `max_token_weight_pct` is derived from token balance proportions rather than configured weights.

## Prerequisites

```bash
newton-cli doctor
```

## Build

```bash
jco componentize ./balancer/policy.js \
  --wit ./balancer/newton-provider.wit \
  -n newton-provider \
  --disable http --disable random --disable fetch-event --disable stdio \
  -o ./balancer/dist/policy.wasm
```

## Simulate

```bash
newton-cli policy simulate \
  --wasm-args ./balancer/configs/wasm_args.json \
  --intent-json ./balancer/configs/intent.json \
  --policy-params-data ./balancer/configs/params.json \
  --policy-file ./balancer/policy.rego \
  --wasm-file ./balancer/dist/policy.wasm
```

## Deploy

This pack ships a reusable **PolicyData oracle** (the WASM built above), not a blessed `NewtonPolicy`. The `policy.rego` here is a **reference implementation** — copy it as the starting point for your own policy and adapt the deny rules to your vault. Publishing the oracle follows the deploy flow in the [root README Quick Start](../README.md#quick-start) (`generate-cids` → `policy-data deploy`). To gate a vault, deploy your own `NewtonPolicy` (single-pack or composite) referencing this pack's `policyData` — see [`docs/writing-composite-policies.md`](../docs/writing-composite-policies.md).

## Deployments

See [`deployments.json`](../deployments.json) at the repo root for the deployed oracle address (`packs.balancer.<chain_id>.<env>.policyData` — the reusable oracle; you deploy your own policy referencing it).
