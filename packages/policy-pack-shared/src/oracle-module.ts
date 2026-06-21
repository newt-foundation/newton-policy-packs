import type { z } from "zod";
import type { ChainId, Deployment, GatewayEnv } from "./deployment";
import type { PolicyPack } from "./pack";

/**
 * The subset of `PolicyPack<P, W, S>` that a composite policy needs to wire
 * a pack into a multi-oracle manifest.
 *
 * `defineComposite(...)` (lands in Phase 2 — see `docs/composite-policies.md`)
 * consumes one `OracleModule` per pack the curator wants to stack. The
 * composite builder needs:
 *
 * - `id` — the pack's stable identifier (`<pack>/<purpose>/<version>`), used
 *   to namespace WASM outputs in the merged `data.wasm` blob (Phase 0
 *   convention) and to populate the on-chain composite manifest.
 * - The three schemas — `paramsSchema`, `wasmArgsSchema`, `secretsSchema` —
 *   so the composite can validate per-module curator inputs at intent-build
 *   time and surface schema mismatches before any AVS round-trip.
 * - `paramsJsonSchema` — OPTIONAL. The raw `params_schema.json` this module's
 *   params zod was generated from. `generateCompositeParamsSchema` inlines it
 *   under `params.<shortId>` so the composite's pinned on-chain params schema
 *   describes the manifest envelope the AVS validates as-is. A module without
 *   it can't be stacked into a composite — `generateCompositeParamsSchema`
 *   throws a clear error rather than silently emitting an incomplete schema.
 * - `deployments` — the `(chainId, env) → Deployment` map sliced from the
 *   upstream `deployments.json`. The composite manifest carries each module's
 *   `policyData` address and `wasmCid`; both come from this map via
 *   `getDeployment(module, chainId, env)`.
 *
 * What `OracleModule` deliberately omits from `PolicyPack`:
 *
 * - `prepareQuery` — runs at intent-build time; composites don't need it
 *   when assembling the on-chain manifest (the SDK still calls each pack's
 *   `prepareQuery` per-call when a composite is executed, but that's the
 *   `PolicyPack` reference, not the `OracleModule`).
 * - `metadata` — author/link/description are partner-facing identity, not
 *   composite-relevant.
 *
 * Every `@newton-xyz/policy-pack-<name>` package exports a hand-written
 * `<name>OracleModule` constant constructed via `oracleModuleFromPack(<name>)`
 * so the subset stays in lockstep with the underlying `PolicyPack` (no manual
 * field-by-field projection that could drift).
 */
export interface OracleModule<TParams, TWasmArgs, TSecrets> {
	readonly id: string;
	readonly paramsSchema: z.ZodType<TParams>;
	readonly wasmArgsSchema: z.ZodType<TWasmArgs>;
	readonly secretsSchema: z.ZodType<TSecrets>;
	readonly paramsJsonSchema?: object;
	readonly deployments: Readonly<
		Partial<Record<ChainId, Readonly<Partial<Record<GatewayEnv, Deployment>>>>>
	>;
}

/**
 * Project a `PolicyPack` to its composite-relevant `OracleModule` view.
 *
 * Each per-pack package uses this in its hand-written `pack.ts`:
 *
 * ```ts
 * import { oracleModuleFromPack } from "@newton-xyz/policy-pack-shared";
 * export const balancer: PolicyPack<...> = { ... };
 * export const balancerOracleModule = oracleModuleFromPack(balancer);
 * ```
 *
 * Using the helper rather than re-typing the fields keeps the module's
 * `id`, schemas, and `deployments` byte-identical to the underlying pack —
 * no chance of a curator setting params via the pack and getting a
 * different validation surface from the same module in a composite.
 */
export function oracleModuleFromPack<TParams, TWasmArgs, TSecrets>(
	pack: PolicyPack<TParams, TWasmArgs, TSecrets>,
): OracleModule<TParams, TWasmArgs, TSecrets> {
	return {
		id: pack.id,
		paramsSchema: pack.paramsSchema,
		wasmArgsSchema: pack.wasmArgsSchema,
		secretsSchema: pack.secretsSchema,
		paramsJsonSchema: pack.paramsJsonSchema,
		deployments: pack.deployments,
	};
}
