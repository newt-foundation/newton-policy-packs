# pharos_safe_mode

## Overview

This policy is a **graduated response** to stablecoin stress, using [Pharos](https://pharos.watch). When stress rises or a depeg goes active, it stops actions that *increase* exposure while leaving the exits open:

- **Blocked** in safe mode: deposits, mints, and other exposure-increasing calls.
- **Always permitted**: withdrawals, redemptions, repayments.
- **Conditionally permitted**: swaps, but only into a curator-approved safer asset.

That is the point — an application gets a graduated response instead of a blunt protocol-wide pause.

Requires a Pharos API key (`PHAROS_API_KEY`).

## How it works

### Data Oracle (policy.js)

Three GET requests against `https://api.pharos.watch`, authenticated with the `X-API-Key` header:

1. `/api/stress-signals?stablecoin={id}&days={n}` — stress score, band, active signals.
2. `/api/depeg-events?stablecoin={id}&active=true&includePending=true` — active incidents.
3. `/api/mint-burn-flows?stablecoin={id}&hours={n}` — flow-anomaly context.

| Field | Description |
|---|---|
| `stablecoin_id` / `symbol` | Asset identity |
| `stress_score` / `stress_band` | From `current.score` / `current.band` (lowercased) |
| `stress_signals` | Raw `{name: 0-100}` map from `current.signals`, skipping unavailable ones |
| `active_indicators` | Convenience view of signals at or above 50. No rule depends on it |
| `age_classification` | Pharos's own freshness label (e.g. `fresh`) |
| `depeg_active` / `depeg_severity` / `peg_deviation_bps` | Active incident state |
| `net_flow_usd` / `mint_volume_usd` / `burn_volume_usd` | Mint/burn flow |
| `flow_stress_score` / `burn_surge` | From the stress `flow` signal, which already folds burn surge and burn/mint ratio against a baseline |
| `flow_anomaly` | True when `flow_stress_score` is at or above 50 |
| `data_age_seconds` | Oldest age across all three responses |
| `timestamp` | When this snapshot was taken |

### Policy Rules (policy.rego)

Package `pharos_safe_mode`. **This is the only pack in the repo that reads the attested intent.** A graduated response has to know whether the caller is adding exposure or shedding it, and that fact must come from the signed intent rather than from anything the oracle asserts.

The classifier is `input.function.name` — the bare function name, verified against newton-cli 0.5.2. The full `input` shape is:

```json
{
  "from": "0x...", "to": "0x...", "value": "1000000000000000000",
  "chain_id": "1",
  "data": "0xb460af94...",
  "function_signature": "0x7769746864726177...",
  "function": { "name": "withdraw", "type": "function",
                "stateMutability": "nonpayable", "inputs": [...], "outputs": [] },
  "decoded_function_signature": "function withdraw(uint256, address, address)",
  "decoded_function_arguments": ["1000000000000000000", "0x...", "0x..."]
}
```

Safe mode engages when a depeg is active (and `safe_mode_on_active_depeg` is set) **or** stress reaches `safe_mode_stress_threshold`.

The param is named `safe_mode_on_active_depeg`, not `deny_on_active_depeg`, because that is what it does: a depeg **engages safe mode**, it does not deny outright. Exposure-reducing calls stay permitted throughout — that is the graduated response this pack exists for. If you want a depeg to stop everything, the `pharos_treasury` pack's `deny_on_active_depeg` is the blunt instrument; the two are deliberately named apart.

| Deny reason | Condition | What it catches |
|---|---|---|
| `unclassified_function` | the function is in none of the three lists | A novel call that would otherwise sail past every rule |
| `safe_mode_blocks_exposure_increase` | safe mode and an exposure-increasing call | Adding exposure to a stressed asset |
| `unapproved_swap_destination` | safe mode, a swap, destination not approved | Rotating out of a stressed asset into another risky one |
| `stale_data` | age over `max_data_age_seconds` | Decisions made on stale data |
| `missing_<field>` | `deny_on_missing_data` and the oracle reported that field as `null` | A stress threshold quietly doing nothing because Pharos never reported a score |

`deny` is the single source of truth for every rule above, and `allow` consumes it: `not v.error`, the `is_boolean(v.depeg_active)` / `is_string(fn)` groundedness probes, then `count(deny) == 0`. The probes are load-bearing rather than decorative — every deny rule silent-skips on an undefined field, so an error envelope produces an **empty** deny set, and a bare `count(deny) == 0` would **fail open** on exactly the payload that most needs to fail closed. There is deliberately no parallel set of positive helper rules restating the deny conditions; that duplication is how the two drift apart.

Note what is deliberately **absent**: there is no blanket stress ceiling that denies everything. Withdrawals and redemptions stay permitted at any stress level.

### Policy Parameters

| Param | Type | Description |
|---|---|---|
| `safe_mode_stress_threshold` | `number` | Stress score at or above which safe mode engages |
| `safe_mode_on_active_depeg` | `boolean` | Let an active depeg engage safe mode on its own. Engages safe mode — does **not** deny outright |
| `exposure_increasing_functions` | `string[]` | Bare names blocked in safe mode (e.g. `deposit`, `mint`) |
| `exposure_reducing_functions` | `string[]` | Bare names always permitted (e.g. `withdraw`, `redeem`) |
| `swap_functions` | `string[]` | Bare names treated as swaps |
| `swap_destination_arg_index` | `number` | Index into `decoded_function_arguments` holding the destination token |
| `approved_safe_assets` | `string[]` | Token addresses acceptable as swap destinations |
| `max_data_age_seconds` | `number` | Freshness ceiling |
| `deny_on_missing_data` | `boolean` | Treat an unreported (`null`) `stress_score` or age as a deny rather than a pass |

## Notes

- **Unclassified functions deny, always** — including in a calm market. The three function lists are an allowlist, not a safe-mode-only concern. Enumerate every function your vault actually calls.
- **An out-of-range `swap_destination_arg_index` fails closed.** The destination is left undefined, which denies rather than reading as approved.
- Swap destinations are compared **case-insensitively**: the intent lowercases addresses while curator params are typically checksummed.
- `null` is the oracle's "not reported", deliberately distinct from `0`. Null optional fields fail-soft; a **missing** key leaves the groundedness checks undefined and correctly blocks `allow`.
- **`deny_on_missing_data` turns that fail-soft into a deny** for a null `stress_score` or `data_age_seconds`. Worth turning on if you rely on `safe_mode_stress_threshold`: without a score, safe mode can only ever engage via the depeg branch.
- `input.chain_id` arrives as a *string* and is only populated when the intent JSON sets `chainId` (camelCase in, snake_case out). The `--chain-id` CLI flag does **not** populate it, so no rule here depends on it.

- **`/api/mint-burn-flows` carries no anomaly flag of its own.** Pharos's judgement of flow abnormality lives in the stress `flow` signal, so the oracle uses that rather than inventing a threshold over raw mint/burn volumes.
- Stress data is nested under `current` (`current.score`, `current.band`, `current.signals`) — not at the top level.
- This is the lightest Pharos pack: all three endpoints filter by `stablecoin`, totalling roughly 11 KB per evaluation.

## Prerequisites

```bash
newton-cli doctor
```

## Build

```bash
jco componentize ./pharos_safe_mode/policy.js \
  --wit ./pharos_safe_mode/newton-provider.wit \
  -n newton-provider \
  --disable http --disable random --disable fetch-event --disable stdio \
  -o ./pharos_safe_mode/dist/policy.wasm
```

The `--disable` flags are mandatory — without them the WASM imports `wasi:http`, which the Newton runtime rejects. Verify with `jco print ./pharos_safe_mode/dist/policy.wasm | grep wasi:http`: only the unused `(export ...)` line should appear, never an `(import ...)`.

## Simulate

```bash
newton-cli policy simulate \
  --wasm-args ./pharos_safe_mode/configs/wasm_args.json \
  --intent-json ./pharos_safe_mode/configs/intent.json \
  --policy-params-data ./pharos_safe_mode/configs/params.json \
  --secrets-file ./pharos_safe_mode/configs/secrets.json \
  --rego-file ./pharos_safe_mode/policy.rego \
  --entrypoint pharos_safe_mode.allow \
  --wasm-file ./pharos_safe_mode/dist/policy.wasm
```

Run the Rego unit tests with OPA:

```bash
opa test ./pharos_safe_mode/policy.rego ./pharos_safe_mode/policy_test.rego ./pharos_safe_mode/wrapping_test.rego -v
```

## Deploy

See the Quick Start in the [root README](../README.md). This pack ships a reusable **PolicyData oracle**, not a blessed `NewtonPolicy` — curators deploy their own policy (single-pack or composite) referencing the oracle address.

## Deployments

Canonical addresses live in [`deployments.json`](../deployments.json).
