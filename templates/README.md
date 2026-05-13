# {{POLICY_NAME}}

## Overview

<!-- Describe what this policy enforces -->

## Build

```bash
pnpm run build -- {{POLICY_NAME}}
```

## Simulate

```bash
# Test WASM oracle only
pnpm run simulate:wasm -- {{POLICY_NAME}}

# Test full policy (WASM + Rego)
pnpm run simulate -- {{POLICY_NAME}}

# With custom args
pnpm run simulate:wasm -- {{POLICY_NAME}} --args ./configs/my-test.json
```

## Deploy

```bash
pnpm run deploy -- {{POLICY_NAME}}
```
