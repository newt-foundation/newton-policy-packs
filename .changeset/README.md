# Changesets

This folder is part of the changesets workflow. Each pull request that changes a published package under `packages/` should add a changeset entry describing the change.

```bash
pnpm changeset
```

Pick the affected packages and the bump level (`patch`, `minor`, `major`). The CLI writes a markdown file to this folder. CI consumes it on merge to `main` to compute new versions and publish.

Pack authors don't need to touch this folder for AVS-side changes (Rego, WASM, schemas) — only when a pack's TypeScript binding ships a new version.
