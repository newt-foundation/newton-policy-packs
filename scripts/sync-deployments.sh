#!/usr/bin/env bash
# Merge every <pack>/dist/last_deploy.json (written by deploy-pack.sh) into
# deployments.json under the requested env axis. Idempotent — safe to re-run
# if a deploy half-finished.
#
# Usage:
#   ./scripts/sync-deployments.sh --env stagef                  # required: which env this batch targets
#   ./scripts/sync-deployments.sh --env prod --notes "msg ..."  # also overwrite the `notes` field
#
# The env arg is REQUIRED — `deployments.json` is keyed by (pack, chainId, env)
# and there's no safe default. If a deploy run targeted Sepolia + stagef, pass
# `--env stagef`. Each `<pack>/dist/last_deploy.json` snapshot is written by
# deploy-pack.sh and carries the chainId from the env file the deploy ran
# against; the env axis here is the AVS-side environment that pairs with it.

set -euo pipefail

env=""
notes=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) env="${2:?--env requires a value (stagef|prod)}"; shift 2 ;;
    --notes) notes="${2:?--notes requires a message}"; shift 2 ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
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

deployments_path="./deployments.json"
if [[ ! -f "$deployments_path" ]]; then
  echo "ERROR: $deployments_path not found" >&2
  exit 1
fi

snapshots=()
for snap in */dist/last_deploy.json; do
  [[ -f "$snap" ]] || continue
  snapshots+=("$snap")
done

if [[ ${#snapshots[@]} -eq 0 ]]; then
  echo "no <pack>/dist/last_deploy.json snapshots found — run deploy-pack.sh first" >&2
  exit 1
fi

echo "merging ${#snapshots[@]} snapshot(s) into $deployments_path under env=$env"
for s in "${snapshots[@]}"; do echo "  - $s"; done

node - "$deployments_path" "$env" "$notes" "${snapshots[@]}" <<'NODE'
const fs = require("fs");
const [, , depPath, env, notesArg, ...snapPaths] = process.argv;
const notes = notesArg || "";

const dep = JSON.parse(fs.readFileSync(depPath, "utf8"));
dep.packs = dep.packs || {};

const dateOnly = (iso) => (iso || "").slice(0, 10);

// Validate every snapshot's `env` matches the requested --env BEFORE merging
// any of them. A mismatch means deploy-all.sh ran the pack against a
// different env, then someone called sync with the wrong --env (or a
// stale `<pack>/dist/last_deploy.json` from a prior cell got picked up
// without being overwritten by a successful deploy on the requested env).
// Fail-closed protects deployments.json from cross-env corruption.
const mismatches = [];
const missingEnv = [];
for (const path of snapPaths) {
  const s = JSON.parse(fs.readFileSync(path, "utf8"));
  if (!s.env) {
    missingEnv.push(`${path} (snapshot has no \`env\` field — was it written by an old deploy-pack.sh?)`);
    continue;
  }
  if (s.env !== env) {
    mismatches.push(`${path}: snapshot env="${s.env}" but --env="${env}"`);
  }
}
if (mismatches.length || missingEnv.length) {
  console.error("ERROR: snapshot/--env validation failed:");
  for (const m of mismatches) console.error(`  ${m}`);
  for (const m of missingEnv) console.error(`  ${m}`);
  console.error();
  console.error("Refusing to merge — would corrupt deployments.json under cross-env writes.");
  console.error("Fix: re-run \`pnpm run deploy:all --env <correct-env> --chain <chainId>\`");
  console.error("for the affected packs so their snapshot is rewritten under the right env,");
  console.error("then re-run \`pnpm run deploy:sync --env <correct-env>\`.");
  process.exit(2);
}

for (const path of snapPaths) {
  const s = JSON.parse(fs.readFileSync(path, "utf8"));
  const { pack, chainId, policy, policyData, policyCids, deployedAt } = s;
  const cidsBlock = policyCids || {};
  dep.packs[pack] = dep.packs[pack] || {};
  dep.packs[pack][chainId] = dep.packs[pack][chainId] || {};
  const prev = dep.packs[pack][chainId][env] || {};
  const next = {
    policy,
    policyData,
    wasmCid: cidsBlock.wasmCid,
    policyCodeHash: cidsBlock.policyCodeHash,
    deployedAt: dateOnly(deployedAt) || prev.deployedAt,
    notes: notes || prev.notes || "",
  };
  dep.packs[pack][chainId][env] = next;
  console.error(`  merged ${pack}@${chainId}/${env}: policy=${policy} data=${policyData}`);
}

const tmp = depPath + ".tmp";
fs.writeFileSync(tmp, JSON.stringify(dep, null, 2) + "\n");
fs.renameSync(tmp, depPath);
console.error(`wrote ${depPath}`);
NODE

echo "done"
