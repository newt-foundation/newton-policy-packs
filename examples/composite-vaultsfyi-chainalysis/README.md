# Composite policy example — vaultsfyi + chainalysis

A worked, end-to-end example of composing two published policy packs into **one** Newton policy: a vault deposit must pass **both** vaultsfyi's risk envelope **and** chainalysis's sanctions screening.

This is the reference partners copy. It exercises the full composite-policy surface shipped across the four-phase rollout (`@newton-xyz/policy-pack-shared`). For the conceptual guide, see [`docs/writing-composite-policies.md`](../../docs/writing-composite-policies.md).

## What's here

| File | What it is |
|---|---|
| `policy.rego` | The composite Rego — deny rules over `data.wasm.vaultsfyi.*` + `data.wasm.chainalysis.*`, fail-closed `allow`. |
| `policy_test.rego` | OPA unit tests. `opa test` green (11 cases incl. fail-closed-on-error for each oracle). |
| `params_schema.json` | Composite params schema, keyed by short pack id. |
| `policy_metadata.json` | Pack-style metadata. |
| `src/example.ts` | The TypeScript curator path — `defineComposite` → `encodeCompositePolicyPack` → `prepareQuery` → `introspectComposite` / `getPolicyManifest`. Typechecks against the real workspace packages. |

## The mental model

The packs publish reusable **`policyData`** contracts (deployed WASM oracles). You don't redeploy those. You write your own Rego that reads several of them, and deploy **one** `NewtonPolicy` that references multiple `policyData` addresses:

```
Your NewtonPolicy (this policy.rego)
   ├─ references → vaultsfyi   policyData  (reused from deployments.json)
   └─ references → chainalysis policyData  (reused from deployments.json)
```

At eval time the AVS runs both WASMs, merges their outputs into one `data.wasm` blob keyed by short pack id, then evaluates your Rego.

## 1. The Rego

Each oracle's output lives under its short pack id (`data.wasm.vaultsfyi.*`, `data.wasm.chainalysis.*` — the Phase 0 namespacing). Params live under the same short id (`data.params.vaultsfyi.*` — the composite manifest convention). The deny rules are copied from each pack's standalone `policy.rego`; the only rewrite is the params side from flat `data.params` to namespaced `data.params.<short-id>`.

`allow` is **fail-closed**: it requires both oracles' fields to be well-formed AND zero denies, so an oracle error payload (`{"vaultsfyi": {"error": "..."}}`) can't fail open.

```bash
opa test policy.rego policy_test.rego -v
# PASS: 11/11
```

## 2. Deploy — one policy, two PolicyData

No new WASM build. Reuse the published `policyData` addresses from the repo-root [`deployments.json`](../../deployments.json). On Sepolia / stagef:

Addresses (Sepolia / stagef, from `deployments.json`):
- vaultsfyi PolicyData: `0x347c9151177bCcFd7ABE70196c4790a2dCae528b`
- chainalysis PolicyData: `0x223F563c3CfD087cB1857851629b4d8CE7738448`

```bash
newton-cli policy deploy \
  --policy-cids ./dist/policy_cids.json \
  --policy-data-address 0x347c9151177bCcFd7ABE70196c4790a2dCae528b \
  --policy-data-address 0x223F563c3CfD087cB1857851629b4d8CE7738448 \
  --policy-file ./policy.rego
# → "Policy deployed successfully at address: 0xYOUR_COMPOSITE..."
```

(No inline comments inside the command — a `\` line-continuation followed by a `#` comment is not a continuation in bash, so the address legend lives above the block.)

**Order is significant.** The on-chain `getPolicyData()` array preserves flag order, and `PolicyValidationLib.sol` enforces positional equality. Pass the flags in the same order you list `modules` to `defineComposite` — vaultsfyi first, then chainalysis.

## 3. Wire it up in TypeScript

See [`src/example.ts`](./src/example.ts) for the full flow. The shape:

```ts
import { defineComposite, encodeCompositePolicyPack } from "@newton-xyz/policy-pack-shared";
import { vaultsfyi } from "@newton-xyz/policy-pack-vaultsfyi";
import { chainalysis } from "@newton-xyz/policy-pack-chainalysis";

const composite = await defineComposite({
  modules: [vaultsfyi, chainalysis],   // same order as the deploy flags
  chainId: "11155111",
  env: "stagef",
  publicClient,
  policyAddress: "0xYOUR_COMPOSITE...",
});

const policyParams = encodeCompositePolicyPack(composite, {
  vaultsfyi:   { risk_score_floor: 80, /* ... */ },
  chainalysis: { deny_on_sanctioned: true, /* ... */ },
});

await shield.setPolicyAddress("0xYOUR_COMPOSITE...");
await shield.setPolicy(policyParams, expireAfter);
```

`defineComposite` reads `getPolicyData()` on-chain and throws if your module order doesn't match — a mis-ordered array never reaches `setPolicy`.

## 4. Per-call + verification

```ts
// Per intent — aggregated prepareQuery, per-module options keyed by short id
const { wasmArgs } = await composite.prepareQuery(
  { publicClient, vault },
  { chainalysis: { address: depositorAddress } },
);

// Depositors verify the composite on-chain
const report = await introspectComposite({ publicClient, shieldAddress });
//   checks each policyData address + wasmCid against the manifest
```

## Run the checks

```bash
# Rego
opa test policy.rego policy_test.rego

# TypeScript (from the repo root, after `pnpm install && pnpm -r build`)
pnpm -F @newton-xyz/example-composite-vaultsfyi-chainalysis typecheck
```
