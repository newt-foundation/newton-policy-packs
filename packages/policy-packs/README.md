# @newton-xyz/policy-packs

All Newton policy packs in one package: typed TypeScript bindings for every
Newton policy pack, published as a single npm package with one subpath export
per pack.

The individual `@newton-xyz/policy-pack-<name>` packages are frozen at their
last published versions and no longer release. This umbrella is the only
publishing package in the repo; every pack change ships here, versioned
together.

## Install

```bash
pnpm add @newton-xyz/policy-packs
```

`@newton-xyz/policy-core`, `viem`, and `zod` are peer dependencies, mirroring
the per-pack packages.

## Usage

Import a pack from its subpath (each pack keeps its own exported API; for
example the webacy pack's oracle object):

```ts
import { webacy } from "@newton-xyz/policy-packs/webacy";
```

Or import packs as namespaces from the root entry:

```ts
import { webacy, balancer } from "@newton-xyz/policy-packs";
```

Available subpaths: `arkham_counterparty`, `arkham_entity`, `arkham_risk`, `balancer`, `blockaid`, `chainalysis`, `guardrail`, `persona`, `pharos_redemption`, `pharos_safe_mode`, `pharos_treasury`, `redstone`, `registry`, `safe_signer_threshold`, `sumsub`, `vaultsfyi`, `webacy`, `xerberus_common_cause`, `xerberus_liquidity_exit`, `xerberus_what_if`.

## Migrating from a per-pack package

Replace the package name and add the pack name as a subpath:

```diff
- import { ... } from "@newton-xyz/policy-pack-webacy";
+ import { ... } from "@newton-xyz/policy-packs/webacy";
```

The exported API of each pack is unchanged.
