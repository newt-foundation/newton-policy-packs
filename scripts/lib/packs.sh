#!/usr/bin/env bash
# Shared pack registry. Sourced by upload.sh and deploy.sh. Single source of
# truth for the (pack, rego_package) mapping so that adding a new pack
# requires editing one file, not two.
#
# Format: each entry is "<pack>:<rego_package>". The pack name is the
# top-level folder name AND the npm package suffix (@newton-xyz/policy-pack-<pack>)
# AND the PACK_ID literal in policy.js AND the data.wasm.<pack>.* Rego
# namespace key. The rego_package is what `package <name>` declares at the
# top of <pack>/policy.rego (snake_case, hyphens → underscores).
#
# Helper: resolve_pkg <pack> echoes the rego_package string and returns 0,
# or echoes nothing and returns 1 if the pack name is unknown.

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

resolve_pkg() {
  local pack=$1
  local entry
  for entry in "${ALL_PACKS[@]}"; do
    if [[ "${entry%%:*}" == "$pack" ]]; then
      echo "${entry##*:}"
      return 0
    fi
  done
  return 1
}
