#!/usr/bin/env bash
set -euo pipefail

[[ "${1:-}" == "--" ]] && shift
NAME="${1:?Usage: pnpm run deploy:policy -- <name>}"
POLICY_DIR="policies/$NAME"

if [ ! -f "$POLICY_DIR/.policy_data_address" ]; then
  echo "Error: $POLICY_DIR/.policy_data_address not found. Run 'pnpm run deploy:data -- $NAME' first."
  exit 1
fi

if [ ! -f "$POLICY_DIR/policy_cids.json" ]; then
  echo "Error: $POLICY_DIR/policy_cids.json not found. Run 'pnpm run generate-cids -- $NAME' first."
  exit 1
fi

POLICY_DATA_ADDR=$(cat "$POLICY_DIR/.policy_data_address")

newton-cli policy deploy \
  --policy-cids "$POLICY_DIR/policy_cids.json" \
  --policy-data-address "$POLICY_DATA_ADDR"
