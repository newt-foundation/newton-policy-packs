#!/usr/bin/env bash
# Merge every <pack>/dist/last_deploy.json (written by deploy-pack.sh) into
# deployments.json. Idempotent — safe to re-run if a deploy half-finished.
#
# Usage:
#   ./scripts/sync-deployments.sh                       # merge all snapshots, keep existing notes
#   ./scripts/sync-deployments.sh --notes "round 2: ..." # overwrite the `notes` field on every merged pack

set -euo pipefail

notes=""
if [[ "${1:-}" == "--notes" ]]; then
  notes="${2:?--notes requires a message}"
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

echo "merging ${#snapshots[@]} snapshot(s) into $deployments_path"
for s in "${snapshots[@]}"; do echo "  - $s"; done

node - "$deployments_path" "$notes" "${snapshots[@]}" <<'NODE'
const fs = require("fs");
const [, , depPath, notesArg, ...snapPaths] = process.argv;
const notes = notesArg || "";

const dep = JSON.parse(fs.readFileSync(depPath, "utf8"));
dep.packs = dep.packs || {};

const dateOnly = (iso) => (iso || "").slice(0, 10);

for (const path of snapPaths) {
  const s = JSON.parse(fs.readFileSync(path, "utf8"));
  const { pack, chainId, policy, policyData, policyCids, deployedAt } = s;
  const cidsBlock = policyCids || {};
  const prev = (dep.packs[pack] && dep.packs[pack][chainId]) || {};
  const next = {
    policy,
    policyData,
    wasmCid: cidsBlock.wasmCid,
    policyCodeHash: cidsBlock.policyCodeHash,
    deployedAt: dateOnly(deployedAt) || prev.deployedAt,
    notes: notes || prev.notes || "",
  };
  dep.packs[pack] = dep.packs[pack] || {};
  dep.packs[pack][chainId] = next;
  console.error(`  merged ${pack}@${chainId}: policy=${policy} data=${policyData}`);
}

const tmp = depPath + ".tmp";
fs.writeFileSync(tmp, JSON.stringify(dep, null, 2) + "\n");
fs.renameSync(tmp, depPath);
console.error(`wrote ${depPath}`);
NODE

echo "done"
