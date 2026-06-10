# redstone

## Overview

This policy gates DeFi vault deposits against **oracle divergence** — the gap between the on-chain price oracle a vault uses and the real market price. On-chain oracles (Chainlink heartbeats, Morpho exchange-rate models) are deliberately conservative and lag the market under stress; during the lag, lending vaults can take on bad debt that gets pushed back to depositors. The pattern shows up repeatedly: stETH/ETH 2022, ezETH/ETH April 2024, sUSDe peg episodes.

The WASM oracle fetches RedStone's median price for the underlying asset and the on-chain oracle's current value (via JSON-RPC `eth_call`) and computes the divergence in basis points. The Rego policy denies the deposit when the divergence crosses a hard cap, when the RedStone feed itself is stale, or — optionally — when divergence has been sustained above a soft threshold across two snapshots.

Use cases:
- LRT/LST-collateralized lending vaults (Morpho, Euler, Aave-style isolated markets)
- PT (Pendle Principal Token) vaults near maturity
- Any vault using a fixed-rate or exchange-rate oracle for non-trivial assets
- Cross-chain wrapped assets where the wrapper price can drift from underlying

## How it works

### Data Oracle (policy.js)

The WASM oracle does two fetches and emits a JSON snapshot:

| Field | Description |
|-------|-------------|
| `symbol` | RedStone symbol queried (e.g. `"ETH"`, `"stETH"`) |
| `provider` | RedStone provider used (default `"redstone"`) |
| `redstone_price` | RedStone median price (numeric) |
| `onchain_price` | On-chain oracle's reported price (numeric, decoded from `eth_call`) |
| `divergence_bp` | `|redstone − onchain| / redstone` in basis points (rounded) |
| `redstone_feed_age_seconds` | Seconds since RedStone signed the price |
| `prev_snapshot_present` | Whether the caller passed a `prevSnapshot` for sustained-drift evaluation |
| `prev_divergence_bp` | `prevSnapshot.divergenceBp` if present, else `null` |
| `sustained_seconds` | Seconds since `prevSnapshot.timestampMs` (0 if no prev snapshot) |
| `timestamp` | Snapshot timestamp (ms) |

### Policy Rules (policy.rego)

The Rego policy denies if **any** of these are true:

| Deny Reason | Condition | What it catches |
|-------------|-----------|-----------------|
| `redstone_feed_stale` | `redstone_feed_age_seconds > max_feed_age_seconds` | RedStone hasn't published a fresh price |
| `divergence_above_hard_cap` | `divergence_bp >= deny_bp` | Current oracle disagreement is too large |
| `divergence_sustained` | `enable_sustained_check` and current + prev divergence both `>= warn_bp` and `sustained_seconds >= deny_sustained_seconds` | Drift in the warn band that has persisted across two snapshots |

The sustained-drift branch is opt-in. When enabled, the integrator must pass `prevSnapshot: { divergenceBp, timestampMs }` in `wasm_args` from the prior evaluation; without it, the rule cannot fire.

### Policy Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `warn_bp` | number | Soft divergence threshold in basis points (e.g. 50) |
| `deny_bp` | number | Hard divergence threshold in basis points (e.g. 100) |
| `deny_sustained_seconds` | number | Min sustained-drift window in seconds (e.g. 1800) |
| `max_feed_age_seconds` | number | Max RedStone feed age in seconds (e.g. 300) |
| `enable_sustained_check` | boolean | Whether to evaluate the sustained-drift branch |

### WASM args (per evaluation)

| Field | Type | Description |
|-------|------|-------------|
| `symbol` | string | RedStone symbol (e.g. `"ETH"`) |
| `provider` | string | Optional. RedStone provider tag, defaults to `"redstone"` |
| `rpcUrl` | string | JSON-RPC URL for the chain the on-chain oracle lives on |
| `onchainOracle.address` | string | Address of the on-chain oracle |
| `onchainOracle.selector` | string | 4-byte selector hex of the price-read call (e.g. `"0x50d25bcd"` for Chainlink `latestAnswer()`) |
| `onchainOracle.decimals` | number | Decimals to scale the raw `eth_call` return (Chainlink USD feeds = 8, ETH feeds = 18) |
| `prevSnapshot.divergenceBp` | number | Optional. Prior snapshot's `divergence_bp` for sustained-drift |
| `prevSnapshot.timestampMs` | number | Optional. Prior snapshot's timestamp |

## Prerequisites

```bash
newton-cli doctor
```

## Build

```bash
newton-cli policy build -p ./redstone
```

## Test (Rego unit tests)

```bash
opa test ./redstone/policy.rego ./redstone/policy_test.rego -v
```

## Simulate

```bash
newton-cli policy simulate -p ./redstone
```

The default `configs/wasm_args.json` queries RedStone for `ETH` and reads Chainlink ETH/USD on Sepolia (`0x694AA1769357215DE4FAC081bf1f309aDC325306`, selector `0x50d25bcd`, 8 decimals) — both calls work without API keys.

## Deploy

```bash
newton-cli policy deploy -p ./redstone
```

## Deployments

See [`deployments.json`](../deployments.json) at the repo root for deployed contract addresses (`packs.redstone.<chain_id>.policy` / `policyData`).

## Notes

- RedStone HTTP API: https://api.docs.redstone.finance/http-api/prices. The `provider` parameter must match a publishing cluster — `"redstone"` is the canonical demo cluster used here. Production integrations should pin a paid cluster.
- The on-chain oracle read uses raw `eth_call` so the selector + decoding is the integrator's responsibility. The default config uses Chainlink's `latestAnswer()` (`0x50d25bcd`) which returns `int256` at 8 decimals on USD feeds.
