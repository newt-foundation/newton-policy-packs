# xerberus_common_cause

## Overview

This policy catches **false diversification**. Positions in Fluid, Morpho, Compound and crvUSD look independent, but they can all lean on the same collateral token, the same staking protocol, the same oracle or the same governance contract, and a failure in that shared piece hits them together. Using [Xerberus](https://xerberus.io)'s dependency graph, it finds the upstream nodes a portfolio's venues share, prices each by the USD of the book sitting in the venues behind it, and denies when one carries more than the curator tolerates.

Requires a Xerberus API key (`XERBERUS_API_KEY`).

## How it works

### Data Oracle (policy.js)

MCP `tools/call`s POSTed as JSON-RPC 2.0 to `https://mcp.xerberus.io/mcp` with the key in the `x-api-key` header. The transport is shared with the other `xerberus_*` packs; see [xerberus_liquidity_exit](../xerberus_liquidity_exit/README.md#data-oracle-policyjs).

1. **`get_positions`** for each wallet. The first answer fixes the window (the latest unless `window` is pinned) and every later call is pinned to it. In-model supply and collateral rows are summed per market into venue exposure, keyed `market:<market_uid>`; borrow rows count toward `debt_usd` only, since debt is owed to a venue rather than lost with it. Spot rows are skipped.
2. **`shared_dependencies_nodes`** over the venues above the $100 dust floor (largest 50, the tool's limit), with `min_shared: 2`, `top_k: 200` and the same window. By default it follows every dependency family except `liquidity_venue` and `lp_constituent`; those are DEX pools with no loss rate that would otherwise fill the ranking ahead of the nodes that matter. Pass `relations` to choose families.
3. Each shared node's `exposure_usd` is the sum of venue exposure across the venues that share it.

`common_cause`, which this pack used to call on the enterprise endpoint, is retired on `/mcp`. Its missing-safeguard tags and failure classes have no counterpart in the graph, so the rules below are new rather than ported.

| Field | Description |
|---|---|
| `wallets` / `chain` / `relations` | Echoed from wasm_args (`relations` after defaults) |
| `venues_compared_count` | Venues sent to `shared_dependencies_nodes` |
| `book_usd` / `debt_usd` | Supply + collateral, and borrow, across all in-model positions |
| `venues_omitted_usd` | Exposure in venues beyond the largest 50 |
| `unresolved_venues[]` | `{venue, exposure_usd}` for venues Xerberus could not place in its graph |
| `shared_nodes[]` | `{node, node_type, label, venue_count, exposure_usd, expected_loss_share, combined_weight, combined_contribution}`, largest `exposure_usd` first |
| `shared_node_count` / `shared_nodes_truncated` | Shared nodes returned, and whether Xerberus found more than `top_k` |
| `largest_shared_node` / `largest_shared_exposure_usd` | The shared node with the most of the book behind it |
| `requested_window` / `data_window` / `latest_window` / `window_honored` / `is_stale` / `data_age_seconds` | Freshness, as in the other `xerberus_*` packs |

`node_type` is Xerberus's: `token`, `protocol`, `oracle`, `gov`, `irm` and so on. `expected_loss_share` is the node's own Xerberus loss rate in [0, 1]; protocols, oracles and governance contracts carry 0, and Xerberus's "zero exit value" (null) is carried as 0 as it does. `combined_weight` and `combined_contribution` are Xerberus's dimensionless graph weights, passed through for reviewers.

### Policy Rules (policy.rego)

Package `xerberus_common_cause`. A shared node is **in scope** when at least `min_venues_for_shared_node` venues share it and, if `shared_node_types` is non-empty, its type is listed. Deny reasons:

| Deny reason | Fires when |
|---|---|
| `oracle_error` / `malformed_oracle_output` | Oracle error, or a field the rules read is missing |
| `stale_data` | `deny_on_stale` and Xerberus flags the window stale |
| `data_too_old` | `data_age_seconds > max_data_age_seconds` |
| `window_not_honored` | A window was pinned and Xerberus answered from another |
| `shared_exposure_limit` | An in-scope node has more than `max_shared_exposure_usd` behind it |
| `shared_book_share_limit` | An in-scope node has more than `max_shared_exposure_pct_of_book` percent of `book_usd` behind it |
| `shared_loss_limit` | An in-scope node's `expected_loss_share` exceeds `max_shared_expected_loss_share` |
| `forbidden_shared_node` | A `forbidden_shared_nodes` id is shared by at least `min_venues_for_shared_node` venues |
| `unresolved_material_venue` | `deny_on_unresolved` and an unresolved venue holds at least `material_venue_usd` |
| `shared_nodes_truncated` | `deny_on_truncated` and Xerberus returned fewer shared nodes than it found |
| `insufficient_venues` | Fewer than `min_venues_compared` venues were compared |
| `wallets_not_bound_to_intent` | `require_intent_party_in_wallets` and neither the intent's sender nor target is an analysed wallet |

The `shared_risks` rule explains what tripped (for example `wstETH (token:0x7f39…) shared by 7 venues, $8979728 of a $16444693 book behind it`). It is for `opa eval`, local simulation and composites; the AVS only evaluates `allow`.

### Policy Parameters

| Param | Type | Description |
|---|---|---|
| `min_venues_for_shared_node` | number | Venues that must share a node before any limit applies. Reference: 2 |
| `shared_node_types` | string[] | Node types the limits apply to; empty means all |
| `max_shared_exposure_usd` | number | USD ceiling behind one shared node. Reference: 5,000,000 |
| `max_shared_exposure_pct_of_book` | number | Ceiling behind one shared node, percent of `book_usd`. Reference: 40 |
| `max_shared_expected_loss_share` | number | Ceiling on a shared node's own loss rate. Reference: 0.05 |
| `forbidden_shared_nodes` | string[] | Node ids that must not be shared (e.g. `protocol:lido`, `oracle:0x…`) |
| `material_venue_usd` | number | Exposure at which an unresolved venue matters |
| `deny_on_unresolved` | bool | Deny on material unresolved venues |
| `deny_on_truncated` | bool | Deny when the shared-node list was truncated |
| `min_venues_compared` | number | Venues needed for a meaningful comparison. Reference: 2 |
| `deny_on_stale` | bool | Deny when Xerberus flags the window stale |
| `max_data_age_seconds` | number | Oldest data window accepted |
| `require_intent_party_in_wallets` | bool | Bind the analysed portfolio to the transaction |

### Live result

Treasury `0xac01…5b64`, 2026-10-29T12:00 UTC window (not stale), reference params: **DENY** (`shared_exposure_limit`, `shared_book_share_limit`). The book is $16.44M of supply and collateral across 11 venues. Seven of those venues lean on wstETH and, through it, WETH, `protocol:lido` and Lido's governance contract, with $8.98M (55%) of the book behind them. `protocol:crvusd` has $7.69M behind it across two venues, WBTC $6.09M across four, and two oracle contracts about $5.4M each across three. No shared node has an expected loss share above 0.03.

## Notes

- **Shared nodes overlap.** A token, its issuer protocol and that protocol's governance contract usually share the same venues, so one concentration trips several nodes at once. `shared_risks` lists each one; read them together.
- **USD is venue exposure, not token exposure.** `exposure_usd` sums the supply and collateral in every venue that leans on a node, including assets in those venues that are not the node itself. It answers "how much of the book is in venues that fail together if this node fails", which is the common-cause question.
- **Oracles are contracts, not providers.** Xerberus names oracles by contract address rather than by provider, so `forbidden_shared_nodes` takes `oracle:0x…` ids, not `protocol:chainlink`.
- **New venues are invisible.** Only positions that already exist in the supplied wallets are compared, so a transaction entering a brand-new venue cannot be evaluated for shared risk until after it lands. Gate first-time venue entry separately, with a destination-protocol check or manual approval.
- **Two venues minimum.** `insufficient_venues` stops a single-venue result from reading as "no shared risk".

## Prerequisites

```bash
newton-cli doctor
```

## Build

```bash
jco componentize ./xerberus_common_cause/policy.js \
  --wit ./xerberus_common_cause/newton-provider.wit \
  -n newton-provider \
  --disable http --disable random --disable fetch-event --disable stdio \
  -o ./xerberus_common_cause/dist/policy.wasm
```

The `--disable` flags are mandatory — without them the WASM imports `wasi:http`, which the Newton runtime rejects. Verify with `jco print ./xerberus_common_cause/dist/policy.wasm | grep wasi:http`: only the unused `(export ...)` line should appear, never an `(import ...)`.

## Simulate

```bash
newton-cli policy simulate \
  --wasm-args ./xerberus_common_cause/configs/wasm_args.json \
  --intent-json ./xerberus_common_cause/configs/intent.json \
  --policy-params-data ./xerberus_common_cause/configs/params.json \
  --secrets-file ./xerberus_common_cause/configs/secrets.json \
  --rego-file ./xerberus_common_cause/policy.rego \
  --entrypoint xerberus_common_cause.allow \
  --wasm-file ./xerberus_common_cause/dist/policy.wasm
```

Run the Rego unit tests with OPA:

```bash
opa test ./xerberus_common_cause/policy.rego ./xerberus_common_cause/policy_test.rego ./xerberus_common_cause/wrapping_test.rego -v
```

## Deploy

See the Quick Start in the [root README](../README.md). This pack ships a reusable **PolicyData oracle**, not a blessed `NewtonPolicy` — curators deploy their own policy (single-pack or composite) referencing the oracle address.

## Deployments

Canonical addresses live in [`deployments.json`](../deployments.json).
