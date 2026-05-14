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
newton-cli policy build -p ./vault_risk_rating

# 3. Simulate locally (auto-resolves configs/ from the policy dir)
newton-cli policy simulate -p ./vault_risk_rating

# 4. Deploy (stagef testnet)
newton-cli policy deploy -p ./vault_risk_rating
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
├── vault_risk_rating/     # Example: vault deposit risk gate
│   ├── policy.js          # WASM oracle (fetches external data)
│   ├── policy.rego        # Rego rules (allow/deny logic)
│   ├── newton-provider.wit
│   ├── params_schema.json
│   ├── policy_metadata.json
│   ├── policy_data_metadata.json
│   ├── sandbox.mjs        # Node.js API testing
│   ├── configs/           # Simulation configs (gitignored)
│   │   ├── wasm_args.json
│   │   ├── params.json
│   │   └── intent.json
│   └── dist/      # Build output
├── .env.stagef            # Starter env for testnet
├── .env.prod              # Starter env for mainnet
└── package.json           # jco build deps
```

## Sandbox (Node.js API Testing)

Test API calls outside of WASM before compiling:

```bash
node ./vault_risk_rating/sandbox.mjs
```

## Config Convention

Each policy has a `configs/` subdirectory (gitignored) with:
- `wasm_args.json` — Input to the WASM oracle (may contain API keys for local testing)
- `params.json` — Policy parameters evaluated by Rego
- `intent.json` — Transaction intent being evaluated

When you run `newton-cli policy simulate -p ./my_policy`, the CLI auto-resolves these files from `configs/` inside the policy directory. You can override with explicit flags (`--wasm-args`, `--policy-params-data`, `--intent-json`).

## Included Policies

### vault_risk_rating

Gates vault deposits based on real-time risk signals from [vaults.fyi](https://vaults.fyi):

- APY anomaly detection (z-score)
- TVL drawdown monitoring (24h and 7d)
- Risk score floor enforcement
- Allocation change detection

See [vault_risk_rating/README.md](./vault_risk_rating/README.md) for details.

## Reference

- [Newton Developer Docs](https://docs.newton.xyz/developers/overview/core-concepts)
- [Policy Lifecycle Guide](https://github.com/newt-foundation/newton-prover-avs/blob/main/bin/newton-cli/docs/policy-lifecycle.md)
