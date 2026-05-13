# Newton Policy Packs

Development workspace for creating, testing, and deploying Newton Policies (WASM oracles + Rego rules).

## Setup

```bash
git clone <repo-url> && cd newton-policy-packs
pnpm install
cp .env.example .env
# Fill in .env with your values (see below)
```

Check that external dependencies are installed:

```bash
pnpm run check-deps
```

### Required tooling

| Tool | Purpose | Install |
|------|---------|---------|
| Node.js >= 18 | WASM componentization | `brew install node` |
| pnpm | Package manager | `npm install -g pnpm` |
| newton-cli | Simulate & deploy policies | `cargo install newton-cli@0.1.31` |

### Environment variables (`.env`)

| Variable | Description |
|----------|-------------|
| `CHAIN_ID` | Target chain (default: `11155111` for Sepolia) |
| `PINATA_JWT` | Pinata API token for IPFS uploads |
| `PINATA_GATEWAY` | Your Pinata gateway URL |
| `PRIVATE_KEY` | Deployer private key (prefixed with `0x`) |
| `RPC_URL` | RPC endpoint for the target chain |

## Usage

### Create a new policy

```bash
pnpm run new-policy -- my_policy
```

Creates `policies/my_policy/` with scaffolded source files ready to edit.

### Build

Compiles `policy.js` into a WASM component and copies artifacts to `policy-files/`:

```bash
pnpm run build -- my_policy
```

### Simulate

Test the WASM oracle in isolation:

```bash
pnpm run simulate:wasm -- my_policy
pnpm run simulate:wasm -- my_policy --args ./configs/my-wasm-args.json
```

Test the full policy (WASM + Rego evaluation):

```bash
pnpm run simulate -- my_policy
pnpm run simulate -- my_policy --args ./configs/wasm-args.json --intent ./configs/intent.json --params ./configs/params.json
```

All flags are optional. Without them, the simulation runs with empty/default inputs.

### Deploy

Full pipeline (generate CIDs, deploy WASM oracle, deploy policy):

```bash
pnpm run deploy -- my_policy
```

Or run steps individually:

```bash
pnpm run generate-cids -- my_policy
pnpm run deploy:data -- my_policy
pnpm run deploy:policy -- my_policy
```

## Project structure

```
newton-policy-packs/
├── policies/          # Your policies live here
│   └── {name}/
│       ├── policy.js              # WASM oracle source
│       ├── policy.rego            # Rego rules
│       ├── newton-provider.wit    # WIT interface
│       ├── params_schema.json     # Parameter schema
│       ├── policy_data_metadata.json
│       ├── policy_metadata.json
│       └── policy-files/          # Build output (gitignored .wasm)
├── configs/           # Your simulation configs (gitignored)
├── scripts/           # Shell scripts backing pnpm commands
├── templates/         # Scaffolding templates
└── NEWTON_POLICY_GUIDE.md   # Detailed reference guide
```

## Example: Vault Risk-Rating Gate (vaults.fyi)

This policy gates vault deposits based on real-time risk signals from [vaults.fyi](https://vaults.fyi): APY anomalies, TVL drawdowns, risk score floors, and allocation changes.

### Config files

Create `configs/vault_risk_rating/` with the following files:

**`wasm_args.json`** — Input to the WASM oracle (secrets are passed inline for local simulation):

```json
{
  "network": "mainnet",
  "vaultAddress": "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84",
  "lastKnownAllocationHash": null,
  "VAULTS_FYI_API_KEY": "your-api-key-here"
}
```

**`params.json`** — Risk envelope thresholds evaluated by Rego:

```json
{
  "apy_z_max": 4.0,
  "tvl_drawdown_24h_max_pct": 25,
  "tvl_drawdown_7d_max_pct": 50,
  "risk_score_floor": 60,
  "deny_on_allocation_change": true,
  "nrt_max_age_seconds": 300
}
```

**`intent.json`** — The transaction intent being evaluated:

```json
{
  "from": "0x0000000000000000000000000000000000000001",
  "to": "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84",
  "value": "1000000000000000000",
  "function_name": "deposit",
  "args": [],
  "chain_id": "11155111"
}
```

### Running the example

```bash
# Build the WASM oracle
pnpm run build -- vault_risk_rating

# Test the oracle in isolation (returns vault state JSON)
CHAIN_ID=11155111 pnpm run simulate:wasm -- vault_risk_rating \
  --args configs/vault_risk_rating/wasm_args.json

# Run full policy evaluation (WASM + Rego)
CHAIN_ID=11155111 pnpm run simulate -- vault_risk_rating \
  --args configs/vault_risk_rating/wasm_args.json \
  --params configs/vault_risk_rating/params.json \
  --intent configs/vault_risk_rating/intent.json
```

### Sandbox (test API calls outside WASM)

Each policy can include a `sandbox.mjs` for testing API calls with Node directly:

```bash
pnpm run sandbox -- vault_risk_rating
```

This hits the vaults.fyi API using the same args file and prints the raw responses, useful for debugging response shapes before compiling to WASM.

## Reference

See [NEWTON_POLICY_GUIDE.md](./NEWTON_POLICY_GUIDE.md) for the full walkthrough on writing WASM oracles, Rego policies, and deploying Newton Policy Wallets.
