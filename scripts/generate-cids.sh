#!/usr/bin/env bash
set -euo pipefail

[[ "${1:-}" == "--" ]] && shift
NAME="${1:?Usage: pnpm run generate-cids -- <name>}"
POLICY_DIR="policies/$NAME"

if [ ! -d "$POLICY_DIR/policy-files" ]; then
  echo "Error: $POLICY_DIR/policy-files does not exist. Run 'pnpm run build -- $NAME' first."
  exit 1
fi

PACKAGE_NAME=$(grep -m1 '^package ' "$POLICY_DIR/policy.rego" | awk '{print $2}')
ENTRYPOINT="${PACKAGE_NAME}.allow"

newton-cli policy-files generate-cids \
  --directory "$POLICY_DIR/policy-files" \
  --output "$POLICY_DIR/policy_cids.json" \
  --entrypoint "$ENTRYPOINT"

echo "CIDs written to $POLICY_DIR/policy_cids.json"
