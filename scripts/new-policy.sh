#!/usr/bin/env bash
set -euo pipefail

[[ "${1:-}" == "--" ]] && shift
NAME="${1:?Usage: pnpm run new-policy -- <name>}"
POLICY_DIR="policies/$NAME"
PACKAGE_NAME=$(echo "$NAME" | tr '-' '_')

if [ -d "$POLICY_DIR" ]; then
  echo "Error: $POLICY_DIR already exists"
  exit 1
fi

mkdir -p "$POLICY_DIR/policy-files"

# Copy files that need no substitution
cp templates/newton-provider.wit "$POLICY_DIR/newton-provider.wit"
cp templates/params_schema.json "$POLICY_DIR/params_schema.json"

# Copy files with substitution
for f in policy.js policy.rego policy_data_metadata.json policy_metadata.json README.md; do
  sed -e "s/{{POLICY_NAME}}/$NAME/g" -e "s/{{PACKAGE_NAME}}/$PACKAGE_NAME/g" \
    "templates/$f" > "$POLICY_DIR/$f"
done

echo "Created policy: $POLICY_DIR"
echo "Next: edit $POLICY_DIR/policy.js and $POLICY_DIR/policy.rego"
