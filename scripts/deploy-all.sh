#!/usr/bin/env bash
# Build + deploy every (or selected) policy pack. Replayable.
#
# Usage:
#   ./scripts/deploy-all.sh --env <stagef|prod> --chain <chainId>
#       deploy packs whose source has changed since the last successful
#       snapshot for the (chain, env) cell.
#   --force                deploy all 9 packs unconditionally.
#   --only <pack>          deploy a single pack (repeatable).
#   <pack> <pack> …        deploy a chosen subset by name.
#   --env-file <path>      override the auto-resolved env file.
#
# Cell selection:
#   --env <stagef|prod>    selects the AVS environment. Resolves to
#                          `.env.deploy.local.<env>` unless --env-file
#                          is given. Required. Single source of truth —
#                          env files do NOT carry their own DEPLOYMENT_ENV.
#   --chain <chainId>      selects the chain. Decimal id, e.g. 11155111.
#                          The env file must define RPC_URL_<chainId>;
#                          deploy-all.sh exports it as RPC_URL for the
#                          downstream newton-cli invocations. Required.
#                          Mainnet chain ids (1, 8453) are blocked unless
#                          --allow-mainnet AND NEWTON_ALLOW_MAINNET_DEPLOY=1.
#
# Skips packs that already have an up-to-date <pack>/dist/last_deploy.json
# (newer than policy.js / policy.rego / *_schema.json). On any pack
# failure, completed packs keep their snapshots — re-run to resume.
#
# WASM componentize is idempotent: <pack>/dist/policy.wasm is produced
# once per session and reused across cell deploys. That keeps Pinata's
# content-addressed wasmCid stable across (chainId, env) cells, which
# Phase 1.5's composite manifest verification relies on. Pass
# --force-componentize to rebuild even if the artifact exists.
#
# Requires: jco, newton-cli on PATH; PRIVATE_KEY, PINATA_JWT,
# PINATA_GATEWAY, RPC_URL_<chainId> in the env file.

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

env=""
env_set=0
chain_id=""
chain_set=0
env_file=""
force=0
force_componentize=0
allow_mainnet=0
selected=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)
      [[ "$env_set" -eq 1 ]] && { echo "ERROR: --env passed more than once" >&2; exit 2; }
      env="${2:?--env requires a value (stagef|prod)}"; env_set=1; shift 2 ;;
    --chain)
      [[ "$chain_set" -eq 1 ]] && { echo "ERROR: --chain passed more than once" >&2; exit 2; }
      chain_id="${2:?--chain requires a chainId}"; chain_set=1; shift 2 ;;
    --force) force=1; shift ;;
    --force-componentize) force_componentize=1; shift ;;
    --allow-mainnet) allow_mainnet=1; shift ;;
    --env-file) env_file="${2:?--env-file requires a path}"; shift 2 ;;
    --only) selected+=("$2"); shift 2 ;;
    -h|--help) sed -n '2,32p' "$0"; exit 0 ;;
    --*) echo "unknown flag: $1" >&2; exit 2 ;;
    *) selected+=("$1"); shift ;;
  esac
done

if [[ -z "$env" ]]; then
  echo "ERROR: --env is required (stagef|prod)" >&2
  exit 2
fi
if [[ "$env" != "stagef" && "$env" != "prod" ]]; then
  echo "ERROR: --env must be 'stagef' or 'prod', got: $env" >&2
  exit 2
fi
if [[ -z "$chain_id" ]]; then
  echo "ERROR: --chain <chainId> is required (decimal, e.g. 11155111)" >&2
  exit 2
fi
if ! [[ "$chain_id" =~ ^[0-9]+$ ]]; then
  echo "ERROR: --chain must be a decimal chainId, got: $chain_id" >&2
  exit 2
fi

# Mainnet deploy gate. Pre-audit, both Ethereum mainnet (1) and Base
# mainnet (8453) are off-limits. The Shield contract is non-upgradeable
# and any mainnet deploy is irreversible, so failing closed here is the
# only safe default. Both --allow-mainnet AND NEWTON_ALLOW_MAINNET_DEPLOY=1
# are required — neither alone is sufficient (defence in depth against
# stray flag/env mistakes).
case "$chain_id" in
  1|8453)
    if [[ "$allow_mainnet" -ne 1 || "${NEWTON_ALLOW_MAINNET_DEPLOY:-}" != "1" ]]; then
      echo "ERROR: chain $chain_id is mainnet — refusing to deploy without --allow-mainnet AND NEWTON_ALLOW_MAINNET_DEPLOY=1" >&2
      echo "       Mainnet deploys are gated on the Shield audit (NEWT-1419) clearing. Until then, only testnets (11155111, 84532) are allowed." >&2
      exit 2
    fi
    echo "WARNING: deploying to mainnet (chain $chain_id). Press Ctrl+C in the next 5 seconds to abort." >&2
    sleep 5
    ;;
esac

if [[ -z "$env_file" ]]; then
  env_file=".env.deploy.local.$env"
fi
if [[ ! -f "$env_file" ]]; then
  echo "ERROR: env file not found: $env_file" >&2
  echo "       create it from .env.$env (PRIVATE_KEY, PINATA_JWT, PINATA_GATEWAY, RPC_URL_<chainId>)" >&2
  exit 1
fi
# shellcheck disable=SC1090
set -a; . "$env_file"; set +a

# Resolve RPC_URL from RPC_URL_<chainId>. Indirect expansion (`!var`) lets
# a single env file hold endpoints for every supported chain without
# duplicating secrets across one file per (chain, env).
rpc_var="RPC_URL_${chain_id}"
RPC_URL="${!rpc_var:-}"
if [[ -z "$RPC_URL" ]]; then
  echo "ERROR: $rpc_var missing from $env_file" >&2
  echo "       add a line: $rpc_var=https://… for chain $chain_id" >&2
  exit 1
fi
export RPC_URL
export CHAIN_ID="$chain_id"

# DEPLOYMENT_ENV is derived solely from --env. The env file does NOT
# carry its own DEPLOYMENT_ENV value — single source of truth eliminates
# the "file says stagef, flag says prod" footgun. newton-cli reads
# DEPLOYMENT_ENV from process env to resolve the right
# script/deployments/policy/{chainId}-{env}.json factory address.
export DEPLOYMENT_ENV="$env"

: "${PRIVATE_KEY:?PRIVATE_KEY missing from $env_file}"
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
  local wasm="$pack/dist/policy.wasm"
  local wasm_stale=0

  # WASM is stale if it doesn't exist OR policy.js / newton-provider.wit is
  # newer than it. jco componentize is non-deterministic across invocations
  # (timestamps + version metadata embed into the binary), so re-running it
  # produces a different IPFS CID for byte-identical source. Caching the
  # artifact keeps the wasmCid stable across (chainId, env) cells.
  if [[ ! -f "$wasm" ]]; then
    wasm_stale=1
  elif [[ "$pack/policy.js" -nt "$wasm" || "$pack/newton-provider.wit" -nt "$wasm" ]]; then
    wasm_stale=1
  fi

  if [[ "$wasm_stale" -eq 1 || "$force_componentize" -eq 1 ]]; then
    echo "==> $pack ($pkg): jco componentize"
    jco componentize "$pack/policy.js" \
      --wit "$pack/newton-provider.wit" \
      -n newton-provider \
      --disable http --disable random --disable fetch-event --disable stdio \
      -o "$wasm"
  else
    echo "==> $pack ($pkg): policy.wasm is up-to-date — reusing for stable wasmCid"
  fi

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
