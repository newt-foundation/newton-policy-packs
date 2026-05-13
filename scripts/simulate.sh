#!/usr/bin/env bash
set -euo pipefail

[[ "${1:-}" == "--" ]] && shift
NAME="${1:?Usage: pnpm run simulate -- <name> [--args <path>]}"
shift
POLICY_DIR="policies/$NAME"

if [ ! -f "$POLICY_DIR/policy-files/policy.wasm" ]; then
  echo "Error: $POLICY_DIR/policy-files/policy.wasm not found. Run 'pnpm run build -- $NAME' first."
  exit 1
fi

if [ ! -f "$POLICY_DIR/policy-files/policy.rego" ]; then
  echo "Error: $POLICY_DIR/policy-files/policy.rego not found. Run 'pnpm run build -- $NAME' first."
  exit 1
fi

WASM_ARGS=""
INTENT=""
POLICY_PARAMS=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --args)
      WASM_ARGS="$2"
      shift 2
      ;;
    --intent)
      INTENT="$2"
      shift 2
      ;;
    --params)
      POLICY_PARAMS="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

PACKAGE_NAME=$(grep -m1 '^package ' "$POLICY_DIR/policy.rego" | awk '{print $2}')
ENTRYPOINT="${PACKAGE_NAME}.allow"

WASM_ARGS_FLAG=""
if [ -n "$WASM_ARGS" ]; then
  WASM_ARGS_FLAG="--wasm-args $WASM_ARGS"
fi

INTENT_FLAG=""
if [ -n "$INTENT" ]; then
  INTENT_FLAG="--intent-json $INTENT"
fi

POLICY_PARAMS_FLAG=""
if [ -n "$POLICY_PARAMS" ]; then
  POLICY_PARAMS_FLAG="--policy-params-data $POLICY_PARAMS"
fi

echo "Entrypoint: $ENTRYPOINT"

newton-cli policy simulate \
  --wasm-file "$POLICY_DIR/policy-files/policy.wasm" \
  --rego-file "$POLICY_DIR/policy-files/policy.rego" \
  --entrypoint "$ENTRYPOINT" \
  ${INTENT_FLAG} \
  ${WASM_ARGS_FLAG} \
  ${POLICY_PARAMS_FLAG}
