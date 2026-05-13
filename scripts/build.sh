#!/usr/bin/env bash
set -euo pipefail

[[ "${1:-}" == "--" ]] && shift
NAME="${1:?Usage: pnpm run build -- <name>}"
POLICY_DIR="policies/$NAME"

if [ ! -d "$POLICY_DIR" ]; then
  echo "Error: $POLICY_DIR does not exist"
  exit 1
fi

cd "$POLICY_DIR"

npx jco componentize \
  -w newton-provider.wit \
  -o policy-files/policy.wasm \
  policy.js \
  -d stdio random clocks http fetch-event

cp policy.rego params_schema.json policy_data_metadata.json policy_metadata.json policy-files/

echo "Build complete: $POLICY_DIR/policy-files/policy.wasm"
