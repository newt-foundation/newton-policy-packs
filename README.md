# Newton Policy Packs

Example policies for the Newton Protocol. Each policy is a top-level directory that can be built, simulated, and deployed using `newton-cli`.

This repo also publishes per-pack TypeScript bindings under [`packages/`](./packages/) as `@newton-xyz/policy-pack-<name>` for use with [`@newton-xyz/newton-shield-sdk`](https://github.com/newt-foundation/newton-shield/tree/main/sdk). Each pack ships independently — installing one pack does not pull in any other. See [`packages/README.md`](./packages/README.md) for layout and regen workflow.

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

# 2. Export config — newton-cli does NOT auto-load these from ~/.newton/newton-cli.toml.
#    Pull the values out of ~/.newton/newton-cli.toml manually:
export PRIVATE_KEY="0x..."
export RPC_URL="https://eth-sepolia.g.alchemy.com/v2/..."
export CHAIN_ID=11155111
export PINATA_JWT="eyJ..."
export PINATA_GATEWAY="https://orange-useful-booby-460.mypinata.cloud"

# 3. Build — pass --disable flags or the WASM will import wasi:http/types
#    (rejected at runtime). Each pack ships a pre-built dist/policy.wasm so this
#    step is only needed when you change policy.js.
jco componentize ./vaultsfyi/policy.js \
  --wit ./vaultsfyi/newton-provider.wit \
  -n newton-provider \
  --disable http --disable random --disable fetch-event --disable stdio \
  -o ./vaultsfyi/dist/policy.wasm

# 4. Simulate locally
newton-cli policy simulate \
  --wasm-args ./vaultsfyi/configs/wasm_args.json \
  --intent-json ./vaultsfyi/configs/intent.json \
  --policy-params-data ./vaultsfyi/configs/params.json \
  --policy-file ./vaultsfyi/policy.rego \
  --wasm-file ./vaultsfyi/dist/policy.wasm

# 5. Deploy — three separate steps. Capture all output in deployment.log.
exec > >(tee -a vaultsfyi/deployment.log) 2>&1

# 5a. Upload to IPFS, write dist/policy_cids.json
newton-cli policy-files generate-cids \
  -d ./vaultsfyi/dist \
  --entrypoint vault_risk_rating.allow \
  --secrets-schema-file ./vaultsfyi/secrets_schema.json \
  -o ./vaultsfyi/dist/policy_cids.json

# 5b. Deploy PolicyData contract — note the address it prints
newton-cli policy-data deploy \
  --policy-cids ./vaultsfyi/dist/policy_cids.json

# 5c. Deploy Policy contract bound to the PolicyData address
newton-cli policy deploy \
  --policy-cids ./vaultsfyi/dist/policy_cids.json \
  --policy-data-address 0x<from-step-5b> \
  --policy-file ./vaultsfyi/policy.rego
```

### Common pitfalls

- **`component imports instance wasi:http/types@0.2.10`** at simulate/eval time → WASM was built without `--disable http --disable random --disable fetch-event --disable stdio`. Rebuild and redeploy. The error always names the failing PolicyData address — verify it matches your latest deployment.
- **`private_key is required` / `rpc_url is required`** → the CLI is not reading `~/.newton/newton-cli.toml`'s `[signer]` / `eth_rpc_url`. Export `PRIVATE_KEY`, `RPC_URL`, `CHAIN_ID` as env vars.
- **Pinata gateway returns 403 for your CID** → `generate-cids` ran without `PINATA_JWT` set and uploaded via the Newton IPFS proxy (not pinned to your Pinata account). Re-pin the file directly with `curl -X POST https://api.pinata.cloud/pinning/pinFileToIPFS -H "Authorization: Bearer $PINATA_JWT" -F "file=@./<path>" -F 'pinataOptions={"cidVersion":1}'` — same CID, no redeploy needed.

## After Deploying

The above only registers the Policy + PolicyData contracts. To wire them into a vault you also need to register a PolicyClient, bind the policy, set params, and (for packs that read API keys) upload encrypted secrets. See [OPERATING.md](./OPERATING.md).

## Deployed addresses

The canonical **PolicyData** (oracle) address + `wasmCid` for every pack on every chain lives in [`deployments.json`](./deployments.json). A pack ships a reusable oracle, not a blessed `NewtonPolicy` — there is no per-pack `policy` address. Curators deploy their own `NewtonPolicy` (single-pack or composite) referencing these `policyData` addresses; see [`docs/writing-composite-policies.md`](./docs/writing-composite-policies.md). Update `deployments.json` as part of every oracle redeploy — the dashboard, OPERATING.md, and per-pack READMEs all read from this file.

## Creating a New Policy

There's no scaffold subcommand. Copy an existing pack and rename the Rego package:

```bash
cp -r vaultsfyi my_policy
# edit my_policy/policy.js, policy.rego (rename `package vault_risk_rating` → `package my_policy`),
# params_schema.json, policy_metadata.json, policy_data_metadata.json, README.md,
# secrets_schema.json (or delete + drop --secrets-schema-file from the deploy command)
# then run the build + 5-step deploy from Quick Start.
```

## Environment Setup

`~/.newton/newton-cli.toml` (created by `newtup`) is the source of truth for chain id, signer, RPC, and Pinata creds — but the current CLI does **not** auto-load it. Export the values as env vars before deploying:

| Variable | Description |
|----------|-------------|
| `CHAIN_ID` | Target chain (`11155111` for Sepolia, `1` for mainnet) — **required** |
| `RPC_URL` | Ethereum RPC endpoint — **required** for any deploy step |
| `PRIVATE_KEY` | Deployer wallet private key (0x-prefixed) — **required** for any deploy step |
| `PINATA_JWT` | Pinata IPFS token — **strongly recommended**; without it, IPFS uploads fall back to the Newton proxy and won't be pinned to your Pinata account |
| `PINATA_GATEWAY` | Pinata gateway URL |

The `.env.prod` file is a starter template — it is **not** auto-sourced by the CLI. Either `source .env` yourself or export the values directly.

## Project Structure

```
newton-policy-packs/
├── vaultsfyi/             # Vault risk-rating gate (vaults.fyi)
├── redstone/              # Oracle-divergence gate
├── webacy/                # Pegged-token depeg-risk gate
├── chainalysis/           # Sanctions / address-screening gate
├── blockaid/              # Transaction-time exploit gate
├── guardrail/             # On-chain monitoring gate
├── persona/               # KYC / identity gate
├── sumsub/                # KYC / applicant gate (HMAC-signed)
├── balancer/              # Composite Balancer pool-risk gate
├── .env.prod              # Starter env template
└── package.json           # jco build deps
```

Each pack has the same shape:

```
<pack>/
├── policy.js                 # WASM oracle source
├── policy.rego               # Rego rules (reference impl — copy & adapt; not a blessed policy)
├── policy_test.rego          # Rego unit tests
├── newton-provider.wit
├── params_schema.json
├── wasm_args_schema.json
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

Pass these to `newton-cli policy simulate` via `--wasm-args`, `--policy-params-data`, and `--intent-json` (with `--policy-file` and `--wasm-file` — see the [Quick Start](#quick-start) for the full invocation).

## Included Policies

Each pack is a single-gate primitive. They compose — operators run multiple gates per deposit by configuring more than one PolicyClient.

### vaultsfyi

Vault risk-rating gate using [vaults.fyi](https://vaults.fyi) — APY anomalies, TVL drawdowns, risk-score floor, allocation-change detection. See [vaultsfyi/README.md](./vaultsfyi/README.md).

### redstone

Oracle-divergence gate. Compares [RedStone](https://redstone.finance) median price to the on-chain oracle a vault uses; denies when divergence exceeds a hard cap or the RedStone feed is stale. Optional sustained-drift branch. See [redstone/README.md](./redstone/README.md).

### webacy

Pegged-token depeg-risk gate using [Webacy](https://webacy.com)'s depeg-monitor API — denies on token collapse, recent depeg events in a lookback window, sustained days-below-peg streaks, or stale upstream data. See [webacy/README.md](./webacy/README.md).

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

## Contributing a new pack

Partners and external developers integrating a new data service should follow the step-by-step guide in [`docs/CONTRIBUTING.md`](./docs/CONTRIBUTING.md). It covers naming conventions, the file inventory a pack ships, OPA tests, the four-cell deploy flow, and the npm publish path.

## Reference

- [Newton Developer Docs](https://docs.newton.xyz/developers/overview/core-concepts)
- [Policy Lifecycle Guide](https://github.com/newt-foundation/newton-prover-avs/blob/main/bin/newton-cli/docs/policy-lifecycle.md)
- [`docs/CONTRIBUTING.md`](./docs/CONTRIBUTING.md) — adding a new policy pack
- [`docs/writing-composite-policies.md`](./docs/writing-composite-policies.md) — combining multiple oracles into one composite policy (developer how-to)
- [`examples/composite-vaultsfyi-chainalysis/`](./examples/composite-vaultsfyi-chainalysis/) — complete copy-paste composite example
- [`docs/composite-policies.md`](./docs/composite-policies.md) — composite architecture + the AVS multi-PolicyData mechanism
- [`OPERATING.md`](./OPERATING.md) — post-deploy lifecycle (PolicyClient + secrets)
