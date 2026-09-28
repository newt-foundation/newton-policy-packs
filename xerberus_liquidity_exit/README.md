# xerberus_liquidity_exit

## Overview

This policy asks one question before an agent acquires a position: **can it be unwound?** Using [Xerberus](https://xerberus.io), it estimates how long selling the proposed notional would take while staying inside a market-impact band, and denies positions that would take too long to exit.

It is an asset-level check. It says nothing about whether the portfolio as a whole becomes too concentrated — pair it with [`xerberus_what_if`](../xerberus_what_if/) and [`xerberus_common_cause`](../xerberus_common_cause/) for that.

Requires a Xerberus enterprise API key (`XERBERUS_API_KEY`).

## How it works

### Data Oracle (policy.js)

One MCP `tools/call` of `liquidity_exit_quote`, POSTed as JSON-RPC 2.0 to `https://mcp.xerberus.io/enterprise/mcp` with the key in the `x-api-key` header.

The MCP transport is shared by all three `xerberus_*` packs:

- Non-2xx HTTP, a JSON-RPC `error`, or `result.isError` all throw, so the pack emits `{error}` and fails closed.
- The response may be plain JSON or a single-shot `text/event-stream`; SSE is split into events and the message carrying the request id is used.
- `result.structuredContent` is preferred; otherwise the JSON in the `text` content blocks is parsed.
- Bodies over 900 KB are rejected before parsing, to stay clear of the WASM HTTP and `JSON.parse` limits.

| Field | Description |
|---|---|
| `token` | Echoed from wasm_args; addresses are lowercased |
| `symbol` / `chain` | Token symbol from Xerberus; chain (always `ethereum` today) |
| `notional_usd` | Position size quoted |
| `impact_band_pct` | Impact band the quote was modeled at |
| `max_sale_per_day_usd` | Most that can be sold per day inside the band |
| `days_to_exit` | Estimated days to fully exit |
| `classification` | Xerberus's label (e.g. moderate, < 1 week) |
| `cex_status` | Whether a centralised spot market was found |
| `requested_window` / `data_window` | Window asked for, and the window Xerberus answered from |
| `window_honored` | `true`/`false` when a window was pinned, `null` otherwise |
| `is_stale` | Xerberus's own freshness flag |
| `data_age_seconds` | Age of `data_window` at evaluation time |

### Policy Rules (policy.rego)

Package `xerberus_liquidity_exit`. Deny reasons:

| Deny reason | Fires when |
|---|---|
| `oracle_error` | The oracle emitted `{error}` |
| `malformed_oracle_output` | A field the rules read is missing or null (e.g. an unpriced quote) |
| `stale_data` | `deny_on_stale` and Xerberus flags the window stale |
| `data_too_old` | `data_age_seconds > max_data_age_seconds` |
| `window_not_honored` | A window was pinned and Xerberus answered from another |
| `exit_too_slow` | `days_to_exit > max_days_to_exit` |
| `impact_band_exceeded` | `impact_band_pct > max_impact_band_pct` |
| `no_exit_liquidity` | `max_sale_per_day_usd <= 0` |
| `token_not_in_intent` | `require_token_in_intent` and the token is neither the intent's target nor in its decoded arguments |

`allow` requires no error, every read field well-formed, and an empty deny set.

### Policy Parameters

| Param | Type | Description |
|---|---|---|
| `max_days_to_exit` | number | Days-to-exit ceiling. Design reference: 7 |
| `max_impact_band_pct` | number | Loosest impact band accepted. Design reference: 1 (0.5 for stablecoins) |
| `deny_on_stale` | bool | Deny when Xerberus flags the window stale |
| `max_data_age_seconds` | number | Oldest data window accepted |
| `require_token_in_intent` | bool | Bind the quoted token to the transaction |

## Notes

- **Fail closed on freshness.** A missing `is_stale` or an unparseable `data_window` leaves the output malformed, which blocks `allow`. Keep `deny_on_stale` on for exposure-increasing actions.
- **Pin the window in composites.** Pass one `window` to every `xerberus_*` pack so all results come from a single Xerberus snapshot; the composite gate denies when their `data_window`s differ.
- **Use token addresses.** Xerberus accepts symbols, but a symbol is ambiguous and cannot be matched against the intent, so `require_token_in_intent` only works with an address.
- `usd_notional` is caller-supplied. The pack cannot price calldata itself, so the curator's intent builder is responsible for passing the real notional.

## Prerequisites

```bash
newton-cli doctor
```

## Build

```bash
jco componentize ./xerberus_liquidity_exit/policy.js \
  --wit ./xerberus_liquidity_exit/newton-provider.wit \
  -n newton-provider \
  --disable http --disable random --disable fetch-event --disable stdio \
  -o ./xerberus_liquidity_exit/dist/policy.wasm
```

The `--disable` flags are mandatory — without them the WASM imports `wasi:http`, which the Newton runtime rejects. Verify with `jco print ./xerberus_liquidity_exit/dist/policy.wasm | grep wasi:http`: only the unused `(export ...)` line should appear, never an `(import ...)`.

## Simulate

```bash
newton-cli policy simulate \
  --wasm-args ./xerberus_liquidity_exit/configs/wasm_args.json \
  --intent-json ./xerberus_liquidity_exit/configs/intent.json \
  --policy-params-data ./xerberus_liquidity_exit/configs/params.json \
  --secrets-file ./xerberus_liquidity_exit/configs/secrets.json \
  --rego-file ./xerberus_liquidity_exit/policy.rego \
  --entrypoint xerberus_liquidity_exit.allow \
  --wasm-file ./xerberus_liquidity_exit/dist/policy.wasm
```

Run the Rego unit tests with OPA:

```bash
opa test ./xerberus_liquidity_exit/policy.rego ./xerberus_liquidity_exit/policy_test.rego ./xerberus_liquidity_exit/wrapping_test.rego -v
```

## Deploy

See the Quick Start in the [root README](../README.md). This pack ships a reusable **PolicyData oracle**, not a blessed `NewtonPolicy` — curators deploy their own policy (single-pack or composite) referencing the oracle address.

## Deployments

Canonical addresses live in [`deployments.json`](../deployments.json).
