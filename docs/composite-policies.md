# Composite policies

> **Status:** Phase 0 + Phase 1 done; Phase 1.5 / Phase 2 in progress. The rollout has four phases — Phase 0 = pack-side namespacing one-shot break + `wrapOutput` helper (DONE); Phase 1 = `OracleModule` exports per pack (DONE in [PR #67](https://github.com/newt-foundation/newton-policy-packs/pull/67)); Phase 1.5 = on-chain manifest format + decode helpers (in progress); Phase 2 = `defineComposite` builder + `KNOWN_PACK_IDS` registry + SDK consumption helpers (in progress) — and shipping artifacts include:
>
> - **Phase 0 (done)** — Pack-side namespacing convention: `PACK_ID` wrapper in every pack's `policy.js` (output namespacing — `wrapOutput("<pack-id>", ...)`), `data.wasm.<pack-id>.*` references in every pack's `policy.rego`. Every reference pack in this repo now namespaces correctly; copy-as-is into a composite works.
> - **Phase 0 (done)** — `wrapOutput` helper exported from `@newton-xyz/policy-pack-shared`.
> - **Phase 0 (done)** — `wrapping_test.rego` per-pack tests asserting namespace correctness, present in all 9 packs.
> - **Phase 0 (done)** — AST-lint CI guard (`scripts/lint-policy-js.ts`) flagging raw `JSON.stringify(...)` returns in `policy.js` that bypass `wrapOutput`. A runtime-simulation harness that exercises actual output shape on every code path is a recommended follow-up once a host-import (`newton:provider/{http,secrets}`) mocking story lands.
> - **Phase 2 prerequisite (forward-looking)** — `newton-cli` multi-PolicyData support: `--policy-data-address` repeated-flag (one invocation per PolicyData). NOT required for Phase 0 single-pack redeploys.
> - **Phase 1 (done)** — `OracleModule` type + `oracleModuleFromPack(pack)` helper in `@newton-xyz/policy-pack-shared`, plus `<name>OracleModule` exports per `@newton-xyz/policy-pack-<name>` package, covering all 9 packs: `vaultsfyiOracleModule`, `chainalysisOracleModule`, `redstoneOracleModule`, `personaOracleModule`, `sumsubOracleModule`, `blockaidOracleModule`, `guardrailOracleModule`, `webacyOracleModule`, `balancerOracleModule`. `getDeployment` accepts both `PolicyPack` and `OracleModule`.
> - **Phase 2 (forward-looking)** — `KNOWN_PACK_IDS` registry constant in `@newton-xyz/policy-pack-shared`, shipping alongside the SDK guard that consumes it.
>
> The composite-deploy workflow below describes the end state. The namespacing claims and `OracleModule` exports are live today; the `defineComposite(...)` and `KNOWN_PACK_IDS` references describe the API after Phase 2 lands.

Authoring one Newton policy that consumes **multiple oracle modules** under one auditable on-chain artifact. This is how a vault curator gates a single action (say, MetaMorpho `reallocate`) with risk + sanctions + oracle-divergence simultaneously, while preserving "one policy address per vault" for depositor verification.

> **Audience:** you author Rego, run `newton-cli`, and publish PolicyData/Policy contracts. If you're a vault curator looking for the TypeScript SDK integration, see the [`@newton-xyz/newton-shield-sdk` package on npm](https://www.npmjs.com/package/@newton-xyz/newton-shield-sdk) and its [SDK docs](https://docs.newton.xyz/) (composite usage lands alongside the package's `0.5.0+` release).

## What's a composite

A composite policy is **one deployed `NewtonPolicy` contract** whose on-chain `policyData[]` array references **two or more existing `NewtonPolicyData` deployments** (the per-pack oracle WASMs already published by this repo).

The Newton AVS evaluates such a policy by:

1. Running each referenced PolicyData's WASM oracle.
2. Merging every oracle's JSON output into one `data.wasm` blob (top-level keys per pack id; see [Namespacing](#namespacing) below).
3. Evaluating your hand-authored Rego against `data.wasm.<pack-id>.*` + `data.params.<pack-id>.*` + `input.*`.
4. Returning `allow` only if every deny rule across every namespace passes.

No new infrastructure. No new WASM build per composite — you reuse existing PolicyData addresses from [`deployments.json`](../deployments.json). The composite-specific work is your Rego, your `params_schema.json`, and a single `(NewtonPolicy + composite-PolicyData-array)` deploy via `newton-cli`.

## When you want this vs a single pack

| Use case | Shape |
|---|---|
| "Gate `reallocate` with VaultsFYI's risk envelope, nothing else" | Single pack — bind `vaultsfyi`'s deployed Policy directly. |
| "Gate `reallocate` with VaultsFYI AND deny if curator wallet is sanctioned" | **Composite** — author Rego over `vaultsfyi + chainalysis`. |
| "Gate `reallocate` with VaultsFYI for risk AND RedStone for oracle health AND Webacy for the depositor's reputation" | **Composite** — three modules. |
| "Gate `reallocate` with VaultsFYI but `submitCap` with KYC" | Out of scope for composite. v2 design question. |

## Namespacing

Each pack's `policy.js` wraps its output under a top-level `PACK_ID` key:

```js
// vaultsfyi/policy.js
return JSON.stringify({ vaultsfyi: { score: 80, risk_score: 75, /* ... */ } });

// chainalysis/policy.js
return JSON.stringify({ chainalysis: { sanctioned: false, risk_categories: [/* ... */] } });
```

After the AVS's shallow `merge_jsons` of N oracle outputs, your composite Rego sees:

```rego
data.wasm.vaultsfyi.risk_score      # number
data.wasm.chainalysis.sanctioned    # bool
data.wasm.redstone.divergence_pct   # number
```

**Status today:** every pack in this repo emits namespaced outputs (`{ <pack-id>: { score, risk_score, ... } }`) via `wrapOutput("<pack-id>", ...)` and references `data.wasm.<pack-id>.*` in Rego. Phase 0 landed across all 9 packs. New packs MUST adopt the same convention — `policy.js` MUST wrap its return value via `wrapOutput`, and `policy.rego` MUST reference `data.wasm.<pack-id>.*`. The AST-lint CI guard (`scripts/lint-policy-js.ts`) and per-pack `wrapping_test.rego` enforce both halves on PRs.

Params follow the same convention:

```rego
data.params.vaultsfyi.risk_score_floor    # number
data.params.chainalysis.deny_on_sanctioned # bool
```

## Authoring a composite — five concrete steps

### 1. Pick the modules

Read [`deployments.json`](../deployments.json) for the canonical `(policy, policyData, wasmCid)` per pack per chain. Pick the modules you want.

For each module, also note the typed schemas in its TypeScript binding under [`packages/policy-pack-<name>/src/`](../packages):

- `params.ts` → what params the module's WASM expects
- `wasm-args.ts` → what wasm_args the module's WASM consumes
- `secrets.ts` → what secrets the module reads (if any)

These define what your composite's `params_schema.json` for that module's namespace must look like.

### 2. Author your `policy.rego`

Hand-write the Rego. Reference the namespaced data:

```rego
package my_composite

# Imports follow newton-cli's existing convention; see <pack>/policy.rego
# for the canonical shape every module's reference Rego uses.

import rego.v1

default allow := false

# Allow only when no deny rule fires
allow if {
    count(deny) == 0
}

# Deny if VaultsFYI risk score is below the configured floor
deny contains msg if {
    score := data.wasm.vaultsfyi.risk_score
    floor := data.params.vaultsfyi.risk_score_floor
    score < floor
    msg := sprintf("vaultsfyi risk score %v below floor %v", [score, floor])
}

# Deny if Chainalysis flagged the curator wallet
deny contains msg if {
    data.wasm.chainalysis.sanctioned == true
    msg := "chainalysis: curator wallet sanctioned"
}

# Deny if VaultsFYI errored AND we configured strict mode
deny contains msg if {
    data.wasm.vaultsfyi.error
    data.params.my_composite.strict_mode == true
    msg := sprintf("vaultsfyi oracle error in strict mode: %v", [data.wasm.vaultsfyi.error])
}
```

Notes:

- Each pack's reference `policy.rego` (e.g. [`vaultsfyi/policy.rego`](../vaultsfyi/policy.rego), [`chainalysis/policy.rego`](../chainalysis/policy.rego)) is the starting template for the deny rules over THAT module's outputs. The bundled per-pack templates already reference `data.wasm.<pack-id>.<field>` (e.g. `v := data.wasm.vaultsfyi`) so copy-as-is into a composite works.
- Errors are namespaced too (post-Phase-0). `data.wasm.vaultsfyi.error` is set when vaultsfyi's WASM hit an exception; you decide whether to deny on it. The bundled per-pack reference Rego documents each module's error semantics.
- Top-level params under your composite's namespace (e.g. `my_composite.strict_mode` above) follow from how the AVS evaluates merged policy data — see [`docs.newton.xyz`](https://docs.newton.xyz/developers/guides/writing-policies) for the canonical Rego authoring guide. The exact merge convention for composite-author top-level params lands with the reference walkthrough at `examples/composite-vaultsfyi-chainalysis/`; verify against your composite's simulation output before relying on it.

Run `opa test` against your Rego before deploying:

```bash
opa test ./my_composite/policy.rego ./my_composite/policy_test.rego -v
```

### 3. Author `params_schema.json`

The composite's params schema covers BOTH the per-module params AND any top-level composite-author params:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "required": ["vaultsfyi", "chainalysis", "my_composite"],
  "properties": {
    "vaultsfyi": {
      "type": "object",
      "required": ["risk_score_floor", "tvl_drawdown_24h_max_pct"],
      "properties": {
        "risk_score_floor": { "type": "integer", "minimum": 0, "maximum": 100 },
        "tvl_drawdown_24h_max_pct": { "type": "number", "minimum": 0, "maximum": 1 }
      }
    },
    "chainalysis": {
      "type": "object",
      "required": ["deny_on_sanctioned"],
      "properties": {
        "deny_on_sanctioned": { "type": "boolean" },
        "deny_on_high_risk": { "type": "boolean" }
      }
    },
    "my_composite": {
      "type": "object",
      "properties": {
        "strict_mode": { "type": "boolean" }
      }
    }
  }
}
```

The per-module sub-schemas should be a subset of (or compatible with) the published `<pack>/params_schema.json` for that module — only declare the fields YOUR Rego actually consumes. The AVS won't validate your composite's params against each module's full schema; that's your Rego's job.

### 4. Deploy with `newton-cli`

The composite has its own `policy.rego` + `params_schema.json` + `policy_metadata.json`, but its **WASM is the existing per-pack WASMs** referenced by `policyDataAddresses[]`. You don't build a new WASM.

> **CLI usage — repeated-flag form.** `newton-cli policy deploy` accepts `--policy-data-address` once per PolicyData (zero invocations = empty array, one = single-pack, N = composite). The flag name stays singular — clap's derive macros automatically infer repeated-flag semantics for `Vec<Address>` fields, so the same flag can appear N times in one invocation without breaking existing single-pack scripts. Tracked under [NEWT-1534](https://linear.app/magiclabs/issue/NEWT-1534).

Three deploy steps from your composite directory (post-CLI-update):

```bash
# 1. Upload composite policy artifacts (Rego + params schema + metadata)
#    NOTE: your composite has NO `dist/policy.wasm` of its own — it references
#    existing PolicyData contracts. `policy-files generate-cids` should be
#    invoked with --skip-wasm or equivalent (see newton-cli docs for the
#    composite flow when it ships).
newton-cli policy-files generate-cids \
  -d ./my_composite/dist \
  --entrypoint my_composite.allow \
  -o ./my_composite/dist/policy_cids.json

# 2. Deploy the composite NewtonPolicy contract, binding it to existing
#    PolicyData addresses from this repo's deployments.json:
newton-cli policy deploy \
  --policy-cids ./my_composite/dist/policy_cids.json \
  --policy-data-address 0xVAULTSFYI_PD \
  --policy-data-address 0xCHAINALYSIS_PD \
  --policy-file ./my_composite/policy.rego
# → "Policy deployed successfully at address: 0xACME..."
```

The repeated-flag shape shipped in `newton-prover-avs` PR #672 (merged 2026-06-13). Run `newton-cli policy deploy --help` to confirm the flag accepts repeated invocations on your local install.

Capture the deployed `0xACME...` address — that's your composite's `NewtonPolicy` address. The composite's `getPolicyData()` view returns the array of addresses you passed via repeated `--policy-data-address` flags, in invocation order. **Note:** order matters — `PolicyValidationLib.sol:51-57` enforces positional equality between the submitted policyData array and on-chain `INewtonPolicy.getPolicyData()`, so don't reorder by hand once deployed.

### 5. Bind on-chain via `setPolicyAddress`

This step is curator-side, in the consuming Shield clone. Your composite's address goes into `Shield.setPolicyAddress(0xACME...)`, then the curator's params manifest goes into `Shield.setPolicy(policyParams, expireAfter)`. On the curator side, `defineComposite(...)` from [`@newton-xyz/policy-pack-shared`](https://www.npmjs.com/package/@newton-xyz/policy-pack-shared) (npm) is the **builder + manifest encoder** — it's async (curators `await defineComposite({ ..., publicClient })` because the builder reads the deployed `INewtonPolicy.getPolicyData()` at construction time to enforce positional ordering against the curator's `policyDataAddresses`) and resolves to a `CompositePolicyPack` describing the composite. The bytes for `Shield.setPolicy(...)` come from the free function `encodeCompositeParams(pack, curatorParams)` (also in `policy-pack-shared`). The two on-chain transactions (`setPolicyAddress` and `setPolicy`) are submitted by the curator using [`@newton-xyz/newton-shield-sdk`](https://www.npmjs.com/package/@newton-xyz/newton-shield-sdk) (which consumes the `CompositePolicyPack`); `defineComposite` itself does not wrap or send them. See the SDK's consumer-side `composite-policy-packs` doc for the curator-side recipe.

## The on-chain manifest

You don't author this manifest manually — `defineComposite(...)` from `@newton-xyz/policy-pack-shared` encodes it from your published params + the modules you wired up. The curator-side flow is the audience for the byte-level details.

For pack-author awareness: when curators bind your composite to a Shield, the on-chain `policyParams` blob is **a single UTF-8 JSON object** (not an ABI tuple) carrying a `_manifest` magic-byte discriminator, a `modules[]` array (one entry per module: `id`, `policyDataAddress`, `wasmCid`), and a `params` object keyed by module id. The JSON shape lets the AVS host's existing `serde_json::from_str` decoder consume it without protocol-level changes ([NEWT-1516](https://linear.app/magiclabs/issue/NEWT-1516)). `@newton-xyz/policy-pack-shared` exposes `decodeManifest(...)`, `isCompositeManifest(...)`, and `introspectComposite(...)` for depositor verification — depositors verify the manifest's `modules[*].policyDataAddress` ordered array (positional, not set-equal) against the on-chain `INewtonPolicy(addr).getPolicyData()` AND each module's `wasmCid` against the on-chain `INewtonPolicyData(addr).getWasmCid()`, so any stale module list or incorrect CID surfaces before a transaction executes.

For the full byte layout, magic-byte format, error semantics, and on-chain verification helper API, see [`composite-manifest-spec.md`](./composite-manifest-spec.md) (NEWT-1541). The pack-author concern is making sure your `<name>OracleModule.deployments[chainId][env].wasmCid` value matches what the AVS actually serves at the deployed PolicyData address for that `(chainId, env)` cell — that's what depositor integrity checks against. Use `getDeployment(pack, chainId, env)` from `@newton-xyz/policy-pack-shared` rather than indexing `deployments` by hand to surface unsupported-cell errors immediately.

## Why it works this way

The on-chain split between `NewtonPolicy` (Rego) and `NewtonPolicyData[]` (oracle WASMs) is part of the Newton Policy Protocol from day one — see [`INewtonPolicy.sol`](https://github.com/newt-foundation/newton-contracts) on the upstream protocol for the contract surface. Single-pack policies happen to be the degenerate case where `policyData[]` has length 1; composites are length N.

What this repo adds on top of the protocol primitive:

1. A naming convention (`PACK_ID` namespacing in `policy.js` outputs) so multi-oracle Rego can reference outputs without key collisions.
2. Reference Rego files per pack so curators don't author against an unfamiliar oracle shape from scratch.
3. The TypeScript bindings (`@newton-xyz/policy-pack-<name>` on npm) that `defineComposite(...)` (in `@newton-xyz/policy-pack-shared`) consumes to wire the composite into a `PolicyPack` for the Shield SDK to execute.

## What composites CAN'T express

- **Conditional gates.** "Only call Chainalysis if VaultsFYI is high-risk" — every PolicyData WASM runs every call. Conditional flow inside one composite WASM is a different shape; ask before going there.
- **Per-action gates from one composite.** Same Rego applies to every action your Shield routes. If you need different gates for `reallocate` vs `submitCap`, that's a v2 protocol-level question.
- **Live updates to one module's params.** Updating `vaultsfyi.risk_score_floor` re-encodes the WHOLE composite manifest and `setPolicy(...)`'s the new bytes. Acceptable for low-frequency tuning; not a hot path.

These follow from the AVS's "all PolicyData WASMs execute, then Rego evaluates merged data" model. They're not bugs — they're the design boundary.

## Building a new module that's composable

If you're contributing a new pack to this repo and want it to be usable in composites (post-Phase-2 of the rework — the namespacing convention from Phase 0 + the `OracleModule` export from Phase 1 + the `KNOWN_PACK_IDS` registry consumer that ships in Phase 2 all need to land first):

1. Wrap every output path in `policy.js` under a top-level `PACK_ID` key, including error returns:

```js
return JSON.stringify({ [PACK_ID]: existingOutputOrError });
```

A repo-level AST-lint CI check flags raw `JSON.stringify(...)` returns that bypass `wrapOutput`; the source-level check fires on PRs without needing per-pack runtime fixtures. The canonical pack-id registry (`KNOWN_PACK_IDS`) lives in `@newton-xyz/policy-pack-shared` post-Phase-2 — add your pack id there in the PR that wires Phase 2's defensive-check guard. The registry shape is `readonly string[]` exported from `@newton-xyz/policy-pack-shared`, with each entry matching the `id` field on the corresponding `<name>OracleModule`.

2. Reference your namespaced output from `policy.rego`:

```rego
v := data.wasm.<your-pack-id>
deny contains msg if { v.<field> < data.params.<your-pack-id>.<threshold>; ... }
```

3. Publish a `<your-pack>OracleModule` export from `packages/policy-pack-<your-pack>/src/index.ts` with `paramsSchema` + `wasmArgsSchema` + `secretsSchema` derived from the schema files. `defineComposite(...)` (in `@newton-xyz/policy-pack-shared`) consumes the `OracleModule` directly when curators pass your module to it; the resulting `CompositePolicyPack` is what the Shield SDK consumes for execution. The `OracleModule` type ships in `@newton-xyz/policy-pack-shared` post-Phase-1.

The reference walkthrough at `examples/composite-vaultsfyi-chainalysis/` (post-Phase-2) is the worked example showing the full `<name>OracleModule` export wiring end-to-end.

## See also

- [`README.md`](../README.md) — repo overview, single-pack deploy flow, environment setup.
- [`OPERATING.md`](../OPERATING.md) — post-deploy lifecycle (PolicyClient + secrets).
- [`deployments.json`](../deployments.json) — canonical PolicyData addresses per pack per chain.
- [`@newton-xyz/newton-shield-sdk`](https://www.npmjs.com/package/@newton-xyz/newton-shield-sdk) on npm — the curator-facing SDK that consumes composites you deploy.
- Newton Protocol developer docs — [`docs.newton.xyz`](https://docs.newton.xyz/developers/overview/core-concepts) covers `NewtonPolicy`, `NewtonPolicyData`, `Task`, `Attestation` semantics that this guide builds on.
