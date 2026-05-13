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

## Reference

See [NEWTON_POLICY_GUIDE.md](./NEWTON_POLICY_GUIDE.md) for the full walkthrough on writing WASM oracles, Rego policies, and deploying Newton Policy Wallets.
