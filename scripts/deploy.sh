#!/usr/bin/env bash
# Deploy a single pack on-chain to a specific (chainId, env) cell.
# Reads the existing <pack>/dist/policy_cids.json (written by upload.sh).
# Runs newton-cli policy-data deploy (the reusable oracle only — a pack does
# NOT deploy a blessed single-pack NewtonPolicy; curators deploy their own
# from the reference policy.rego). Writes <pack>/dist/last_deploy.json snapshot.
#
# Usage:
#   pnpm run deploy <pack> --env <stagef|prod> --chain <chainId>
#   pnpm run deploy <pack> --env prod --chain 1 --allow-mainnet      # gated
#   pnpm run deploy <pack> --env-file <path>                         # env override
#   pnpm run deploy <pack> --env stagef --chain 11155111 --expire-after-blocks 100
#       # break a CREATE2 collision without re-rolling WASM bytes:
#       # `expireAfter` is part of the PolicyData CREATE2 salt
#       # (newton-prover-avs/contracts/src/core/NewtonPolicyDataFactory.sol:131),
#       # so passing a session-unique value moves the predicted target away
#       # from on-chain orphans claimed by prior sessions while keeping
#       # wasmCid stable across cells (frozen rule 7).
#       #
#       # Pick a value that gives 10-30 minutes of TaskResponse validity on
#       # the target chain — long enough to actually use, short enough not
#       # to leave a long-lived attestation window. Per-chain block times:
#       #   - Sepolia (11155111):     ~12s/block → 10 min = 50, 30 min = 150
#       #   - Base Sepolia (84532):    ~2s/block → 10 min = 300, 30 min = 900
#       # `expireAfter` is uint32 (max 4294967295). Each cell uses its own
#       # factory, so the same value on different chains lands at different
#       # CREATE2 addresses — no cross-chain coordination needed.
#
# Run ONCE per (pack, chainId, env) cell. Prerequisites:
#   1. `pnpm run upload <pack>` has been run earlier in the session, so
#      <pack>/dist/policy_cids.json exists.
#   2. .env.deploy.local.<env> exists with PRIVATE_KEY, RPC_URL_<chainId>.
#
# The script does NOT run jco componentize OR generate-cids. Those are
# upload.sh's responsibility, run once per pack across all 4 cells. This
# split keeps wasmCid stable per pack across cells (frozen rule 7).
#
# Mainnet gate (frozen rule 6): chain ids 1 (Ethereum) and 8453 (Base) are
# refused unless --allow-mainnet is passed AND NEWTON_ALLOW_MAINNET_DEPLOY=1
# AND NEWTON_ALLOW_MAINNET_DEPLOY_FLAG=1. Three distinct signals, defense
# in depth across CLI flag and two env vars.

set -euo pipefail

cd "$(dirname "$0")/.."

# shellcheck source=lib/packs.sh
source "$(dirname "$0")/lib/packs.sh"

env=""
env_set=0
chain_id=""
chain_set=0
env_file=""
allow_mainnet=0
expire_after_blocks=""
pack=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)
      [[ "$env_set" -eq 1 ]] && { echo "ERROR: --env passed more than once" >&2; exit 2; }
      env="${2:?--env requires a value (stagef|prod)}"; env_set=1; shift 2 ;;
    --chain)
      [[ "$chain_set" -eq 1 ]] && { echo "ERROR: --chain passed more than once" >&2; exit 2; }
      chain_id="${2:?--chain requires a chainId}"; chain_set=1; shift 2 ;;
    --expire-after-blocks)
      expire_after_blocks="${2:?--expire-after-blocks requires a positive integer}"
      # uint32 upper bound = 2^32 - 1 = 4294967295. Upstream type is uint32:
      # newton-prover-avs/contracts/src/core/NewtonPolicyDataFactory.sol:31-36
      # and newton-cli's policy-data deploy parses it as Option<u32>. Catch
      # the overflow here so we fail fast in shell instead of getting a
      # less-actionable error from clap.
      if ! [[ "$expire_after_blocks" =~ ^[1-9][0-9]*$ ]] || \
         (( expire_after_blocks > 4294967295 )); then
        echo "ERROR: --expire-after-blocks must be a positive integer in [1, 4294967295] (uint32), got: $expire_after_blocks" >&2
        exit 2
      fi
      shift 2 ;;
    --allow-mainnet) allow_mainnet=1; shift ;;
    --env-file) env_file="${2:?--env-file requires a path}"; shift 2 ;;
    -h|--help) sed -n '2,41p' "$0"; exit 0 ;;
    --*) echo "unknown flag: $1" >&2; exit 2 ;;
    *)
      [[ -n "$pack" ]] && { echo "ERROR: only one pack at a time. Got: $pack and $1" >&2; exit 2; }
      pack="$1"; shift ;;
  esac
done

if [[ -z "$pack" ]]; then
  echo "ERROR: pack name required (e.g. \`pnpm run deploy balancer --env stagef --chain 11155111\`)" >&2
  echo "Known packs: ${ALL_PACKS[*]%%:*}" >&2
  exit 2
fi
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
# Reject leading zeros (other than literal "0") so `01` and `08453` cannot
# slip past the mainnet gate as different string-form values that bash's
# `case` pattern-match would treat as distinct from `1` and `8453`.
if ! [[ "$chain_id" =~ ^(0|[1-9][0-9]*)$ ]]; then
  echo "ERROR: --chain must be a canonical decimal chainId (no leading zeros), got: $chain_id" >&2
  exit 2
fi

# Resolve pack -> rego_package.
if ! pkg=$(resolve_pkg "$pack"); then
  echo "ERROR: unknown pack '$pack'. Known: ${ALL_PACKS[*]%%:*}" >&2
  exit 2
fi

# Mainnet deploy gate. Pre-audit, both Ethereum mainnet (1) and Base mainnet
# (8453) are off-limits. The Shield contract is non-upgradeable and any
# mainnet deploy is irreversible, so failing closed here is the only safe
# default.
#
# THREE distinct signals required for a mainnet deploy. Defense-in-depth so
# that a stray CI job, single forgotten environment variable, or accidentally-
# quoted flag can't slip a deploy through:
#   1. --allow-mainnet flag         (CLI, intentional operator action)
#   2. NEWTON_ALLOW_MAINNET_DEPLOY=1      (env, set by the operator)
#   3. NEWTON_ALLOW_MAINNET_DEPLOY_FLAG=1 (env, set by the operator)
#
# Both env vars are required at the gate boundary. Setting only one is the
# common accident vector; setting both deliberately is the operator's
# explicit acknowledgement. Preserves the two-env-var contract from PR #57
# across the pre-PR-#60 script split (now collapsed into one deploy.sh).
case "$chain_id" in
  1|8453)
    if [[ "$allow_mainnet" -ne 1 ]] || \
       [[ "${NEWTON_ALLOW_MAINNET_DEPLOY:-}" != "1" ]] || \
       [[ "${NEWTON_ALLOW_MAINNET_DEPLOY_FLAG:-}" != "1" ]]; then
      echo "ERROR: chain $chain_id is mainnet — refusing to deploy. Mainnet requires ALL THREE:" >&2
      echo "       --allow-mainnet (CLI), NEWTON_ALLOW_MAINNET_DEPLOY=1 (env), NEWTON_ALLOW_MAINNET_DEPLOY_FLAG=1 (env)." >&2
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

# Resolve RPC_URL from RPC_URL_<chainId>. Indirect expansion lets a single
# env file hold endpoints for every supported chain.
rpc_var="RPC_URL_${chain_id}"
RPC_URL="${!rpc_var:-}"
if [[ -z "$RPC_URL" ]]; then
  echo "ERROR: $rpc_var missing from $env_file" >&2
  echo "       add a line: $rpc_var=https://… for chain $chain_id" >&2
  exit 1
fi
export RPC_URL
export CHAIN_ID="$chain_id"
export DEPLOYMENT_ENV="$env"

: "${PRIVATE_KEY:?PRIVATE_KEY missing from $env_file}"

cids="./$pack/dist/policy_cids.json"
if [[ ! -f "$cids" ]]; then
  echo "ERROR: $cids not found — run \`pnpm run upload $pack\` first" >&2
  exit 1
fi

log="./$pack/deployment.log"

LAST_RUN_OUT=""
cleanup() {
  if [[ -n "${LAST_RUN_OUT:-}" && -f "$LAST_RUN_OUT" ]]; then
    rm -f "$LAST_RUN_OUT"
  fi
}
trap cleanup EXIT

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

echo "=== $(date) :: $pack policy-data deploy ($env/$chain_id) ===" | tee -a "$log"
# --expire-after-blocks is part of the CREATE2 salt for the PolicyData contract
# (see newton-prover-avs contracts/src/core/NewtonPolicyDataFactory.sol:131).
# Passing a session-unique value moves the predicted target address, which is
# the cleanest way to break orphan-collision deadlocks on testnet without
# rolling WASM bytes (which would break frozen rule 7's wasmCid stability
# across cells). Default = newton-cli default = 25 blocks on Sepolia, ~derived
# from chain block-time on others.
expire_args=()
if [[ -n "$expire_after_blocks" ]]; then
  expire_args+=(--expire-after-blocks "$expire_after_blocks")
fi
run newton-cli policy-data deploy --policy-cids "$cids" "${expire_args[@]}"

DATA_ADDR=$(grep -Eo "Policy data deployed successfully at address: 0x[a-fA-F0-9]+" "$LAST_RUN_OUT" | awk '{print $NF}')
if [[ -z "${DATA_ADDR:-}" ]]; then
  echo "ERROR: failed to extract DATA_ADDR from current invocation output" >&2
  exit 1
fi
echo "DATA_ADDR=$DATA_ADDR" | tee -a "$log"

# A pack ships only the reusable oracle (NewtonPolicyData). We do NOT deploy a
# per-pack single-pack NewtonPolicy: the pack's policy.rego is a *reference*
# that curators copy and deploy as their own NewtonPolicy (single-pack with
# one --policy-data-address, or composite with N). deployments.json records
# the oracle (policyData + wasmCid + policyCodeHash), not a blessed policy.
# See docs/writing-composite-policies.md.

echo "=== $(date) :: $pack DEPLOY DONE ($env/$chain_id) ===" | tee -a "$log"
echo "$pack DATA=$DATA_ADDR" | tee -a "$log"

# Emit a machine-readable snapshot so sync-deployments.sh can rebuild
# deployments.json without re-running deploys. Snapshot carries env so
# sync-deployments validates against --env (PR #58 cross-env corruption
# protection).
deployed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
git_commit=$(git rev-parse HEAD 2>/dev/null || echo "")
snapshot="./$pack/dist/last_deploy.json"
node - "$pack" "$pkg" "$CHAIN_ID" "$DEPLOYMENT_ENV" "$DATA_ADDR" \
  "$cids" "$deployed_at" "$git_commit" "${expire_after_blocks:-}" "$snapshot" <<'NODE'
const fs = require("fs");
const [pack, pkg, chainId, env, policyData, cidsPath, deployedAt, txCommit, expireAfterBlocksStr, out] = process.argv.slice(2);
const cids = JSON.parse(fs.readFileSync(cidsPath, "utf8"));
// expireAfterBlocks is part of the PolicyData CREATE2 salt
// (newton-prover-avs/contracts/src/core/NewtonPolicyDataFactory.sol:131).
// Persist it so offline CREATE2 reconstruction from the snapshot alone is
// possible without an on-chain `INewtonPolicyData.expireAfter()` round-trip.
// `null` when the operator didn't pass --expire-after-blocks (newton-cli
// applied its own block-time-derived default; the actual deployed value
// is recoverable from on-chain).
const expireAfterBlocks = expireAfterBlocksStr ? Number(expireAfterBlocksStr) : null;
const snap = { pack, package: pkg, chainId, env, policyData, policyCids: cids, expireAfterBlocks, deployedAt, txCommit };
fs.writeFileSync(out, JSON.stringify(snap, null, 2) + "\n");
NODE
echo "wrote $snapshot" | tee -a "$log"
