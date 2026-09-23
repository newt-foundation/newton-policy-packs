# Combining packs with policy sets

This is how you gate one action with several packs on a Newton AVS that includes
newton-prover-avs PR #767 ("1:1 rego:wasm", `unified/main`, live on stagef first).

## What changed

Before #767, you combined packs in a **composite**: one `NewtonPolicy` with
several PolicyData oracles and a hand-written Rego module that read every
oracle's output. That no longer works:

- A policy client now holds an **ordered set of up to 8 policies**, configured
  with `setPolicies(PolicySpec[])`. `setPolicy` and `setPolicyAddress` are gone.
- Each policy in the set may reference **at most one** PolicyData. Adding a
  policy with two or more PolicyData reverts with `MultiOracleNotComposable`,
  so an existing composite can't be attached to a client.
- Params and `expireAfter` live on the client's `PolicySpec`, one per policy,
  not on the policy.
- The AVS evaluates every policy in the set and allows the task only if
  **every** policy allows (fail-closed AND).
- `wasm_args` is now an array aligned with the set: entry `i` is passed to
  policy `i`'s oracle (`0x` for a pure-Rego policy).

## What this means for packs

Nothing about a pack's oracle changes. Each pack is already one reference
`policy.rego` plus one PolicyData, and its Rego reads only its own oracle
output (`data.wasm.<pack-id>`) and flat params (`data.params`). So:

1. **Deploy each pack's reference Rego unmodified** as your own `NewtonPolicy`,
   bound to that pack's PolicyData from [`deployments.json`](../deployments.json).
   You no longer write composite Rego or a combined params schema.
2. **List those policies in your client's set** with your own params per pack.

Packs still don't ship a canonical `NewtonPolicy`. The curator deploys one from
the reference Rego, as before.

## Walkthrough (Sepolia, stagef)

Use a `newton-cli` built from newton-prover-avs `unified/main` (0.6.0 or later)
and set `DEPLOYMENT_ENV=stagef`. The CLI's factory lookup defaults to stagef,
but its gateway lookup defaults to prod.

```bash
export DEPLOYMENT_ENV=stagef CHAIN_ID=11155111 PRIVATE_KEY=... RPC_URL=...
GW=https://gateway.stagef.testnet.newton.xyz

# 1. Upload the pack's reference Rego + params schema to the env's object store.
#    Each gateway has its own store, so upload per env.
newton-cli policy-files upload-cids -d vaultsfyi/dist --entrypoint vault_risk_rating.allow \
  --secrets-schema-file vaultsfyi/secrets_schema.json \
  --gateway-url $GW --api-key $NEWTON_API_KEY -o /tmp/vaultsfyi_cids.json

# 2. Deploy a policy from it, bound to the pack's PolicyData for this (chain, env).
newton-cli policy deploy --policy-cids /tmp/vaultsfyi_cids.json \
  --policy-file vaultsfyi/dist/policy.rego --skip-cids --skip-data \
  --policy-data-address <deployments.json: packs.vaultsfyi.11155111.stagef.policyData>

# 3. Repeat 1-2 for each pack, then set the client's policy set.
cat > policies.json <<'JSON'
[
  { "policy": "0x<vaultsfyi policy>", "params": { "apy_z_max": 4, "...": "..." }, "expire_after": 50000 },
  { "policy": "0x<webacy policy>",    "params": { "deny_on_collapsed": true, "...": "..." }, "expire_after": 50000 }
]
JSON
newton-cli policy-client set-policies --client 0x<client> --policies policies.json

# 4. Upload each pack's secrets for (client, PolicyData).
newton-cli secrets upload --policy-client 0x<client> --policy-data-address <pack PolicyData> \
  --secrets-file secrets.json --api-key $NEWTON_API_KEY
```

`params` must validate against the pack's `params_schema.json`, which is the
schema uploaded in step 1.

When you submit tasks, build one `wasm_args` entry per policy, in set order,
with each pack's own `prepareQuery`. With `@newton-xyz/sdk` 1.2.0 or later:

```ts
const [vf, web] = await Promise.all([
  vaultsfyi.prepareQuery!({ publicClient, target: vault }, { network: "mainnet", vaultAddress: vault }),
  webacy.prepareQuery!({ publicClient, target: vault }, { address: usdc, chain: "eth" }),
]);
const { result } = await walletClient.evaluateIntentDirect({
  policyClient,
  intent,
  wasmArgs: [vf.wasmArgs, web.wasmArgs].map((a) => stringToHex(JSON.stringify(a))),
});
result.allowed; // AND of every policy
result.taskResponse.policyTaskData; // one entry per policy, in set order
```

The pack WASMs accept either their flat args or `{ <pack-id>: args }`, so each
entry can be the pack's own args object.

## Reference implementation

newton-vault-demo does exactly this with the vaults.fyi and Webacy packs:
`src/lib/policy-set.ts` builds the per-policy `wasm_args`, and
`scripts/deploy-policy-set.sh` does the deploy.

## Gotchas

- **Object stores are per gateway.** A PolicyData whose `wasmCid` isn't in the
  target gateway's store can't be evaluated there. DAG-PB CIDs (`bafybei…`)
  can't be re-uploaded under the same CID, so re-upload the WASM (which gives a
  raw `bafkrei…` CID) and deploy a new PolicyData. The vaultsfyi Sepolia stagef
  cell was redeployed this way on 2026-09-23.
- **Deploy from the gitignored `dist/policy.wasm` only if you rebuilt it.** A
  stale local build that predates `wrapOutput` emits flat output. The pack's
  Rego reads `data.wasm.<pack-id>`, so every evaluation then denies.
- **`policy-client register`** now opens the Newton dashboard in a browser. The
  stagef dashboard is https://dashboard.stagef.newton.xyz.
