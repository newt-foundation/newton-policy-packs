#!/usr/bin/env bash
set -euo pipefail

[[ "${1:-}" == "--" ]] && shift
NAME="${1:?Usage: pnpm run deploy -- <name>}"

echo "=== Generating CIDs ==="
bash scripts/generate-cids.sh "$NAME"

echo ""
echo "=== Deploying policy data (WASM) ==="
bash scripts/deploy-data.sh "$NAME"

echo ""
echo "=== Deploying policy ==="
bash scripts/deploy-policy.sh "$NAME"

echo ""
echo "=== Deploy complete ==="
