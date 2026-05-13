#!/usr/bin/env bash
set -euo pipefail

[[ "${1:-}" == "--" ]] && shift
NAME="${1:?Usage: pnpm run simulate:wasm -- <name> [--args <path>]}"
shift
POLICY_DIR="policies/$NAME"

if [ ! -f "$POLICY_DIR/policy-files/policy.wasm" ]; then
  echo "Error: $POLICY_DIR/policy-files/policy.wasm not found. Run 'pnpm run build -- $NAME' first."
  exit 1
fi

INPUT_JSON='{}'

while [[ $# -gt 0 ]]; do
  case $1 in
    --args)
      INPUT_JSON=$(cat "$2")
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

newton-cli policy-data simulate \
  --wasm-file "$POLICY_DIR/policy-files/policy.wasm" \
  --input-json "$INPUT_JSON"
