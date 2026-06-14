#!/usr/bin/env bash
# Deploy a single pack: sync source -> dist, generate-cids -> policy-data deploy -> policy deploy.
# Captures addresses to stdout, to <pack>/deployment.log, and to <pack>/dist/last_deploy.json.
# Fails fast on any error.
#
# Normally invoked by deploy-all.sh, which resolves PRIVATE_KEY,
# PINATA_JWT, CHAIN_ID, and RPC_URL from .env.deploy.local.<env> +
# the --chain flag. Direct invocation requires the same env vars to
# be exported by the caller.

set -euo pipefail

: "${PRIVATE_KEY:?PRIVATE_KEY env var required (export from ~/.newton/newton-cli.toml)}"
: "${RPC_URL:?RPC_URL env var required}"
: "${CHAIN_ID:?CHAIN_ID env var required}"
: "${PINATA_JWT:?PINATA_JWT env var required (otherwise IPFS uploads silently fall back to the rate-limited Newton proxy)}"

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <pack> <rego_package>" >&2
  exit 2
fi

pack=$1
pkg=$2
log="./$pack/deployment.log"

LAST_RUN_OUT=""
cleanup() {
  if [[ -n "${LAST_RUN_OUT:-}" && -f "$LAST_RUN_OUT" ]]; then
    rm -f "$LAST_RUN_OUT"
  fi
}
trap cleanup EXIT

# Run a command. Tees output to $log AND stdout. Leaves the per-invocation
# output in $LAST_RUN_OUT so callers can grep that, not the cumulative log.
run() {
  if [[ -n "${LAST_RUN_OUT:-}" && -f "$LAST_RUN_OUT" ]]; then
    rm -f "$LAST_RUN_OUT"
  fi
  LAST_RUN_OUT=$(mktemp)
  local rc=0
  "$@" >"$LAST_RUN_OUT" 2>&1 || rc=$?
  cat "$LAST_RUN_OUT" | tee -a "$log"
  return "$rc"
}

echo "=== $(date) :: $pack sync source policy.rego -> dist ===" | tee -a "$log"
mkdir -p "./$pack/dist"
cp -f "./$pack/policy.rego" "./$pack/dist/policy.rego"

echo "=== $(date) :: $pack generate-cids ===" | tee -a "$log"
run newton-cli policy-files generate-cids \
  -d "./$pack/dist" \
  --entrypoint "$pkg.allow" \
  --secrets-schema-file "./$pack/secrets_schema.json" \
  -o "./$pack/dist/policy_cids.json"

echo "=== $(date) :: $pack policy-data deploy ===" | tee -a "$log"
run newton-cli policy-data deploy \
  --policy-cids "./$pack/dist/policy_cids.json"

DATA_ADDR=$(grep -Eo "Policy data deployed successfully at address: 0x[a-fA-F0-9]+" "$LAST_RUN_OUT" | awk '{print $NF}')
if [[ -z "${DATA_ADDR:-}" ]]; then
  echo "ERROR: failed to extract DATA_ADDR from current invocation output" >&2
  exit 1
fi
echo "DATA_ADDR=$DATA_ADDR" | tee -a "$log"

echo "=== $(date) :: $pack policy deploy ===" | tee -a "$log"
run newton-cli policy deploy \
  --policy-cids "./$pack/dist/policy_cids.json" \
  --policy-data-address "$DATA_ADDR" \
  --policy-file "./$pack/policy.rego"

POLICY_ADDR=$(grep -Eo "Policy deployed successfully at address: 0x[a-fA-F0-9]+" "$LAST_RUN_OUT" | awk '{print $NF}')
if [[ -z "${POLICY_ADDR:-}" ]]; then
  echo "ERROR: failed to extract POLICY_ADDR from current invocation output" >&2
  exit 1
fi

echo "=== $(date) :: $pack DONE ===" | tee -a "$log"
echo "$pack DATA=$DATA_ADDR POLICY=$POLICY_ADDR" | tee -a "$log"

# Emit a machine-readable snapshot so sync-deployments.sh can rebuild
# deployments.json without re-running deploys.
deployed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
git_commit=$(git rev-parse HEAD 2>/dev/null || echo "")
snapshot="./$pack/dist/last_deploy.json"
node - "$pack" "$pkg" "$CHAIN_ID" "$POLICY_ADDR" "$DATA_ADDR" \
  "./$pack/dist/policy_cids.json" "$deployed_at" "$git_commit" "$snapshot" <<'NODE'
const fs = require("fs");
const [pack, pkg, chainId, policy, policyData, cidsPath, deployedAt, txCommit, out] = process.argv.slice(2);
const cids = JSON.parse(fs.readFileSync(cidsPath, "utf8"));
const snap = { pack, package: pkg, chainId, policy, policyData, policyCids: cids, deployedAt, txCommit };
fs.writeFileSync(out, JSON.stringify(snap, null, 2) + "\n");
NODE
echo "wrote $snapshot" | tee -a "$log"
