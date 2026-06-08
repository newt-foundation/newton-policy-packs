# scripts/

TypeScript debug harness for Newton policy packs. Mirrors the deploy/run flow
in `../newton-dashboard` so we can repro issues (especially `execute`) outside
of the Next.js + Magic stack, then port fixes back.

First-pass scope: `vaultsfyi` only. See `TODO(multi-policy)` markers for the
slots where a second pack would slot in.

## Setup

```bash
cd scripts && pnpm install
which jco || npm i -g @bytecodealliance/jco           # required for deploy-policy
which newton-cli || curl -fsSL ...                    # required for deploy-policy-data
cp ../config.example.json ../config.json              # then edit ../config.json
```

`../config.json` is gitignored. Fill in:

- `chainId` (`11155111` for Sepolia)
- `rpcUrl` — Alchemy / Infura / etc.
- `deployerPrivateKey` — funded Sepolia key. **Same key must own every PolicyClient you'll touch with this script** AND **be the wallet linked to the Newton dashboard account that minted `newton.apiKey`**.
- `newton.apiKey` — Newton dashboard secret API key. The wallet linked to that dashboard account must match the address derived from `deployerPrivateKey`.
- `newton.gatewayApiUrl` — must end in `/rpc`. Use `https://gateway.stagef.testnet.newton.xyz/rpc` to match the dashboard's stagef env, or `https://gateway.testnet.newton.xyz/rpc` for prod testnet.
- `pinata.jwt` — Pinata API JWT (lift it from the dashboard's `.env.local`)
- `packs.vaultsfyi.{wasmArgs,params,secrets}` — runtime inputs

`deployments` starts empty. Every script writes back into it after each
successful step (atomic write). After a full run-through it'll contain all
the on-chain addresses you deployed.

## Edit `vaultsfyi/configs/intent.json`

The mixin enforces `intent.from == msg.sender`. `msg.sender` for this script
is whoever signs the executing tx — for us that's `deployerPrivateKey`. So:

- Set `from` to the deployer address.
- Set `value` to `"0"` for testing (the default `1000000000000000000` is 1 ETH and gets forwarded through the wallet to the target).

---

## Commands

| Command                                          | Mirrors dashboard hook                | What it does                                                                        |
| ------------------------------------------------ | ------------------------------------- | ----------------------------------------------------------------------------------- |
| `pnpm tsx cmd/deploy-policy-data.ts <pack>`      | (none)                                | Deploys a fresh PolicyData. Required ONLY when WASM bytes change. Shells out to `newton-cli` because no SDK exposes this. |
| `pnpm tsx cmd/deploy-policy.ts <pack>`           | `useDeployPolicy`                     | jco -> Pinata -> NewtonPolicyFactory.deployPolicy. Flag `--reuse-policy-data` skips jco/Pinata. |
| `pnpm tsx cmd/deploy-client.ts <name> --pack <pack>` | `useDeployHelloWorldPolicyClient`  | Bytecode deploy of HelloWorldPolicyClient(taskManager, owner)                       |
| `pnpm tsx cmd/bind.ts <name>`                    | `useInitializePolicy` + `useSetPolicy`| `setPolicyAddress` + `setPolicy({policyParams, expireAfter:31536000})`. Works for both first bind and rebind. |
| `pnpm tsx cmd/upload-secrets.ts <name>`          | `useAddPolicyClientSecret`            | `storeEncryptedSecrets(...)` via SDK. Re-run after `deploy-policy-data` since secrets are scoped to the new PolicyData. |
| `pnpm tsx cmd/simulate.ts <name> [--mode full\|policy-data]` | `useSimulatePolicy`/`useSimulatePolicyData` | Direct gateway POST (SDK currently drops `chain_id`; see `bugs.md`). |
| `pnpm tsx cmd/run.ts <name>`                     | `useExecuteIntent`                    | Sign intent (EIP712) -> direct gateway createTask -> sendTransaction. **The bug-repro target.** |

## Common workflows

### Truly from scratch (Sepolia, vaultsfyi)

This is the path when `deployments` is empty in `config.json`.

```bash
cd scripts
pnpm tsx cmd/deploy-policy-data.ts vaultsfyi          # fresh PolicyData
pnpm tsx cmd/deploy-policy.ts vaultsfyi               # fresh Policy wrapping it
pnpm tsx cmd/deploy-client.ts vaultsfyi-only --pack vaultsfyi  # fresh PolicyClient
pnpm tsx cmd/bind.ts vaultsfyi-only                   # bind policy to client
pnpm tsx cmd/upload-secrets.ts vaultsfyi-only         # upload encrypted secrets
pnpm tsx cmd/simulate.ts vaultsfyi-only --mode full   # pre-flight (no gas)
pnpm tsx cmd/run.ts vaultsfyi-only                    # evaluate + execute on-chain
```

### When you change `policy.rego` only

The Rego CID changes → factory will accept a new Policy. PolicyData
unchanged. Reuse the existing client.

```bash
pnpm tsx cmd/deploy-policy.ts vaultsfyi      # new Policy (WASM unchanged → can pass --reuse-policy-data to skip jco+pin)
pnpm tsx cmd/bind.ts vaultsfyi-only          # rebinds existing client to new Policy
pnpm tsx cmd/run.ts vaultsfyi-only
```

### When you change `policy.js` (WASM)

PolicyData is **immutable** w.r.t. `wasmCid` — once deployed, it's bonded to
that one WASM. Any WASM change requires a new PolicyData, then a new Policy
wrapping it, then a re-bind, then re-uploading secrets (they're scoped to
`(policyClient, policyDataAddress)`).

```bash
pnpm tsx cmd/deploy-policy-data.ts vaultsfyi          # new PolicyData (shells out to newton-cli)
pnpm tsx cmd/deploy-policy.ts vaultsfyi               # new Policy wrapping the new PolicyData
pnpm tsx cmd/bind.ts vaultsfyi-only                   # rebind client to new Policy
pnpm tsx cmd/upload-secrets.ts vaultsfyi-only         # re-upload — scoped to the new PolicyData
pnpm tsx cmd/run.ts vaultsfyi-only
```

Every command logs its full request and response to stdout. Diff that output
against the dashboard's network panel for the same call.

---

## What's NOT in this pass

- Multi-policy / composing two packs on one client (search `TODO(multi-policy)`)
- A custom `MultiPolicyWallet` Solidity contract
- A pure-TS `deployPolicyData` (currently shells out — see `bugs.md`)

## SDK note

We use `@newton-xyz/sdk` (the new package). The dashboard is on the legacy
`@magicnewton/newton-protocol-sdk@0.9.0`. Several methods in the new SDK have
real bugs that we've worked around by hitting the gateway HTTP directly — see
`scripts/bugs.md` for repros and proposed fixes. PRs against the SDK are
pending.
