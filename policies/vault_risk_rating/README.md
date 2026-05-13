# vault_risk_rating

## Overview

<!-- Describe what this policy enforces -->

## Build

```bash
pnpm run build -- vault_risk_rating
```

## Simulate

```bash
# Test WASM oracle only
pnpm run simulate:wasm -- vault_risk_rating

# Test full policy (WASM + Rego)
pnpm run simulate -- vault_risk_rating

# With custom args
pnpm run simulate:wasm -- vault_risk_rating --args ./configs/my-test.json
```

## Deploy

```bash
pnpm run deploy -- vault_risk_rating
```
