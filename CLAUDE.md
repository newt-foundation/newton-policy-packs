# Newton Policy Packs

## What this repo is

A monorepo for developing, testing, and deploying Newton Policies. Each policy is a pair:
1. **WASM oracle** (`policy.js` → compiled to `policy.wasm`) — fetches external data at evaluation time
2. **Rego rules** (`policy.rego`) — decides `allow: true/false` based on the oracle output, policy params, and transaction intent

Each pack lives in its own top-level directory (`balancer/`, `blockaid/`, `vaultsfyi/`, etc.). All workflows go through `newton-cli` — there are no pnpm scripts.

## Key commands

All commands use `newton-cli` directly. `--chain-id`, signer, RPC, and Pinata creds come from `~/.newton/newton-cli.toml` (set up by `newtup` during install).

- `newton-cli doctor` — verify tooling (jco, opa, etc.) is installed
- `newton-cli policy simulate -p ./<name>` — test full policy (WASM + Rego); auto-resolves `<name>/configs/`
- `newton-cli policy deploy -p ./<name>` — generate CIDs, pin to IPFS, deploy policy-data and policy contracts; writes `<name>/dist/policy_cids.json`
- `opa test ./<name>/policy.rego ./<name>/policy_test.rego -v` — run Rego unit tests

There is no `policy build` or `policy scaffold` subcommand. To rebuild `policy.wasm`, use `jco componentize` directly against the pack's `policy.js` + `newton-provider.wit`. To start a new pack, copy an existing one as a template.

## Directory structure

```
<name>/
├── policy.js                 # WASM oracle source (edit this)
├── policy.rego               # Rego rules (edit this)
├── policy_test.rego          # Rego unit tests
├── newton-provider.wit       # WIT interface (don't touch)
├── params_schema.json        # JSON schema for policy params
├── policy_data_metadata.json # Metadata for the WASM component
├── policy_metadata.json      # Metadata for the policy
├── configs/                  # Local simulation configs (gitignored)
├── dist/                     # Build output (.wasm + policy_cids.json gitignored)
├── deployment.log            # Captured stdout from `newton-cli policy deploy`
└── README.md
```

## How the pieces connect

1. `policy.js` exports a `run(wasm_args)` function that returns JSON. This JSON becomes `data.data.*` in Rego.
2. `policy.rego` evaluates `allow` based on:
   - `data.data.*` — output from the WASM oracle
   - `data.params.*` — policy parameters set by the wallet owner on-chain
   - `input.*` — the transaction intent (from, to, value, function name, args, chain_id)
3. The WASM is built using `jco componentize` with the `newton-provider.wit` interface.
4. `newton-cli` handles simulation and deployment. Config (chain id, signer, RPC, Pinata) is loaded from `~/.newton/newton-cli.toml`; env vars (`CHAIN_ID`, `PRIVATE_KEY`, `RPC_URL`, `PINATA_JWT`, `PINATA_GATEWAY`) override the toml when set.

## Environment

- `~/.newton/newton-cli.toml` — primary config, holds chain id, signer key, RPC, Pinata creds
- `.env.stagef` / `.env.prod` — starter env templates (Sepolia / mainnet); copy to `.env` if you want env-var-based overrides
- `<name>/configs/` (gitignored) — `wasm_args.json`, `params.json`, `intent.json` for local simulation; auto-resolved by `policy simulate -p`

## Conventions

- Policy names use snake_case (hyphens get converted to underscores for the Rego package name)
- The Rego entrypoint is always `{package_name}.allow` — auto-detected from the `package` declaration in the .rego file
- Build artifacts (`<name>/dist/policy.wasm`, `<name>/dist/policy_cids.json`) are gitignored; source files and `deployment.log` are tracked
- The `newton-provider.wit` is identical across all packs

## After deploying

`newton-cli policy deploy` only registers the policy on-chain. To wire it into a vault you also need to register a PolicyClient, bind the policy, set params, and (for packs that read API keys) upload encrypted secrets. See [OPERATING.md](./OPERATING.md).

## Reference

- [OPERATING.md](./OPERATING.md) — post-deploy lifecycle (policy-client + secrets)
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
