#!/usr/bin/env bash
set -euo pipefail

[[ "${1:-}" == "--" ]] && shift
NAME="${1:?Usage: pnpm run deploy:data -- <name>}"
POLICY_DIR="policies/$NAME"

if [ ! -f "$POLICY_DIR/policy_cids.json" ]; then
  echo "Error: $POLICY_DIR/policy_cids.json not found. Run 'pnpm run generate-cids -- $NAME' first."
  exit 1
fi

OUTPUT=$(newton-cli policy-data deploy --policy-cids "$POLICY_DIR/policy_cids.json" 2>&1)
echo "$OUTPUT"

ADDR=$(echo "$OUTPUT" | grep -oE '0x[a-fA-F0-9]{40}')
if [ -z "$ADDR" ]; then
  echo "Error: could not extract policy data address from output"
  exit 1
fi

echo "$ADDR" > "$POLICY_DIR/.policy_data_address"
echo "Policy data address saved to $POLICY_DIR/.policy_data_address"
