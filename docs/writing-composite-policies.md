# Writing a composite policy

A guide for developers who want to gate a vault action with **multiple** oracles at once — e.g. "deny unless the vault passes vaultsfyi's risk envelope AND the depositor passes chainalysis's sanctions screening." You write one Rego policy that reads several published oracles, deploy a single on-chain policy that references them, and wire it into your Shield with the `@newton-xyz/policy-pack-shared` SDK.

For the architecture and rollout history, see [`composite-policies.md`](./composite-policies.md). For a complete copy-paste example, see [`examples/composite-vaultsfyi-chainalysis/`](../examples/composite-vaultsfyi-chainalysis/). This doc is the step-by-step how-to.

## Mental model

Two on-chain contracts, deployed as a pair, are what each pack publishes:

| Contract | Holds | In `deployments.json` |
|---|---|---|
| `NewtonPolicyData` | The WASM oracle (the data source — fetches external state at eval time). Content-addressed by `wasmCid`. | `policyData` |
| `NewtonPolicy` | The Rego rules + a reference to one or more `NewtonPolicyData` addresses. | `policy` |

A **single-pack** policy is the degenerate case: one `NewtonPolicy` pointing at one `NewtonPolicyData`. A **composite** is the general case: your own `NewtonPolicy` (your Rego) pointing at **N** `NewtonPolicyData` addresses — reusing the oracles the packs already published. **You never rebuild a WASM.** You reuse `policyData` addresses; you author Rego and deploy one new `NewtonPolicy`.

```
Your composite NewtonPolicy (your Rego)
   ├─ references → vaultsfyi   policyData  0x347c9151…   (reused, published)
   ├─ references → chainalysis policyData  0x223F563c…   (reused, published)
   └─ references → redstone    policyData  0x…           (reused, published)
```

At evaluation time the AVS runs every referenced oracle WASM, **merges** their JSON outputs into one `data.wasm` blob — each oracle's output namespaced under its short pack id — then evaluates your Rego against the merged blob plus your params.

## When you want a composite vs a single pack

| Goal | Shape |
|---|---|
| Gate on exactly one pack | Single pack — bind the pack's published `policy` address directly. No composite. |
| Gate on N packs, ALL must pass | **Composite** — author Rego over N oracles. |
| Different gates for `reallocate` vs `submitCap` | Out of scope — same Rego runs on every action your Shield routes. v2 question. |
| "Only call oracle B if oracle A says X" | Out of scope — every referenced oracle runs every call. Composites are AND-composition, not conditional flow. |

## Step 1 — Pick your oracles

Read the repo-root [`deployments.json`](../deployments.json) for the `(policyData, wasmCid)` of each pack you want, on your target `(chainId, env)` cell. You'll reference the `policyData` addresses at deploy time. Example (Sepolia / stagef):

```
vaultsfyi   policyData  0x347c9151177bCcFd7ABE70196c4790a2dCae528b
chainalysis policyData  0x223F563c3CfD087cB1857851629b4d8CE7738448
```

For each oracle, also read its TypeScript binding (`packages/policy-pack-<name>/src/params.ts`, `wasm-args.ts`) to know what params it accepts and what fields its WASM emits.

## Step 2 — Write your Rego

Each oracle's WASM output is namespaced under its **short pack id** (`data.wasm.vaultsfyi.*`, `data.wasm.chainalysis.*` — the Phase 0 `wrapOutput` convention). Your params are namespaced the same way (`data.params.vaultsfyi.*` — the composite manifest convention).

Start from each pack's standalone `<pack>/policy.rego` as a template for the deny rules over that oracle. **The one rewrite you must make:** each standalone pack reads its params via flat `t := data.params`; in a composite, params are namespaced — rewrite to `data.params.<short-id>`. The WASM-output side (`data.wasm.<short-id>.*`) is identical in both.

```rego
package my_vault_gate

import future.keywords
default allow := false

vf := data.wasm.vaultsfyi
vfp := data.params.vaultsfyi
ca := data.wasm.chainalysis
cap := data.params.chainalysis

deny contains "vaultsfyi:risk_below_floor" if {
    vf.risk_score != null
    vf.risk_score < vfp.risk_score_floor
}

deny contains "chainalysis:sanctioned" if {
    cap.deny_on_sanctioned
    ca.sanctioned
}
```

### Fail closed

Structure `allow` so it requires every oracle's fields to be **well-formed** AND zero denies. This is what makes the composite fail closed: an oracle error payload (`{"vaultsfyi": {"error": "..."}}`) leaves the expected fields undefined, so the well-formedness probe fails and `allow` stays `false` — even though no deny rule fired against the missing data.

```rego
allow if {
    # no oracle reported an error
    not vf.error
    not ca.error
    # well-formedness probes — undefined on an error payload, so allow stays false
    is_number(vf.apy_z_score)
    is_boolean(ca.sanctioned)
    is_array(ca.risk_categories)
    # no deny across either namespace
    count(deny) == 0
}
```

The explicit `not vf.error` guards harden the invariant against a future oracle that emits an `error` field *alongside* well-formed data — the probes alone would let that through. Exclude legitimately-nullable fields (like vaultsfyi's `risk_score`) from the probe and guard them in the deny rule instead (`vf.risk_score != null`).

## Step 3 — Test with OPA

Write `policy_test.rego` with fixtures shaped like the merged blob — both oracles' outputs under their short pack ids, params under theirs. Cover each deny path, the all-clean allow, simultaneous denies (no fail-open), and fail-closed-on-error for **each** oracle.

```bash
opa test my_vault_gate/policy.rego my_vault_gate/policy_test.rego -v
```

> Gotcha: OPA's `object.union` **deep-merges**. To test fail-closed-on-error you must fully *replace* an oracle's slice with `{"error": ...}`, not `object.union` an `error` key onto the clean fields (which leaves the well-formed fields in place and masks the test).

## Step 4 — Deploy: one policy, N PolicyData

No new WASM build. Upload your Rego + schemas, then deploy a single `NewtonPolicy` referencing the reused `policyData` addresses — one `--policy-data-address` flag per oracle:

Addresses below are vaultsfyi + chainalysis on Sepolia / stagef (from `deployments.json`). Keep the inline comments OUT of the command — a `\` line-continuation followed by a `#` comment breaks the continuation in bash.

```bash
# --policy-data-address order: vaultsfyi, then chainalysis
newton-cli policy deploy \
  --policy-cids ./my_vault_gate/dist/policy_cids.json \
  --policy-data-address 0x347c9151177bCcFd7ABE70196c4790a2dCae528b \
  --policy-data-address 0x223F563c3CfD087cB1857851629b4d8CE7738448 \
  --policy-file ./my_vault_gate/policy.rego
# → "Policy deployed successfully at address: 0xYOUR_COMPOSITE..."
```

**On-chain order is position-significant.** The `getPolicyData()` array preserves your `--policy-data-address` flag order, and `PolicyValidationLib.sol` enforces positional equality on every execution. You don't have to mirror that order in your TypeScript, though — `defineComposite` reads `getPolicyData()` and aligns your `modules` array to it automatically (Step 5). What matters is that the **set** of modules you pass matches the deployed oracles.

Requires `newton-cli` with the repeated-`--policy-data-address` form (shipped in newton-prover-avs PR #672). Older CLIs only deploy single-PolicyData policies.

## Step 5 — Wire it up in TypeScript

Install the SDK + the packs you're composing:

```bash
pnpm add @newton-xyz/policy-pack-shared @newton-xyz/policy-pack-vaultsfyi @newton-xyz/policy-pack-chainalysis
```

```ts
import { defineComposite, encodeCompositePolicyPack } from "@newton-xyz/policy-pack-shared";
import { vaultsfyi } from "@newton-xyz/policy-pack-vaultsfyi";
import { chainalysis } from "@newton-xyz/policy-pack-chainalysis";

// Builder reads getPolicyData() on-chain and aligns your modules to it. Pass
// them in ANY order — defineComposite reorders to match the deployed array, so
// the emitted manifest is always position-correct. A module whose oracle isn't
// in the on-chain policy throws CompositeModuleSetMismatchError, before setPolicy.
const composite = await defineComposite({
  modules: [vaultsfyi, chainalysis],   // order-independent — aligned to on-chain
  chainId: "11155111",
  env: "stagef",
  publicClient,
  policyAddress: "0xYOUR_COMPOSITE...",  // from step 4
});

// Encode the curator's per-module params — keyed by short pack id, validated
// against each module's paramsSchema before bytes are emitted.
const policyParams = encodeCompositePolicyPack(composite, {
  vaultsfyi:   { apy_z_max: 4, risk_score_floor: 80, /* ... */ },
  chainalysis: { deny_on_sanctioned: true, /* ... */ },
});

await shield.setPolicyAddress("0xYOUR_COMPOSITE...");
await shield.setPolicy(policyParams, expireAfter);
```

### Per call: aggregated prepareQuery

The composite's `prepareQuery` runs every module's `prepareQuery` in parallel and merges the results into one `wasmArgs` blob keyed by short pack id. Pass per-module options keyed by short id — chainalysis needs the depositor address to screen, redstone needs its oracle config, etc.:

```ts
const { wasmArgs } = await composite.prepareQuery(
  { publicClient, vault },
  {
    chainalysis: { address: depositorAddress },
    // modules with no per-call options omit their key
  },
);
```

If any module's `prepareQuery` rejects, the aggregated call fails fast with a `CompositePrepareQueryError` carrying the offending module — partial `wasmArgs` would let Rego evaluate against missing data, which is worse than failing the intent.

## Step 6 — Verify on-chain

Depositors (and your own integration tests) verify a deployed composite with `introspectComposite`. It walks the read path (`getPolicyAddress` → `getPolicyId` → `getPolicyConfig` → decode the manifest → `getPolicyData()` + `getWasmCid()` per module) and reports whether the manifest matches on-chain state:

```ts
import { introspectComposite, getPolicyManifest } from "@newton-xyz/policy-pack-shared";

const report = await introspectComposite({ publicClient, shieldAddress });
report.verification.onChainPolicyDataMatches;  // module addresses match, in order
report.verification.wasmCidsMatch;             // each module's wasmCid matches

// Don't know if a Shield is single-pack or composite? getPolicyManifest dispatches:
const m = await getPolicyManifest({ publicClient, shieldAddress });
m.kind; // "single-pack" | "composite"
```

## Gotchas

- **Params flat → namespaced.** The single biggest copy mistake. Each pack's standalone Rego uses `t := data.params` (flat); composites use `data.params.<short-id>`. Rewrite every params reference when you copy deny rules in.
- **On-chain module order is load-bearing, but the SDK aligns to it for you.** The `--policy-data-address` flag order fixes the on-chain `getPolicyData()` array order, and `PolicyValidationLib.sol` enforces it on every execution. You do NOT have to pass `modules` to `defineComposite` in that same order — it reorders your array to match `getPolicyData()` automatically, so the emitted manifest is always position-correct. Only the **set** must agree; a module whose oracle isn't in the deployed policy throws `CompositeModuleSetMismatchError`.
- **Fail closed by construction.** Don't write `default allow := true` or an `allow` that's just `count(deny) == 0` — an oracle error produces zero denies. Require the well-formedness probes.
- **Short-pack-id uniqueness.** Two modules deriving the same short id (e.g. two versions of the same pack) make `data.params.<short-id>` ambiguous. `defineComposite` rejects this.
- **Redeploy drift.** If a pack redeploys its `policyData` after you deployed your composite, your composite is still valid on-chain but `module.deployments` no longer matches. Pass `expectedPolicyDataAddresses` + `expectedWasmCids` to `defineComposite` to pin to the historical addresses. See [`define-composite-spec.md`](./define-composite-spec.md) § "historical pin".

## Reference

- [`examples/composite-vaultsfyi-chainalysis/`](../examples/composite-vaultsfyi-chainalysis/) — complete copy-paste example (Rego + tests + deploy recipe + TypeScript)
- [`composite-policies.md`](./composite-policies.md) — architecture + the AVS multi-PolicyData mechanism
- [`composite-manifest-spec.md`](./composite-manifest-spec.md) — the on-chain manifest byte format
- [`define-composite-spec.md`](./define-composite-spec.md) — the `defineComposite` builder API + every typed error
- [`deployments.json`](../deployments.json) — the published `policyData` addresses you compose
