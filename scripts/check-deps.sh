#!/usr/bin/env bash
set -uo pipefail

MISSING=0

check() {
  local name="$1"
  local cmd="$2"
  local install_hint="$3"

  if command -v "$cmd" &>/dev/null; then
    local version
    version=$("$cmd" --version 2>/dev/null | head -1)
    echo "✓ $name ($version)"
  else
    echo "✗ $name — install with: $install_hint"
    MISSING=$((MISSING + 1))
  fi
}

check "node" "node" "brew install node"
check "pnpm" "pnpm" "npm install -g pnpm"
check "newton-cli" "newton-cli" "cargo install newton-cli@0.1.31"

# jco is a local devDep, check via npx
if npx jco --version &>/dev/null 2>&1; then
  JCO_VERSION=$(npx jco --version 2>/dev/null | head -1)
  echo "✓ jco ($JCO_VERSION)"
else
  echo "✗ jco — run: pnpm install"
  MISSING=$((MISSING + 1))
fi

echo ""
if [ "$MISSING" -gt 0 ]; then
  echo "$MISSING missing dependency(s)"
  exit 1
else
  echo "All dependencies satisfied"
fi
