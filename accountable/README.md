# accountable

## Overview

Gates vault allocations on **Accountable's DVN (Data Verification Network)** attestations for the off-chain book behind a collateral token. Accountable publishes an independently attested value for that book, an ordinal rating for how strongly the value was verified, and a snapshot timestamp — this pack turns those into an on-chain-enforceable gate: is the proof fresh, is it strong enough, does the attested value agree with the price the vault is actually using, and is Accountable's network itself healthy enough to trust right now.

This pack was scoped directly against Tempora Labs' αCV conceptual brief (three declared-but-unenforced parameters already shipped in every published mandate — `min_verifiability_rung`, `proof_max_age_seconds`, `max_nav_deviation_pct`) and against Accountable's own field list for what their API already publishes per venue. It follows the same shape as this repo's existing oracle-divergence and risk-floor packs — nothing here required a new architecture:

| Accountable-shaped rule | Precedent in this repo |
|---|---|
| Freshness window | `redstone`'s `max_feed_age_seconds` — a parameterized staleness check, not a hardcoded one |
| Verifiability strength floor | `chainalysis`'s risk-enum floor — an ordinal comparison against a mandate-set threshold |
| NAV/price divergence ceiling | `redstone`'s `divergence_bp` — two numbers from different origins, compared as a percentage |

## How it works

### Data Oracle (policy.js)

Calls `GET {nodeUrl}/dashboard` on the attested entity's own Accountable node, and reads the mandate author's chosen on-chain price via `eth_call` (same `{address, selector, decimals}` shape as `redstone`'s `onchainOracle` — which price is authoritative is a caller decision, not a pack default). Emits a normalized snapshot:

| Field | Description |
|-------|-------------|
| `node_url` | Accountable node queried |
| `data_source` | Key into that node's `dataSources` map this evaluation gates on |
| `verifiability` | That data source's `verificationLevel` (integer; 4 and 6 observed live — API/custodian connectors vs. on-chain wallet) |
| `attested_value` | `total_reserves.value / total_supply.value` — the per-unit backing ratio, the quantity actually comparable to an on-chain share price |
| `onchain_price` | Price read on-chain via `eth_call`, per `wasm_args.onchainPrice` |
| `nav_deviation_pct` | `\|attested_value − onchain_price\| / onchain_price × 100` |
| `snapshot_last_updated_ms` | That data source's `lastUpdated` (ms epoch) |
| `snapshot_age_seconds` | Seconds since `lastUpdated`, computed at evaluation time |
| `snapshot_status` | `"ok"` if the data source is present in the node's response, `"missing"` otherwise |
| `carry_forward` | Whether `lastUpdated` is identical to the previous evaluation's (see `wasm_args.prevSnapshot`) — i.e. nothing new arrived since last check |
| `on_roster` | Passed through from `wasm_args.roster.onRoster` — see note below |
| `success_count` / `total_count` | Passed through from `wasm_args.networkStatus` — see note below |
| `success_ratio` | `success_count / total_count`, `null` if `total_count` is 0 or either is absent |
| `timestamp` | Oracle evaluation time (ms) |

### Policy Rules (policy.rego)

The Rego policy denies if **any** of these are true:

| Deny Reason | Condition | What it catches |
|-------------|-----------|-----------------|
| `accountable_proof_stale` | `snapshot_age_seconds > proof_max_age_seconds` | Nobody has re-verified the book inside the freshness window |
| `accountable_carry_forward_proof` | `carry_forward == true` and `deny_on_carry_forward_proof` | A reused prior value served as if fresh |
| `accountable_snapshot_not_ok` | `snapshot_status != "ok"` | A skipped snapshot presented as a proof |
| `accountable_verifiability_below_floor` | `verifiability < min_verifiability_rung` | The proof is weaker than the mandate's floor |
| `accountable_not_on_roster` | `on_roster == false` and `require_roster_membership` | Venue isn't one Accountable's network covers at all |
| `accountable_network_degraded` | `success_ratio < min_success_ratio` | Provider-side degradation — circuit breaker |
| `accountable_nav_deviation_above_cap` | `nav_deviation_pct > max_nav_deviation_pct` | Attested value and on-chain price have come apart |

`allow` is structured positively — it requires every field the deny rules read to be well-typed (`is_number`, `is_string`, `is_boolean`) *and* zero deny reasons, so an oracle error, an empty payload, or a proof that never arrived all fall through to the `default allow := false` instead of silently skipping a rule. This includes `success_ratio`: a venue with `total_count == 0` has no confirmed-healthy signal and denies, even though no single deny reason names it. See `policy_test.rego`'s `test_deny_on_partial_payload` and `test_deny_when_success_ratio_missing` for the two cases this is guarding against — this is the direct implementation of Tempora's "absence must refuse, never abstain" requirement.

### Policy Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `proof_max_age_seconds` | number | Max age of the Accountable snapshot before it denies |
| `min_verifiability_rung` | integer | Floor on Accountable's verifiability rating |
| `max_nav_deviation_pct` | number | Max allowed divergence between attested value and on-chain price, as a percentage |
| `deny_on_carry_forward_proof` | boolean | Deny when the snapshot is a reused prior value, not a fresh one |
| `require_roster_membership` | boolean | Deny when the venue is absent from Accountable's roster |
| `min_success_ratio` | number | Circuit-breaker floor on Accountable's network-wide success ratio |

Parameter names match Tempora's own published `αCV` mandate vocabulary one-to-one (`proof_max_age_seconds`, `min_verifiability_rung`, `max_nav_deviation_pct`) so wiring this pack into an existing bundle is a params-file change, not a rewrite.

### WASM args (per evaluation)

| Field | Type | Description |
|-------|------|-------------|
| `nodeUrl` | string | Base URL of the attested entity's own Accountable node (e.g. `https://axis.accountable.capital:8443`) |
| `dataSource` | string | Key into that node's `dataSources` map (e.g. `"Blockchain"`, or an exchange/custodian source name) |
| `rpcUrl` | string | JSON-RPC URL for the chain the on-chain price lives on |
| `onchainPrice.address` | string | Contract address to read the price from |
| `onchainPrice.selector` | string | 4-byte selector for the price-read call |
| `onchainPrice.decimals` | number | Decimals to scale the raw `eth_call` return (defaults to 18) |
| `prevSnapshot.lastUpdatedMs` | number | Optional. Previous evaluation's `snapshot_last_updated_ms` for this `(nodeUrl, dataSource)`, used to detect a carried-forward reading. Omit on the first-ever evaluation |
| `roster.onRoster` | boolean | Optional. Whether this entity is on the mandate author's covered-entity roster — see note below |
| `networkStatus.successCount` / `.totalCount` | number | Optional. Network-wide health counters for the circuit breaker — see note below |

## Verified against a live node

Accountable's apex domain (`accountable.capital`) 403s server-side/automated fetches, but a real browser session reached `axis.accountable.capital` (their "Axis" proof-of-solvency product) without issue on 2026-08-13, and its dashboard makes unauthenticated calls to `axis.accountable.capital:8443/dashboard`, `/version`, and `/v1/public_key` that are visible in plain network traffic. This is one live, production example, not their full API surface — but it's real data, and it changed the design in a few concrete ways from the first draft (which was built purely from Tempora's abstracted field list):

**Confirmed and kept:**
- Verifiability *is* a small integer ladder, addressed per data source: `dataSources.<name>.verificationLevel` — observed values were `4` for API-based custodian/exchange connectors and `6` for the on-chain wallet source. This validates Tempora's "1-6 rung" description directly.
- **The raw hardware-attestation artifact Tempora's brief called an "Open" ask to Accountable — not yet published — appears to already exist.** The live `/version` and `/dashboard` responses both include a full AWS Nitro Enclave attestation document (`attestations.nitro`), including the PCR0/PCR1/PCR2/PCR8 platform measurements Tempora specifically asked for ("It chains to a public cloud PKI root"). This pack does not attempt to cryptographically verify that attestation chain (that's a real, separate engineering lift — validating against AWS's Nitro root cert), but the artifact being present at all is worth relaying back to Tempora: it may mean this shipped after their brief was written, or that it's live on this particular product surface (Axis) but not the one they were evaluating.

**Changed:**
- **Architecture is per-entity, not a shared multi-tenant API.** Accountable runs one self-hosted node per attested entity (their own "Accountable Node" description), each at its own subdomain, not a single `api.accountable.capital/venues/{id}` endpoint. `wasm_args.nodeUrl` replaced the original `venue` + `apiBaseUrl` design accordingly.
- **Timestamps are millisecond epoch, serialized as strings** (e.g. `"lastUpdated": "1786653902510"`), not the unix-seconds numbers Tempora's brief described. `policy.js` parses and converts.
- **No `snapshot_status` enum, no `carry_forward` flag exist on the raw node payload.** `snapshot_status` is now derived from whether the requested `dataSource` is present in the response; `carry_forward` is now *computed* by this pack from a caller-supplied `prevSnapshot.lastUpdatedMs` diff — the same pattern `redstone` uses for its sustained-divergence check — rather than trusted from a vendor-declared field that doesn't appear to exist.
- **`attested_value` is now `total_reserves.value / total_supply.value`**, not a single vendor-provided "attested value" field — that's what the live payload actually exposes (a reserves total and a supply total, both in the entity's reporting currency), and the ratio is the quantity comparable to an on-chain share price.
- **Roster membership and network-wide success/total counts are caller-supplied, not fetched.** A single Accountable node only knows about itself — it has no visibility into which other entities the DVN covers or how the network overall is performing, so this pack cannot fetch those from `nodeUrl`. This actually matches Tempora's own original framing before their pack proposal ("αCV assembles the facts, Newton evaluates") — those two facts belong to whatever layer already aggregates across nodes on Tempora's side. If `roster`/`networkStatus` are omitted, the corresponding fields come through as `null` and, per the fail-closed default, deny.

**Checked against a second node — found a real gap, not just confirmation:** `aegis.accountable.capital` (a different attested entity, a different product surface, port `10443` not `8443`) has no `dataSources` map at all. `verifiability` is `null` there and this pack correctly fail-closes rather than allowing without a proof — but that also means the verifiability-floor rule can never *pass* for an entity shaped like this one today, only ever deny for lack of the field it reads. That node instead exposes `reserves.verifiability` — an aggregate score (`"100"`-style), not a 1-6 rung, and a different attestation type entirely (`sgx`, not `nitro`). `policy.js` now surfaces this as `entity_verifiability_score_raw`, unused by any deny rule: collapsing a percentage-like aggregate onto a 1-6 ordinal is a policy call for whoever owns the mandate's ladder, not something to decide silently inside the oracle. Whether/how to fold it in is an open question for Tempora, not a bug in this pack.

- **Per-entity → on-chain token mapping** is intentionally not something this pack guesses, not an oversight. `wasm_args.onchainPrice` requires the mandate author (or an assembly step upstream) to already know which on-chain token a given entity's `nodeUrl` describes — keeping that caller-owned is what lets a new entity onboard without touching this pack.

## Prerequisites

```bash
newton-cli doctor
```

## Build

```bash
jco componentize ./accountable/policy.js \
  --wit ./accountable/newton-provider.wit \
  -n newton-provider \
  --disable http --disable random --disable fetch-event --disable stdio \
  -o ./accountable/dist/policy.wasm
```

## Test (Rego unit tests)

```bash
opa test ./accountable/policy.rego ./accountable/policy_test.rego -v
```

## Simulate

```bash
newton-cli policy simulate \
  --wasm-args ./accountable/configs/wasm_args.json \
  --intent-json ./accountable/configs/intent.json \
  --policy-params-data ./accountable/configs/params.json \
  --rego-file ./accountable/policy.rego \
  --wasm-file ./accountable/dist/policy.wasm
```

Run end-to-end against real infrastructure on 2026-08-13 (real Accountable Axis node, real Sepolia `eth_call` against a live ERC-4626 vault — `waUSDT` at `0x092007C7FEfe8798970F88499F003eBBAfD5a826`, unrelated to Accountable's book, so a large `nav_deviation_pct` is the *expected* correct result, not a bug): the oracle fetch, the RPC read, and both the deny and allow paths all evaluated correctly.

**CLI namespacing note, not specific to this pack:** `newton-cli policy simulate` (invoked directly with `--rego-file`/`--wasm-file`, or via `-p`) nests the WASM oracle's return value under `data.data.<pack_id>` locally, not `data.wasm.<pack_id>` — confirmed by diffing behavior against a namespace-patched copy of `policy.rego`. Every pack in this repo (`redstone`, `chainalysis`, `webacy`, this one) is written against `data.wasm.<pack_id>`, matching the documented production AVS composite-merge convention (see the `composite-vaultsfyi-chainalysis` example's README: "the AVS runs both WASMs, merges their outputs into one `data.wasm` blob"). Under the local CLI, that means `allow` evaluates `false` with an empty `deny` set regardless of params — not a real denial, just `data.wasm.<pack>` being undefined locally. This is a pre-existing gap between the local simulate tool and the real runtime, not something this pack introduced; it would reproduce identically running any other pack's own `policy.rego` through bare `newton-cli policy simulate`. Worth a bug report against `newton-cli` separately. Do not "fix" it by rewriting a pack's Rego to read `data.data.*` — that would break it against the real AVS.
