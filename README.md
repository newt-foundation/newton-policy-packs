# Newton Policy Packs

Example policies for the Newton Protocol. Each policy is a top-level directory that can be built, simulated, and deployed using `newton-cli`.

## Prerequisites

```bash
# Install newton-cli
curl -L cli.newton.xyz | sh && newtup

# Check all deps are installed
newton-cli doctor
```

If `doctor` reports missing packages:

```bash
npm install -g @bytecodealliance/jco @bytecodealliance/componentize-js @bytecodealliance/preview2-shim
```

## Quick Start

```bash
# 1. Clone and setup
git clone <repo-url> && cd newton-policy-packs
cp .env.stagef .env    # Edit .env with your private key

# 2. Build the example policy
newton-cli policy build -p ./vaultsfyi

# 3. Simulate locally (auto-resolves configs/ from the policy dir)
newton-cli policy simulate -p ./vaultsfyi

# 4. Deploy (stagef testnet)
newton-cli policy deploy -p ./vaultsfyi
```

## Creating a New Policy

```bash
newton-cli policy scaffold my_policy
newton-cli policy build -p ./my_policy
newton-cli policy simulate -p ./my_policy
newton-cli policy deploy -p ./my_policy
```

## Environment Setup

Copy a starter env file and add your private key:

```bash
cp .env.stagef .env   # Sepolia testnet
# OR
cp .env.prod .env     # Mainnet
```

| Variable | Description |
|----------|-------------|
| `CHAIN_ID` | Target chain (`11155111` for Sepolia, `1` for mainnet) |
| `DEPLOYMENT_ENV` | `stagef` or `prod` |
| `RPC_URL` | Ethereum RPC endpoint |
| `PRIVATE_KEY` | Deployer wallet private key (0x-prefixed) |
| `PINATA_JWT` | (Optional) Pinata IPFS token |
| `PINATA_GATEWAY` | (Optional) Pinata gateway URL |

## Project Structure

```
newton-policy-packs/
├── vaultsfyi/             # Vault risk-rating gate (vaults.fyi)
├── redstone/              # Oracle-divergence gate
├── webacy/                # Depositor-reputation gate
├── chainalysis/           # Sanctions / address-screening gate
├── blockaid/              # Transaction-time exploit gate
├── guardrail/             # On-chain monitoring gate
├── persona/               # KYC / identity gate
├── sumsub/                # KYC / applicant gate (HMAC-signed)
├── balancer/              # Composite Balancer pool-risk gate
├── .env.stagef            # Starter env for testnet
├── .env.prod              # Starter env for mainnet
└── package.json           # jco build deps
```

Each pack has the same shape:

```
<pack>/
├── policy.js                 # WASM oracle source
├── policy.rego               # Rego rules
├── policy_test.rego          # Rego unit tests
├── newton-provider.wit
├── params_schema.json
├── policy_metadata.json
├── policy_data_metadata.json
├── configs/                  # Simulation configs (gitignored)
│   ├── wasm_args.json
│   ├── params.json
│   └── intent.json
├── dist/                     # Build output
└── README.md
```

## Rego unit tests

Each pack ships a `policy_test.rego` file. Run it directly with `opa`:

```bash
opa test ./vaultsfyi/policy.rego ./vaultsfyi/policy_test.rego -v
```

## Config Convention

Each policy has a `configs/` subdirectory (gitignored) with:
- `wasm_args.json` — Input to the WASM oracle (may contain API keys for local testing)
- `params.json` — Policy parameters evaluated by Rego
- `intent.json` — Transaction intent being evaluated

When you run `newton-cli policy simulate -p ./my_policy`, the CLI auto-resolves these files from `configs/` inside the policy directory. You can override with explicit flags (`--wasm-args`, `--policy-params-data`, `--intent-json`).

## Included Policies

Each pack is a single-gate primitive. They compose — operators run multiple gates per deposit by configuring more than one PolicyClient.

### vaultsfyi

Vault risk-rating gate using [vaults.fyi](https://vaults.fyi) — APY anomalies, TVL drawdowns, risk-score floor, allocation-change detection. See [vaultsfyi/README.md](./vaultsfyi/README.md).

### redstone

Oracle-divergence gate. Compares [RedStone](https://redstone.finance) median price to the on-chain oracle a vault uses; denies when divergence exceeds a hard cap or the RedStone feed is stale. Optional sustained-drift branch. See [redstone/README.md](./redstone/README.md).

### webacy

Depositor-reputation gate using [Webacy](https://webacy.com) — DD-score buckets (low/medium/high/sanctioned), exploit-exposure flags, tiered deposit caps for medium-risk wallets. See [webacy/README.md](./webacy/README.md).

### chainalysis

Sanctions / address-screening gate using [Chainalysis](https://www.chainalysis.com) Sanctions Screening (free, OFAC) and Address Screening v2 (paid, full categorization). See [chainalysis/README.md](./chainalysis/README.md).

### blockaid

Transaction-time exploit gate using [Blockaid](https://www.blockaid.io) — classifies the proposed deposit as Malicious/Warning/Benign, simulates the state-diff, denies on missing share receipt or value skim. See [blockaid/README.md](./blockaid/README.md).

### guardrail

On-chain monitoring gate using [Guardrail](https://guardrail.so) — denies on active high/critical alerts or when the protocol's health score falls below floor. See [guardrail/README.md](./guardrail/README.md).

### persona

KYC/identity gate using [Persona](https://withpersona.com). Looks up the depositor's Inquiry by `reference-id = wallet_address`, denies on unapproved status, expired KYC, country/age failures, or watchlist hits. See [persona/README.md](./persona/README.md).

### sumsub

KYC/applicant gate using [SumSub](https://sumsub.com). Same shape as the Persona gate but built around SumSub's HMAC-signed Applicant API. See [sumsub/README.md](./sumsub/README.md).

### balancer

Composite Balancer pool-risk gate (public API, no key). Token-weight drift, non-allowlisted tokens in pool, optional underlying-yield-source check, TVL floor + 24h/7d drawdowns. See [balancer/README.md](./balancer/README.md).

## Reference

- [Newton Developer Docs](https://docs.newton.xyz/developers/overview/core-concepts)
- [Policy Lifecycle Guide](https://github.com/newt-foundation/newton-prover-avs/blob/main/bin/newton-cli/docs/policy-lifecycle.md)
