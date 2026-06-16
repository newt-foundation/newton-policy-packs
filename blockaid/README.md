# blockaid

## Overview

Gates vault deposits at the **transaction-submission layer**. Even when a target vault has been reviewed at integration time, the *specific transaction* about to be sent can still be malicious:

- **Frontend / router compromise** — the contract address the user thinks they're depositing into has been swapped at the wallet/router/aggregator layer (LI.FI exploit, Curve frontend incidents, Ledger Connect Kit).
- **Compromised approval / permit** — the deposit transaction includes an unbounded `approve()` or `permit()` to a hostile contract.
- **Recently-changed bytecode** — a vault contract that was safe at integration time has had its proxy implementation rotated.

These are transaction-level failures that vault-metadata gates won't catch. Blockaid's EVM transaction-scanning API simulates the transaction, classifies it against ML-trained threat models, and returns a structured risk verdict plus a simulated state-diff — the powerful piece, since it catches "the contract claims to be a vault but isn't actually minting shares to you."

Use cases beyond vault deposits:
- Any wallet that lets users sign DeFi transactions.
- Custodians (Fireblocks, Anchorage, BitGo) running automated DeFi flows.
- Aggregators (1inch, CoW, KyberSwap) where a rogue route would silently drain.
- Multisigs (Safe) where a malicious tx is queued and signers don't notice the calldata.

## How it works

### Data Oracle (policy.js)

POST to `https://api.blockaid.io/v0/evm/transaction/scan` with `x-api-key`, options `["validation","simulation"]`. Emits:

| Field | Description |
|-------|-------------|
| `classification` | `Malicious` / `Warning` / `Benign` / `Unknown` |
| `features` | Array of feature ids returned by validation (e.g. `unbounded_approval`, `honeypot`) |
| `expected_inbound_value_usd` | Simulated inbound USD value for the depositor |
| `expected_outbound_value_usd` | Simulated outbound USD value for the depositor |
| `outbound_inbound_ratio` | `outbound / inbound` if `inbound > 0`, else `null` |
| `received_shares` | True if the depositor's `account_assets_diffs` includes any inbound asset with positive USD value |
| `simulation_succeeded` | Whether Blockaid's simulator returned a Success status |
| `timestamp` | Snapshot timestamp (ms) |

### Policy Rules (policy.rego)

| Deny Reason | Condition | What it catches |
|-------------|-----------|-----------------|
| `blockaid_malicious` | `classification == "Malicious"` | Hard ML/threat-intel verdict |
| `simulation_failed` | `not simulation_succeeded` | Couldn't simulate — refuse rather than guess |
| `blockaid_feature:<id>` | `classification == "Warning"` and a feature in `deny_features` | Specific warning features the operator refuses |
| `no_shares_received` | `require_received_shares` and `not received_shares` | Contract takes funds without minting receipts |
| `value_skim` | `outbound_inbound_ratio > max_outbound_inbound_ratio` | Outbound USD far exceeds inbound (skim attack) |

### Policy Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `deny_features` | array<string> | Blockaid feature ids to deny on a Warning classification |
| `max_outbound_inbound_ratio` | number | Cap on outbound/inbound USD ratio (e.g. 1.05) |
| `require_received_shares` | boolean | Whether the depositor must receive at least one inbound asset |

## Prerequisites

```bash
newton-cli doctor
```

Blockaid requires an API key. For sandbox runs, place it in `configs/wasm_args.json` as `BLOCKAID_API_KEY`. At deploy time the runtime injects via `getSecret("BLOCKAID_API_KEY")`.

## Build

```bash
newton-cli policy build -p ./blockaid
```

## Test (Rego unit tests)

```bash
opa test ./blockaid/policy.rego ./blockaid/policy_test.rego -v
```

## Simulate

```bash
newton-cli policy simulate -p ./blockaid
```

## Deploy

```bash
newton-cli policy deploy -p ./blockaid
```

## Deployments

See [`deployments.json`](../deployments.json) at the repo root for deployed contract addresses (`packs.blockaid.<chain_id>.<env>.policyData` — the reusable oracle; you deploy your own policy referencing it).

## Notes

- Endpoint: `POST https://api.blockaid.io/v0/evm/transaction/scan`. The path matches the Node SDK's `client.evm.transaction.scan` (https://github.com/blockaid-official/blockaid-client-node/blob/main/api.md). Reconfirm against `docs.blockaid.io` before mainnet.
- Response shape (`validation.result_type`, `validation.features[].feature_id`, `simulation.account_summary.account_assets_diffs`, etc.) is parsed defensively with `??` chains across the most likely field names.
