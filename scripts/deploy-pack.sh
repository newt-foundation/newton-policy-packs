#!/usr/bin/env bash
# Deploy a single pack: generate-cids -> policy-data deploy -> policy deploy.
# Captures addresses to stdout and to <pack>/deployment.log.
# Fails fast on any error.

set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <pack> <rego_package>" >&2
  exit 2
fi

pack=$1
pkg=$2
log="./$pack/deployment.log"

# Run a command, append its output to $log AND stdout, preserve real exit status.
run() {
  local out
  out=$(mktemp)
  if "$@" >"$out" 2>&1; then
    cat "$out" | tee -a "$log"
    rm -f "$out"
    return 0
  else
    local rc=$?
    cat "$out" | tee -a "$log"
    rm -f "$out"
    return "$rc"
  fi
}

echo "=== $(date) :: $pack generate-cids ===" | tee -a "$log"
run newton-cli policy-files generate-cids \
  -d "./$pack/dist" \
  --entrypoint "$pkg.allow" \
  --secrets-schema-file "./$pack/secrets_schema.json" \
  -o "./$pack/dist/policy_cids.json"

echo "=== $(date) :: $pack policy-data deploy ===" | tee -a "$log"
run newton-cli policy-data deploy \
  --policy-cids "./$pack/dist/policy_cids.json"

DATA_ADDR=$(grep -Eo "Policy data deployed successfully at address: 0x[a-fA-F0-9]+" "$log" | tail -1 | awk '{print $NF}')
if [[ -z "${DATA_ADDR:-}" ]]; then
  echo "ERROR: failed to extract DATA_ADDR from $log" >&2
  exit 1
fi
echo "DATA_ADDR=$DATA_ADDR" | tee -a "$log"

echo "=== $(date) :: $pack policy deploy ===" | tee -a "$log"
run newton-cli policy deploy \
  --policy-cids "./$pack/dist/policy_cids.json" \
  --policy-data-address "$DATA_ADDR" \
  --policy-file "./$pack/policy.rego"

POLICY_ADDR=$(grep -Eo "Policy deployed successfully at address: 0x[a-fA-F0-9]+" "$log" | tail -1 | awk '{print $NF}')
if [[ -z "${POLICY_ADDR:-}" ]]; then
  echo "ERROR: failed to extract POLICY_ADDR from $log" >&2
  exit 1
fi

echo "=== $(date) :: $pack DONE ===" | tee -a "$log"
echo "$pack DATA=$DATA_ADDR POLICY=$POLICY_ADDR" | tee -a "$log"
