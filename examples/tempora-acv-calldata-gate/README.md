# tempora-acv-calldata-gate

Tempora's "Step 1": the calldata-tier rules from their sequencing proposal — destination allowlist, permitted operations, absolute size backstop — enforced against Morpho VaultV2 `allocate()`/`deallocate()` calls, with **zero** oracle data and zero vendor dependency. This is the thing they wanted proven first, before anything involving Accountable: does a bundle they author actually get enforced by a gate they don't operate.

This is not a composite over any policy pack — there's no `data.wasm.*` reference in `policy.rego` at all, just `input.*`. It answers the "VaultV2 gap" from early in the thread directly: it's hand-written against VaultV2's real ABI (confirmed from `@morpho-org/blue-sdk-viem`'s exported ABI — `allocate(address adapter, bytes data, uint256 assets)` / `deallocate(address adapter, bytes data, uint256 assets)`), not the typed `shield.morpho.reallocate` helper that only covers MetaMorpho V1.1. This is exactly the generic `guardedCall`/`sendCall` path Dennis described in-thread: VaultV2 is gated today, no dedicated module required.

## What it enforces

| Deny reason | Checks | Rule class |
|---|---|---|
| `action:not_allocate_or_deallocate` | `decoded_function_signature` is exactly `allocate(address,bytes,uint256)` or `deallocate(address,bytes,uint256)` | Permitted operations |
| `action:wrong_target` | `input.to` equals the bound VaultV2 vault | (Shield is deployed per-(curator, vault) already; this is a defense-in-depth check) |
| `action:adapter_not_allowlisted` | `decoded_function_arguments[0]` (the `adapter`) is in `allowed_leaves` | Destination allowlist |
| `action:assets_over_max` | `decoded_function_arguments[2]` (the `assets`) is ≤ `max_assets_per_call` | Absolute size backstop |

`allow` is fail-closed the same way every other policy in this repo is: it requires `input.to`/`decoded_function_signature`/`decoded_function_arguments` to be well-typed *and* the arguments array to have exactly 3 elements (an allocate/deallocate call always does) before checking any deny condition — a truncated or malformed decode denies instead of silently skipping the adapter/size checks. See `test_deny_on_truncated_args`.

## Placeholder data — replace before use

- `target_vault` — set to the feeder vault-of-vaults Tempora shared in-thread (`0xD65AB9B277b65AC077B83352C0b45FeA18973DD9`, Base). Confirm this is the actual vault to bind before deploying.
- `allowed_leaves` — copied verbatim from the `.rego` Kevin shared on 8/6 (their hardcoded investable universe). This is *their* example data, not a Newton recommendation.
- `max_assets_per_call` — a placeholder value. Set to the mandate's real cap.

## Why these are Rego constants, not on-chain params

This gate has no oracle module in its composite manifest — there's nothing to fetch, which is the whole point of Step 1. Per `manage-yield-source-gate`'s precedent elsewhere in this repo ("composite params are bijective with the oracle module set"), a zero-module composite has no params slot to read either. So `target_vault`, `allowed_leaves`, and `max_assets_per_call` are baked into the Rego source — changing any of them means redeploying this policy, the same tradeoff `manage-yield-source-gate` already ships with for its own `target_vault` constant.

## Known limitation

The size-backstop comparison uses Rego's `to_number()`, which is float64. That loses precision above ~9.007e15 base units (e.g. beyond ~9B tokens at 6 decimals). Fine for a backstop at any realistic vault size; would need a bigint-safe (chunked string) comparison if this is ever bound to a vault with caps near that range.

## Test

```bash
opa test policy.rego policy_test.rego -v
# PASS: 12/12
```
