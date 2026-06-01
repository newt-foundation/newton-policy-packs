# Operating a Newton Policy

This doc covers the post-deploy lifecycle: registering a `PolicyClient`, binding it to the policy you just deployed, setting params, and uploading encrypted API keys for the packs that need them.

`newton-cli policy deploy` puts your policy on-chain — it does **not** wire it into a vault. The wiring happens here.

## Mental model

Three on-chain pieces:

| Piece | What it is | Who deploys it |
|---|---|---|
| **Policy** | The deployed policy contract that the prover network evaluates. Address comes from your `<pack>/deployment.log` (`Policy deployed successfully at address: 0x...`). | You, via `newton-cli policy deploy` |
| **PolicyClient** | Your contract that calls Newton at vault deposit time. One per gate per vault. | You, separately (Solidity) |
| **PolicyClientRegistry** | Newton-deployed registry, one per chain. Authority that gates which `PolicyClient` contracts can submit evaluation tasks. | Newton |

The flow at deposit time: vault → your `PolicyClient` → `PolicyClientRegistry` (gates) → prover network → `Policy` (Rego rules) → WASM oracle (your `policy.js`) → external API. The prover decrypts the secrets you uploaded and injects them into the WASM at evaluation time.

Registry addresses per chain are in [Newton's contract addresses doc](https://docs.newton.xyz/developers/reference/contract-addresses). Don't synthesize this — look it up.

## 1. Register your PolicyClient

You need a deployed `PolicyClient` contract first (Solidity, out of scope here — see [Newton's smart contract integration guide](https://docs.newton.xyz/developers/guides/smart-contract-integration)). Its owner registers it with the registry:

```bash
newton-cli policy-client register \
  --registry 0x<REGISTRY_ADDRESS> \
  --client   0x<YOUR_POLICY_CLIENT>
```

Verify:

```bash
newton-cli policy-client status --registry 0x<REGISTRY> --client 0x<YOUR_POLICY_CLIENT>
newton-cli policy-client list   --registry 0x<REGISTRY> --owner  0x<YOUR_OWNER_ADDRESS>
```

## 2. Bind the policy to your client

```bash
newton-cli policy-client set-policy \
  --client 0x<YOUR_POLICY_CLIENT> \
  --policy 0x<POLICY_ADDRESS_FROM_DEPLOYMENT_LOG>
```

Owner-only. The `<POLICY_ADDRESS_FROM_DEPLOYMENT_LOG>` is the line at the bottom of `<pack>/deployment.log` — for example, the deployed packs in this repo:

| Pack | Policy address (Sepolia) |
|---|---|
| balancer | `0x56cC09e66bFAE5223C5d2eCdE02dB06dEFFcf5fe` |
| blockaid | `0x14038DBEda03a2e6AeA02e9932D216892bb4Ed0d` |
| chainalysis | `0x6e5a7CDc568CF4480f3F5044A3E35658733CB281` |
| guardrail | `0xaC397a0868982844F35b34C11d859Bf15E87E0a0` |
| persona | `0x4684187DF9D0632a99Ac45e9b9088A062da2757a` |
| redstone | `0x9F1E0B435753Cb09713216D52C5992f69e7310BE` |
| sumsub | `0x9b619893A4751E48466d82Ec9F40c5d7AFBd988c` |
| vaultsfyi | `0xDcf9CBe8557c2DD93e60783D3706725Efe1Ba008` |
| webacy | `0xD2eFeAeB2B15448f73D0683Bbb347141adab3F30` |

## 3. Set policy params

Each pack's allowed params are documented in `<pack>/params_schema.json`. Pass a JSON file path via `--policy-params`, plus a freshness window via `--expire-after`:

```bash
newton-cli policy-client set-policy-params \
  --policy-client 0x<YOUR_POLICY_CLIENT> \
  --policy-params ./my-params.json \
  --expire-after  3600     # seconds; re-run before this elapses
```

Example `my-params.json` for the balancer pack (see `balancer/params_schema.json` for the full schema):

```json
{
  "tvl_floor_usd": 10000000,
  "max_token_weight_drift_bps": 500,
  "allowed_tokens": ["0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"]
}
```

Re-run `set-policy-params` to refresh before `--expire-after` elapses, or whenever you change the values.

## 4. Upload encrypted secrets (API keys)

Most packs read API keys at evaluation time via `getSecret(name)` inside `policy.js`. Secrets are HPKE-encrypted under a per-prover public key, then uploaded to the gateway and decrypted only inside the prover enclave at evaluation time.

You'll need a Newton gateway API key (`API_KEY` env var or `--api-key` flag — distinct from the per-pack provider keys you're uploading). Get it from the Newton dashboard.

### a. Fetch the HPKE public key (one-time per chain)

```bash
newton-cli secrets get-public-key --api-key $API_KEY
```

### b. Write a `secrets.json` with the names the pack reads

The key names must match what `policy.js` calls `secret("...")` on. Verify per-pack:

```bash
grep -n 'secret("' <pack>/policy.js
```

### c. Upload

```bash
newton-cli secrets upload \
  --secrets-file        ./secrets.json \
  --policy-client       0x<YOUR_POLICY_CLIENT> \
  --policy-data-address 0x<POLICY_DATA_ADDR_FROM_DEPLOYMENT_LOG> \
  --api-key             $API_KEY
```

The `<POLICY_DATA_ADDR_FROM_DEPLOYMENT_LOG>` is from the "Policy data deployed successfully at address: 0x..." line earlier in `<pack>/deployment.log` — it's distinct from the policy address.

### Per-pack secret keys

Verified by grepping each pack's `policy.js`:

| Pack | Required `secrets.json` keys |
|---|---|
| balancer | _(none — public Balancer GraphQL)_ |
| redstone | _(none — public RedStone cluster)_ |
| blockaid | `BLOCKAID_API_KEY` |
| chainalysis | `CHAINALYSIS_SANCTIONS_KEY`, `CHAINALYSIS_SCREENING_KEY` |
| guardrail | `GUARDRAIL_API_KEY` |
| persona | `PERSONA_API_KEY` |
| sumsub | `SUMSUB_APP_TOKEN`, `SUMSUB_SECRET_KEY` |
| vaultsfyi | `VAULTS_FYI_API_KEY` |
| webacy | `WEBACY_API_KEY` |

Example for sumsub:

```json
{
  "SUMSUB_APP_TOKEN": "sbx:...",
  "SUMSUB_SECRET_KEY": "..."
}
```

## 5. Lifecycle ops

```bash
# Pause a registered client (e.g., during an incident)
newton-cli policy-client deactivate --registry 0x<REGISTRY> --client 0x<CLIENT>

# Resume
newton-cli policy-client activate   --registry 0x<REGISTRY> --client 0x<CLIENT>

# Hand off ownership of the registry record
newton-cli policy-client transfer-ownership --registry 0x<REGISTRY> --client 0x<CLIENT> --new-owner 0x<NEW_OWNER>
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `not registered` at task submission | PolicyClient never registered, or was deactivated | `policy-client register` (or `activate`) |
| Tasks succeed but always deny on a policy you just bound | Policy address on the client doesn't match the deployed policy | `policy-client set-policy --client … --policy …` |
| Pack returns `no secret: <NAME>` at eval time | The key in `secrets.json` doesn't match what `policy.js` reads | `grep -n 'secret("' <pack>/policy.js` and rename |
| `params expired` | `--expire-after` window has elapsed | Re-run `set-policy-params` |
| `policy data mismatch` | The `policy_data` array on the policy doesn't include the policy-data contract you're uploading secrets against | Verify `<pack>/deployment.log` shows the correct `policyData: [0x...]` line; redeploy if drifted |

## For LLM agents helping operators

Before running any of the above on behalf of a user, confirm these inputs (don't synthesize):

1. **Chain** — stagef (Sepolia, `chain_id=11155111`) or prod (mainnet, `chain_id=1`). Should match `~/.newton/newton-cli.toml`.
2. **PolicyClient address** — the user's deployed `PolicyClient` contract (0x-prefixed). Distinct from the policy address.
3. **Policy address** — the bottom line of `<pack>/deployment.log`. Don't confuse with policy-data address.
4. **Registry address** — look up from [Newton contract-addresses docs](https://docs.newton.xyz/developers/reference/contract-addresses) per chain. Never invent.
5. **Signer** — owner of the `PolicyClient`. Verify the `[signer].address` in `~/.newton/newton-cli.toml` matches before running owner-only commands (`set-policy`, `set-policy-params`, `deactivate`, `transfer-ownership`).
6. **Newton gateway API key** — required for any `secrets` subcommand. Distinct from the provider keys (BLOCKAID/PERSONA/etc.) being uploaded.
7. **Per-pack secret names** — always re-verify with `grep -n 'secret("' <pack>/policy.js` before writing `secrets.json`. The table in this doc may drift behind code changes.
