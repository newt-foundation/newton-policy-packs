---
"@newton-xyz/policy-packs": patch
---

Fix the umbrella's subpath type declarations: the published .d.ts files were one-line re-exports of the (uninstalled) per-pack packages, so external consumers got no types from the subpaths (e.g. `import { vaultsfyi } from "@newton-xyz/policy-packs/vaultsfyi"` failed typechecking). The umbrella build now bundles the packs' types (tsup dts resolve). Runtime bundles were unaffected.
