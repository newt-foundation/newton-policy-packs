#!/usr/bin/env bash
# Build + deploy every (or selected) policy pack. Replayable.
#
# Usage:
#   ./scripts/deploy-all.sh                    # deploy packs whose source has changed
#                                              # since the last successful snapshot
#   ./scripts/deploy-all.sh --force            # deploy all 9 packs unconditionally
#   ./scripts/deploy-all.sh --only blockaid    # deploy a single pack
#   ./scripts/deploy-all.sh blockaid webacy    # deploy a chosen subset
#   ./scripts/deploy-all.sh --env-file path    # use a different env file
#
# Sources .env.deploy.local automatically so you don't have to do it
# yourself every time. Skips packs that already have an up-to-date
# <pack>/dist/last_deploy.json (newer than policy.js / policy.rego /
# *_schema.json). On any pack failure, completed packs keep their
# snapshots — re-run to resume.
#
# Requires: jco, newton-cli on PATH; PRIVATE_KEY/RPC_URL/CHAIN_ID/PINATA_JWT
# in the env file.

set -euo pipefail

cd "$(dirname "$0")/.."

# pack:rego_package
ALL_PACKS=(
  "balancer:balancer_pool_risk"
  "blockaid:blockaid_tx_safety"
  "chainalysis:chainalysis_address_screening"
  "guardrail:guardrail_protocol_monitor"
  "persona:persona_kyc"
  "redstone:redstone_oracle_divergence"
  "sumsub:sumsub_kyc"
  "vaultsfyi:vault_risk_rating"
  "webacy:webacy_depeg_risk"
)

env_file=".env.deploy.local"
force=0
selected=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force) force=1; shift ;;
    --env-file) env_file="${2:?--env-file requires a path}"; shift 2 ;;
    --only) selected+=("$2"); shift 2 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    --*) echo "unknown flag: $1" >&2; exit 2 ;;
    *) selected+=("$1"); shift ;;
  esac
done

if [[ ! -f "$env_file" ]]; then
  echo "ERROR: env file not found: $env_file" >&2
  echo "       create it with PRIVATE_KEY, RPC_URL, CHAIN_ID, PINATA_JWT, PINATA_GATEWAY" >&2
  exit 1
fi
# shellcheck disable=SC1090
set -a; . "$env_file"; set +a

: "${PRIVATE_KEY:?PRIVATE_KEY missing from $env_file}"
: "${RPC_URL:?RPC_URL missing from $env_file}"
: "${CHAIN_ID:?CHAIN_ID missing from $env_file}"
: "${PINATA_JWT:?PINATA_JWT missing from $env_file}"

# Build the work list.
work=()
if [[ ${#selected[@]} -gt 0 ]]; then
  for name in "${selected[@]}"; do
    found=""
    for entry in "${ALL_PACKS[@]}"; do
      if [[ "${entry%%:*}" == "$name" ]]; then found="$entry"; break; fi
    done
    if [[ -z "$found" ]]; then
      echo "ERROR: unknown pack '$name'. Known: ${ALL_PACKS[*]%%:*}" >&2
      exit 2
    fi
    work+=("$found")
  done
else
  work=("${ALL_PACKS[@]}")
fi

needs_redeploy() {
  local pack=$1
  local snap="./$pack/dist/last_deploy.json"
  [[ -f "$snap" ]] || return 0
  # Any source file newer than the snapshot → redeploy.
  local src
  for src in "./$pack/policy.js" "./$pack/policy.rego" \
             "./$pack/params_schema.json" "./$pack/wasm_args_schema.json" \
             "./$pack/secrets_schema.json"; do
    [[ -f "$src" ]] || continue
    if [[ "$src" -nt "$snap" ]]; then return 0; fi
  done
  return 1
}

build_and_deploy() {
  local pack=$1 pkg=$2
  echo "==> $pack ($pkg): jco componentize"
  jco componentize "$pack/policy.js" \
    --wit "$pack/newton-provider.wit" \
    -n newton-provider \
    --disable http --disable random --disable fetch-event --disable stdio \
    -o "$pack/dist/policy.wasm"

  echo "==> $pack: deploy-pack.sh"
  ./scripts/deploy-pack.sh "$pack" "$pkg"
}

skipped=()
deployed=()
for entry in "${work[@]}"; do
  pack="${entry%%:*}"
  pkg="${entry##*:}"
  if [[ "$force" -eq 0 ]] && ! needs_redeploy "$pack"; then
    echo "==> $pack: up-to-date (last_deploy.json newer than source) — skipping"
    skipped+=("$pack")
    continue
  fi
  build_and_deploy "$pack" "$pkg"
  deployed+=("$pack")
done

echo
echo "=== summary ==="
echo "deployed: ${deployed[*]:-(none)}"
echo "skipped:  ${skipped[*]:-(none)}"
echo
echo "next: ./scripts/sync-deployments.sh --notes \"<message>\""
echo "      pnpm gen:bindings && pnpm lint:fix && pnpm -r build"
