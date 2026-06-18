# vaultsfyi

## Overview

This policy gates DeFi vault curator actions using real-time risk data from the [vaults.fyi](https://vaults.fyi) API. Before a curator can deposit, withdraw, or reallocate funds, the WASM oracle fetches a risk snapshot of the target vault. The Rego policy then evaluates that snapshot against configurable thresholds and blocks the action if any risk condition is triggered.

Use cases:
- Prevent deposits into vaults experiencing abnormal APY spikes (potential exploit/manipulation)
- Block actions when vault TVL drops suddenly (bank-run or exploit indicator)
- Halt operations if the vault's risk score falls below an acceptable floor
- Detect when a vault curator has silently changed the underlying strategy or sub-vault allocations
- Block actions on vaults flagged as critical by vaults.fyi or marked as corrupted

## How it works

### Data Oracle (policy.js)

The WASM oracle calls the vaults.fyi v2 API and returns a JSON snapshot containing:

| Field | Description |
|-------|-------------|
| `apy_current` | Current 1-day total APY |
| `apy_base` | Base APY component (1-day) |
| `apy_reward` | Reward/incentive APY component (1-day) |
| `apy_30d` | 30-day average total APY |
| `apy_z_score` | How far current APY deviates from the 30-day average (higher = more anomalous) |
| `tvl_usd` | Current total value locked in USD |
| `tvl_drawdown_24h_pct` | Percentage TVL decrease over the last 24 hours |
| `tvl_drawdown_7d_pct` | Percentage TVL decrease over the last 7 days |
| `risk_score` | Composite vault risk score from vaults.fyi (0-100, higher = safer) |
| `score_vault_tvl` | Sub-score for vault TVL size |
| `score_protocol_tvl` | Sub-score for protocol-wide TVL |
| `score_holder` | Sub-score for holder distribution |
| `score_network` | Sub-score for network maturity |
| `score_asset` | Sub-score for underlying asset quality |
| `score_penalty` | Total penalty deductions applied to the score |
| `flags` | Active risk flags (array of `{ content, severity }`) |
| `has_critical_flag` | Whether any flag is critical or high severity |
| `capacity_remaining` | Remaining deposit capacity in token units (null if uncapped) |
| `capacity_max` | Maximum vault capacity in token units (null if uncapped) |
| `is_corrupted` | Whether the vault is marked as corrupted by vaults.fyi |
| `allocation_hash` | Hash of protocol, tags, fees, and sub-vault addresses |
| `allocation_changed_since_last` | Whether the allocation hash differs from the last known value |
| `timestamp` | When this snapshot was taken |

### Policy Rules (policy.rego)

The Rego policy blocks a curator action if **any** of these conditions are true:

| Deny Reason | Condition | What it catches |
|-------------|-----------|-----------------|
| `apy_spike` | `apy_z_score > apy_z_max` | Anomalous yield suggesting manipulation or exploit |
| `tvl_drawdown_24h` | `tvl_drawdown_24h_pct > tvl_drawdown_24h_max_pct` | Sudden TVL collapse (bank run, exploit) |
| `tvl_drawdown_7d` | `tvl_drawdown_7d_pct > tvl_drawdown_7d_max_pct` | Sustained TVL bleed over a week |
| `risk_score_below_floor` | `risk_score < risk_score_floor` | Vault doesn't meet minimum safety threshold |
| `allocation_changed` | Allocation hash changed + `deny_on_allocation_change` | Strategy or sub-vault reallocation detected |
| `critical_flag` | `has_critical_flag` + `deny_on_critical_flag` | Vaults.fyi flagged a critical issue |
| `vault_corrupted` | `is_corrupted` + `deny_on_corrupted` | Vault data integrity compromised |
| `nrt_stale` | `nrt_age_seconds > nrt_max_age_seconds` | Oracle data is too old to trust |

### Policy Parameters

Configured by the wallet owner on-chain:

| Parameter | Type | Description |
|-----------|------|-------------|
| `apy_z_max` | number | Maximum allowed APY z-score (e.g., 4.0) |
| `tvl_drawdown_24h_max_pct` | number | Maximum 24h TVL drawdown percentage (e.g., 25) |
| `tvl_drawdown_7d_max_pct` | number | Maximum 7d TVL drawdown percentage (e.g., 50) |
| `risk_score_floor` | number | Minimum acceptable risk score (e.g., 0.6) |
| `deny_on_allocation_change` | boolean | Block if allocation/strategy changed |
| `deny_on_critical_flag` | boolean | Block if vault has critical flags |
| `deny_on_corrupted` | boolean | Block if vault is corrupted |
| `nrt_max_age_seconds` | number | Maximum oracle data age in seconds (e.g., 300) |

### Testing on a non-production network (data-source override)

This pack's data source — the [vaults.fyi](https://vaults.fyi) API — indexes
**production networks only** (no Sepolia or Base Sepolia). A curator testing on
a testnet would get a 404 and the policy would fail closed. To exercise the pack
end-to-end on a testnet, this pack's `prepareQuery` accepts two optional
overrides in its **own options** that point the vaults.fyi lookup at a real
mainnet vault while the Shield still executes on the testnet:

| Option | Effect |
|--------|--------|
| `network` | the vaults.fyi network slug to query (e.g. `"mainnet"`, `"base"`) instead of deriving it from the execution chain |
| `vaultAddress` | the vaults.fyi vault address to score instead of the executed `target` |

Pass them via the SDK's per-call `prepareQueryOptions` keyed by short pack id —
`{ vaultsfyi: { network: "mainnet", vaultAddress: "0x…" } }`. This **decouples
the oracle's data from the vault the Shield actually gates**, so it is a
**testing/demo affordance only**. In production, leave both unset so the risk
envelope describes the same vault the Shield executes against. See
[`docs/CONTRIBUTING.md`](../docs/CONTRIBUTING.md#preparequery-the-target-and-the-data-source)
for the definition of `target` and "data source".

## Prerequisites

```bash
newton-cli doctor
```

## Build

```bash
jco componentize ./vaultsfyi/policy.js \
  --wit ./vaultsfyi/newton-provider.wit \
  -n newton-provider \
  --disable http --disable random --disable fetch-event --disable stdio \
  -o ./vaultsfyi/dist/policy.wasm
```

## Simulate

```bash
newton-cli policy simulate \
  --wasm-args ./vaultsfyi/configs/wasm_args.json \
  --intent-json ./vaultsfyi/configs/intent.json \
  --policy-params-data ./vaultsfyi/configs/params.json \
  --policy-file ./vaultsfyi/policy.rego \
  --wasm-file ./vaultsfyi/dist/policy.wasm
```

## Deploy

This pack ships a reusable **PolicyData oracle** (the WASM built above), not a blessed `NewtonPolicy`. The `policy.rego` here is a **reference implementation** — copy it as the starting point for your own policy and adapt the deny rules to your vault. Publishing the oracle follows the deploy flow in the [root README Quick Start](../README.md#quick-start) (`generate-cids` → `policy-data deploy`). To gate a vault, deploy your own `NewtonPolicy` (single-pack or composite) referencing this pack's `policyData` — see [`docs/writing-composite-policies.md`](../docs/writing-composite-policies.md).

## Deployments

See [`deployments.json`](../deployments.json) at the repo root for deployed contract addresses (`packs.vaultsfyi.<chain_id>.<env>.policyData` — the reusable oracle; you deploy your own policy referencing it).
