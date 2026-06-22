# Newton Policy Packs

## What this repo is

A monorepo for developing, testing, and deploying Newton Policies. Each policy is a pair:
1. **WASM oracle** (`policy.js` → compiled to `policy.wasm`) — fetches external data at evaluation time
2. **Rego rules** (`policy.rego`) — decides `allow: true/false` based on the oracle output, policy params, and transaction intent

Each pack lives in its own top-level directory (`balancer/`, `blockaid/`, `vaultsfyi/`, etc.). All workflows go through `newton-cli` — there are no pnpm scripts.

## Key commands

All commands use `newton-cli` directly. There is no `-p ./<pack>` shortcut anymore — deploy is three separate steps. There is no `policy build` or `policy scaffold` subcommand.

- `newton-cli doctor` — verify tooling (jco, opa, etc.) is installed
- `newton-cli policy simulate ...` — test full policy (WASM + Rego); see flags below
- `opa test ./<name>/policy.rego ./<name>/policy_test.rego -v` — run Rego unit tests

### Build

`jco componentize` defaults pull in `wasi:http`, which the Newton runtime rejects (`component imports instance wasi:http/types@0.2.10, but a matching implementation was not found in the linker`). Always pass `--disable http --disable random --disable fetch-event --disable stdio`:

```bash
jco componentize <name>/policy.js \
  --wit <name>/newton-provider.wit \
  -n newton-provider \
  --disable http --disable random --disable fetch-event --disable stdio \
  -o <name>/dist/policy.wasm
```

Verify the build is clean: `jco print <name>/dist/policy.wasm | grep wasi:http` should print only the unused `(export "wasi:http/incoming-handler@0.2.10#handle" ...)` line — never an `(import "wasi:http/...")`.

### Deploy (three steps)

The CLI does **not** auto-load `[signer]`, `eth_rpc_url`, or `[pinata]` from `~/.newton/newton-cli.toml` even though they live there. Export them as env vars first, or every step will fail with `private_key is required` / `rpc_url is required`, and IPFS uploads will silently fall back to the Newton proxy (which is rate-limited and won't pin to your Pinata account):

```bash
# Pull values out of ~/.newton/newton-cli.toml
export PRIVATE_KEY="0x..."
export RPC_URL="https://eth-sepolia.g.alchemy.com/v2/..."
export CHAIN_ID=11155111
export PINATA_JWT="eyJ..."
export PINATA_GATEWAY="https://orange-useful-booby-460.mypinata.cloud"
```

Then:

```bash
# 1. Upload all dist files to IPFS, write dist/policy_cids.json
newton-cli policy-files generate-cids \
  -d ./<name>/dist \
  --entrypoint <package_name>.allow \
  --secrets-schema-file ./<name>/secrets_schema.json \
  -o ./<name>/dist/policy_cids.json

# 2. Deploy the PolicyData contract (the on-chain pointer to the WASM)
newton-cli policy-data deploy \
  --policy-cids ./<name>/dist/policy_cids.json
# → "Policy data deployed successfully at address: 0x..."

# 3. Deploy the Policy contract, binding it to the PolicyData address
newton-cli policy deploy \
  --policy-cids ./<name>/dist/policy_cids.json \
  --policy-data-address 0x<from-step-2> \
  --policy-file ./<name>/policy.rego
# → "Policy deployed successfully at address: 0x..."
```

Capture both addresses in `<name>/deployment.log` (e.g. `2>&1 | tee -a <name>/deployment.log`).

### Simulate

```bash
newton-cli policy simulate \
  --wasm-args ./<name>/configs/wasm_args.json \
  --intent-json ./<name>/configs/intent.json \
  --policy-params-data ./<name>/configs/params.json \
  --policy-file ./<name>/policy.rego \
  --wasm-file ./<name>/dist/policy.wasm
```

### Verifying a deployed PolicyData

If `newt_simulatePolicy` returns `failed to execute PolicyData WASM at 0x...: component imports instance wasi:http/types@0.2.10`, the deployed WASM was built without the `--disable` flags above. Fix: rebuild + redeploy (steps 1–3). The error always names the failing PolicyData address — match it against the `policy_data_address` in your request to confirm you're hitting the new one and not an old override.

### IPFS pinning

`generate-cids` uploads to whichever backend `PINATA_JWT` is set for. Without `PINATA_JWT`, it falls back to "Newton IPFS proxy" — content is reachable via `https://ipfs.newt.foundation/ipfs/<cid>` but **not** pinned to your Pinata account, so your Pinata gateway will 403 it. CIDs are content-addressed, so re-pinning the same file to Pinata after the fact gives the identical CID — no redeploy needed:

```bash
curl -X POST "https://api.pinata.cloud/pinning/pinFileToIPFS" \
  -H "Authorization: Bearer $PINATA_JWT" \
  -F "file=@./<name>/<file>" \
  -F 'pinataOptions={"cidVersion":1}'
```

## Directory structure

```
<name>/
├── policy.js                 # WASM oracle source (edit this)
├── policy.rego               # Rego rules (edit this)
├── policy_test.rego          # Rego unit tests
├── newton-provider.wit       # WIT interface (don't touch)
├── params_schema.json        # JSON schema for policy params
├── wasm_args_schema.json     # JSON schema for WASM oracle inputs
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
4. `newton-cli` handles simulation and deployment. Config values (`CHAIN_ID`, `PRIVATE_KEY`, `RPC_URL`, `PINATA_JWT`, `PINATA_GATEWAY`) **must** be exported as env vars — the current CLI does not auto-load them from `~/.newton/newton-cli.toml` despite reading the file at startup.

## Environment

- `~/.newton/newton-cli.toml` — primary config, holds chain id, signer key, RPC, Pinata creds
- `.env.prod` — starter env template; copy to `.env` if you want env-var-based overrides
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
