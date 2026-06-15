#!/usr/bin/env bash
# Build a single pack's WASM and upload its files to IPFS via Pinata.
# Writes <pack>/dist/{policy.wasm, policy.wasm.stamp, policy_cids.json}.
# No on-chain calls. No env / chain selection.
#
# Usage:
#   pnpm run upload <pack>
#   pnpm run upload <pack> --force                # rebuild WASM even if cache stamp matches
#   pnpm run upload <pack> --env-file <path>      # explicit env file for PINATA_JWT
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

# shellcheck source=lib/packs.sh
source "$(dirname "$0")/lib/packs.sh"

force=0
env_file=""
pack=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --force) force=1; shift ;;
    --env-file) env_file="${2:?--env-file requires a path}"; shift 2 ;;
    -h|--help) sed -n '2,23p' "$0"; exit 0 ;;
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

if ! pkg=$(resolve_pkg "$pack"); then
  echo "ERROR: unknown pack '$pack'. Known: ${ALL_PACKS[*]%%:*}" >&2
  exit 2
fi

# We need PINATA_JWT for IPFS uploads. Source the operator's chosen env file.
# Upload doesn't care about chainId or AVS env semantics, but the env file is
# the only place PINATA_JWT lives. If the operator passed --env-file, use it
# verbatim; otherwise discover the candidate files and require exactly one.
# Refusing on >1 candidates avoids picking a "wrong" PINATA_JWT silently when
# the operator has multiple distinct gitignored env files on disk.
if [[ -n "$env_file" ]]; then
  if [[ ! -f "$env_file" ]]; then
    echo "ERROR: --env-file path does not exist: $env_file" >&2
    exit 1
  fi
  # shellcheck disable=SC1090
  set -a; . "$env_file"; set +a
else
  candidates=()
  for envfile in .env.deploy.local.stagef .env.deploy.local.prod .env.deploy.local; do
    [[ -f "$envfile" ]] && candidates+=("$envfile")
  done
  if [[ ${#candidates[@]} -eq 0 ]]; then
    echo "ERROR: no env file found. Create .env.deploy.local.{stagef|prod} with PINATA_JWT, or pass --env-file <path>" >&2
    exit 1
  elif [[ ${#candidates[@]} -gt 1 ]]; then
    echo "ERROR: multiple env files found: ${candidates[*]}" >&2
    echo "       Pass --env-file <path> to disambiguate. Refusing to silently pick one." >&2
    exit 1
  fi
  # shellcheck disable=SC1090
  set -a; . "${candidates[0]}"; set +a
fi

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
