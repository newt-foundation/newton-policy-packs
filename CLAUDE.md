# Newton Policy Packs

## What this repo is

A monorepo for developing, testing, and deploying Newton Policies. Each policy is a pair:
1. **WASM oracle** (`policy.js` → compiled to `policy.wasm`) — fetches external data at evaluation time
2. **Rego rules** (`policy.rego`) — decides `allow: true/false` based on the oracle output, policy params, and transaction intent

Policies live in `policies/{name}/`. The repo provides pnpm scripts to scaffold, build, simulate, and deploy them.

## Key commands

All commands use `pnpm run <script> -- <policy_name>`:

- `pnpm run check-deps` — verify tooling is installed
- `pnpm run new-policy -- <name>` — scaffold a new policy from templates
- `pnpm run build -- <name>` — compile JS → WASM, copy artifacts to policy-files/
- `pnpm run simulate:wasm -- <name> [--args <path>]` — test WASM oracle alone
- `pnpm run simulate -- <name> [--args <path>] [--intent <path>] [--params <path>]` — test full policy (WASM + Rego)
- `pnpm run deploy -- <name>` — generate CIDs, deploy WASM oracle, deploy policy

## Directory structure

```
policies/{name}/
├── policy.js                 # WASM oracle source (edit this)
├── policy.rego               # Rego rules (edit this)
├── newton-provider.wit       # WIT interface (don't touch)
├── params_schema.json        # JSON schema for policy params
├── policy_data_metadata.json # Metadata for the WASM component
├── policy_metadata.json      # Metadata for the policy
├── policy-files/             # Build output (generated, .wasm is gitignored)
└── README.md

configs/                      # User simulation configs (gitignored contents)
templates/                    # Scaffold templates used by new-policy
scripts/                      # Shell scripts backing pnpm commands
```

## How the pieces connect

1. `policy.js` exports a `run(wasm_args)` function that returns JSON. This JSON becomes `data.data.*` in Rego.
2. `policy.rego` evaluates `allow` based on:
   - `data.data.*` — output from the WASM oracle
   - `data.params.*` — policy parameters set by the wallet owner on-chain
   - `input.*` — the transaction intent (from, to, value, function name, args, chain_id)
3. The WASM is built using `jco componentize` with the `newton-provider.wit` interface.
4. `newton-cli` handles simulation and deployment. It needs `CHAIN_ID` set in the environment.

## Environment

- `.env` (gitignored) holds infra secrets: `CHAIN_ID`, `PINATA_JWT`, `PINATA_GATEWAY`, `PRIVATE_KEY`, `RPC_URL`
- `.env.example` documents the required vars
- `configs/` is gitignored — users put simulation JSON files here and pass them via `--args`, `--intent`, `--params` flags

## Conventions

- Policy names use snake_case (hyphens get converted to underscores for the Rego package name)
- The Rego entrypoint is always `{package_name}.allow` — auto-detected from the `package` declaration in the .rego file
- Build artifacts (`policy.wasm`, `policy_cids.json`, `.policy_data_address`) are gitignored
- Source files in `policies/` are tracked in git
- The `newton-provider.wit` is identical across all policies — it's copied verbatim from templates

## Reference

- `NEWTON_POLICY_GUIDE.md` — full walkthrough of the policy creation lifecycle, Rego syntax reference, smart contract deployment
- Newton Task Manager on Sepolia: `0xecb741F4875770f9A5F060cb30F6c9eb5966eD13`

### Newton Protocol docs

Fetch these URLs for deeper context when needed:

- https://docs.newton.xyz/developers/overview/core-concepts — protocol overview, lifecycle, key components
- https://docs.newton.xyz/developers/guides/writing-policies — Rego policy authoring guide
- https://docs.newton.xyz/developers/guides/writing-data-oracles — WASM oracle development
- https://docs.newton.xyz/developers/guides/deploying-with-cli — CLI deployment reference
- https://docs.newton.xyz/developers/guides/smart-contract-integration — PolicyClient contract integration
- https://docs.newton.xyz/developers/guides/frontend-sdk-integration — Frontend SDK usage
- https://docs.newton.xyz/developers/advanced/rego-syntax-guide — Rego syntax deep dive
- https://docs.newton.xyz/developers/advanced/policy-client-guide — Advanced PolicyClient patterns
- https://docs.newton.xyz/developers/reference/sdk-reference — SDK API reference
- https://docs.newton.xyz/developers/reference/rpc-api — JSON-RPC API
- https://docs.newton.xyz/developers/reference/contract-addresses — Deployed contract addresses
