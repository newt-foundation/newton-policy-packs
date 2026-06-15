#!/usr/bin/env bash
# Build a single pack's WASM and upload its files to IPFS via Pinata.
# Writes <pack>/dist/{policy.wasm, policy.wasm.stamp, policy_cids.json}.
# No on-chain calls. No env / chain selection.
#
# Usage:
#   pnpm run upload <pack>
#   pnpm run upload <pack> --force        # rebuild WASM even if cache stamp matches
#
# Run ONCE per pack at the start of a deploy session. The resulting
# policy_cids.json is reused by `pnpm run deploy <pack> --env <env> --chain <chainId>`
# for every (chainId, env) cell — which is what gives a pack one canonical
# wasmCid across all cells (frozen rule 7 in CLAUDE.md).
#
# Idempotent on the cache stamp: if `<pack>/dist/policy.wasm.stamp` matches
# the SHA-256 of (policy.js + newton-provider.wit + jco --version + flags),
# we skip the jco componentize step. Pinata pinning IS run unconditionally,
# but it's content-addressed so identical bytes return the same CID — cheap
# round-trip, no on-chain effect.
#
# Requires: jco, newton-cli on PATH; PINATA_JWT, PINATA_GATEWAY in env (or
# .env.deploy.local.<env> via the wrapper that sources one).

set -euo pipefail

cd "$(dirname "$0")/.."

# pack:rego_package — single source of truth across upload.sh and deploy.sh.
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

force=0
pack=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --force) force=1; shift ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    --*) echo "unknown flag: $1" >&2; exit 2 ;;
    *)
      [[ -n "$pack" ]] && { echo "ERROR: only one pack at a time. Got: $pack and $1" >&2; exit 2; }
      pack="$1"; shift ;;
  esac
done

if [[ -z "$pack" ]]; then
  echo "ERROR: pack name required (e.g. \`pnpm run upload balancer\`)" >&2
  echo "Known packs: ${ALL_PACKS[*]%%:*}" >&2
  exit 2
fi

pkg=""
for entry in "${ALL_PACKS[@]}"; do
  if [[ "${entry%%:*}" == "$pack" ]]; then
    pkg="${entry##*:}"
    break
  fi
done
if [[ -z "$pkg" ]]; then
  echo "ERROR: unknown pack '$pack'. Known: ${ALL_PACKS[*]%%:*}" >&2
  exit 2
fi

# We need PINATA_JWT for IPFS uploads. Source the user's preferred env file
# if one exists. The user typically runs `pnpm run upload` once per pack at
# the start of a session, so we accept any of the gitignored env files —
# the upload step doesn't care about chainId or env.
for envfile in .env.deploy.local.stagef .env.deploy.local.prod .env.deploy.local; do
  if [[ -f "$envfile" ]]; then
    # shellcheck disable=SC1090
    set -a; . "$envfile"; set +a
    break
  fi
done

: "${PINATA_JWT:?PINATA_JWT env var required (otherwise IPFS uploads silently fall back to the rate-limited Newton proxy). Set it in .env.deploy.local.<env>.}"

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

# Compute a content-addressed cache stamp for the WASM artifact. Inputs:
# policy.js bytes, newton-provider.wit bytes, jco version, componentize
# flag set. SHA-256 over the concatenation. Used in lieu of file mtimes
# (which are easily lied to).
wasm_cache_stamp() {
  local p=$1
  {
    shasum -a 256 "$p/policy.js" "$p/newton-provider.wit" 2>/dev/null
    jco --version 2>/dev/null
    echo "componentize-flags: --disable http --disable random --disable fetch-event --disable stdio"
  } | shasum -a 256 | awk '{print $1}'
}

mkdir -p "./$pack/dist"

wasm="./$pack/dist/policy.wasm"
stamp="./$pack/dist/policy.wasm.stamp"
current_stamp=$(wasm_cache_stamp "./$pack")
needs_componentize=0
if [[ ! -f "$wasm" || ! -f "$stamp" ]]; then
  needs_componentize=1
elif [[ "$current_stamp" != "$(cat "$stamp")" ]]; then
  needs_componentize=1
fi

if [[ "$needs_componentize" -eq 1 || "$force" -eq 1 ]]; then
  echo "=== $(date) :: $pack jco componentize ===" | tee -a "$log"
  jco componentize "./$pack/policy.js" \
    --wit "./$pack/newton-provider.wit" \
    -n newton-provider \
    --disable http --disable random --disable fetch-event --disable stdio \
    -o "$wasm"
  echo "$current_stamp" > "$stamp"
else
  echo "=== $(date) :: $pack policy.wasm is up-to-date (cache stamp matches) — reusing ===" | tee -a "$log"
fi

echo "=== $(date) :: $pack sync source policy.rego -> dist ===" | tee -a "$log"
cp -f "./$pack/policy.rego" "./$pack/dist/policy.rego"

echo "=== $(date) :: $pack generate-cids (Pinata IPFS upload) ===" | tee -a "$log"
run newton-cli policy-files generate-cids \
  -d "./$pack/dist" \
  --entrypoint "$pkg.allow" \
  --secrets-schema-file "./$pack/secrets_schema.json" \
  -o "./$pack/dist/policy_cids.json"

echo "=== $(date) :: $pack UPLOAD DONE ===" | tee -a "$log"
echo "wrote ./$pack/dist/policy_cids.json" | tee -a "$log"
echo "next: pnpm run deploy $pack --env <stagef|prod> --chain <chainId>"
