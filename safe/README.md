# safe

## Overview

This policy gates execution on a [Safe](https://safe.global/) (formerly Gnosis Safe) multisig's **on-chain configuration**. A Safe's security rests entirely on two numbers — how many signatures it requires (`threshold`) and how many owners can produce them (`getOwners().length`) — and both are mutable at runtime by the owners themselves via `changeThreshold`, `addOwnerWithThreshold`, `removeOwner`, and `swapOwner`. A Safe that was 3-of-5 when a vault was funded can be 1-of-1 by the time a withdrawal is signed.

The WASM oracle reads `getThreshold()` and `getOwners()` straight from the Safe contract over JSON-RPC and reports the threshold, the owner count, and the address it actually read. The Rego policy denies unless the Safe is the one the wallet owner bound the policy to and its configuration sits inside the configured bounds.

Use cases:
- Vault operations that must be authorized by a multisig, not a hot key
- Treasury flows requiring an M-of-N floor that survives owner churn
- Detecting a "threshold downgrade" attack before the downgraded Safe gets used
- Catching an owner set that has grown past what governance approved

Contract read: [`Safe.sol`](https://github.com/safe-fndn/safe-smart-account/blob/main/contracts/Safe.sol) (the accessors come from `OwnerManager.sol`, which `Safe.sol` inherits).

## How it works

### Data Oracle (policy.js)

Two `eth_call`s, no third-party API:

| Call | Selector | Decoded as |
|------|----------|-----------|
| `getThreshold()` | `0xe75235b8` | `uint256` → `threshold` |
| `getOwners()` | `0xa0e67e2b` | `address[]` element count → `owner_count` |

The `address[]` decoder validates the ABI offset word and that the payload actually carries `length * 32` bytes, so a truncated or malformed response errors rather than reporting a bogus owner count. An EOA or non-Safe contract returns `0x` from `eth_call` on most nodes, which is also treated as an error.

Output (wrapped under the `safe` key by `wrapOutput`):

| Field | Description |
|-------|-------------|
| `safe_address` | The address actually read, lowercased |
| `chain_id` | Chain the read was performed against |
| `threshold` | Signatures the Safe requires to execute |
| `owner_count` | Number of owners (signers) currently on the Safe |
| `error` | Present *instead of* the fields above when the read failed (bad address, RPC failure, not a Safe) |

### Policy Rules (policy.rego)

Package: `safe_signer_threshold` — entrypoint `safe_signer_threshold.allow`.

| Deny Reason | Condition | What it catches |
|-------------|-----------|-----------------|
| `oracle_error` | `v.error` present | Safe unreadable — fail closed |
| `safe_address_mismatch` | `lower(v.safe_address) != lower(t.safe_address)` | `wasm_args` pointed at a *different*, well-configured Safe |
| `threshold_below_minimum` | `threshold < min_threshold` | Threshold downgrade |
| `owners_below_minimum` | `owner_count < min_owners` | Owner set shrunk below the approved floor |
| `owners_above_maximum` | `owner_count > max_owners` | Owner set grown past the approved ceiling |

`allow` re-asserts every field positively (`not v.error`, `is_number(v.threshold)`, …) rather than resting on `count(deny) == 0`. The deny rules all bottom out in comparisons that silent-skip on an undefined field, so an empty or malformed pack slot would otherwise fail *open*.

The address comparison is case-insensitive on both sides: the oracle lowercases what it read, and `params.safe_address` may hold a checksummed address.

### Policy Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `safe_address` | string | The Safe this policy is bound to (0x-prefixed, any casing) |
| `min_threshold` | number | Minimum required signatures (e.g. `2`) |
| `min_owners` | number | Minimum owner count (e.g. `3`) |
| `max_owners` | number | Maximum owner count (e.g. `5`) |

### WASM args (per evaluation)

| Field | Type | Description |
|-------|------|-------------|
| `safeAddress` | string | Safe contract address to read (required) |
| `chainId` | integer | `11155111` (Ethereum Sepolia) or `84532` (Base Sepolia) |
| `chain` | string | Optional alias for `chainId`: `eth-sepolia`, `ethereum-sepolia`, `sepolia`, `base-sepolia`. Only consulted when `chainId` is omitted |

### Secrets

The RPC endpoints are **policy secrets**, not `wasm_args`, so the endpoint (and any API key embedded in its path) never appears in the AVS-visible task payload. The chain selected by `chainId` picks which one is used.

| Secret | Description |
|--------|-------------|
| `ETH_SEPOLIA_RPC_URL` | JSON-RPC endpoint for chain `11155111` |
| `BASE_SEPOLIA_RPC_URL` | JSON-RPC endpoint for chain `84532` |

For local simulation the secret can instead be passed inline in `wasm_args` — `policy.js` seeds `_secrets` from the parsed args before overlaying host secrets, so an uploaded host secret always wins.

## Prerequisites

```bash
newton-cli doctor
```

## Build

```bash
jco componentize ./safe/policy.js \
  --wit ./safe/newton-provider.wit \
  -n newton-provider \
  --disable http --disable random --disable fetch-event --disable stdio \
  -o ./safe/dist/policy.wasm
```

The `--disable` flags are mandatory: the `jco` defaults pull in `wasi:http`, which the Newton runtime's linker rejects. Verify with:

```bash
jco print ./safe/dist/policy.wasm | grep wasi:http
```

Only the unused `(export "wasi:http/incoming-handler@0.2.10#handle" ...)` line should appear — never an `(import "wasi:http/...")`.

## Test

```bash
opa test ./safe/policy.rego ./safe/policy_test.rego ./safe/wrapping_test.rego -v
```

## Simulate

```bash
newton-cli policy simulate \
  --wasm-args ./safe/configs/wasm_args.json \
  --intent-json ./safe/configs/intent.json \
  --policy-params-data ./safe/configs/params.json \
  --policy-file ./safe/policy.rego \
  --wasm-file ./safe/dist/policy.wasm
```

## Deploy

Not yet deployed. See the deploy steps in [CLAUDE.md](../CLAUDE.md) and the post-deploy lifecycle (policy-client registration + encrypted secrets upload) in [OPERATING.md](../OPERATING.md).
