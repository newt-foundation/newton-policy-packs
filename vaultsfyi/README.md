# vaultsfyi

## Overview

<!-- Describe what this policy enforces -->

## Prerequisites

```bash
newton-cli doctor
```

## Build

```bash
newton-cli policy build -p ./vaultsfyi
```

## Simulate

```bash
# Test full policy (WASM + Rego)
newton-cli policy simulate -p ./vaultsfyi

# With custom args
newton-cli policy simulate -p ./vaultsfyi --wasm-args ./configs/wasm_args.json --intent-json ./configs/intent.json --policy-params-data ./configs/params.json
```

## Deploy

```bash
newton-cli policy deploy -p ./vaultsfyi
```
