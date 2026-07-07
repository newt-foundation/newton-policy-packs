import type { z } from "zod";
import { generateCompositeParamsSchema, shortPackIdFromModuleId } from "./composite-manifest";
import { deriveParamsJsonSchema } from "./derive-params-json-schema";
import type { PolicyPack, PrepareQueryArgs, PrepareQueryResult } from "./pack";

/**
 * Grammar a derived short pack id must satisfy: a lowercase letter then
 * lowercase alphanumerics or underscore. This is the set safe as a Rego
 * dot-path segment (`data.params.<shortId>`) and a composite-manifest key.
 * Excludes hyphens (Rego reads `a-b` as subtraction), dots, spaces, uppercase,
 * leading digits, and prototype keys (`__proto__` starts with `_`). Copied from
 * the retired defineCustomModule so a custom oracle is dot-notation-safe by
 * construction. Every KNOWN_PACK_IDS entry already matches it.
 */
const SHORT_ID_RE = /^[a-z][a-z0-9_]*$/;

/**
 * Arguments to {@link definePolicyPack}. There is NO `paramsJsonSchema` field:
 * the on-chain JSON schema is DERIVED from `paramsSchema` (zod) at construction,
 * so a pack author writes ONE schema.
 *
 * `unsafeParamsJsonSchemaOverride` is the deliberately-verbose escape hatch for a
 * shape zod can't express. The name is load-bearing DX (finding DX-1):
 * (1) it is NOT `paramsJsonSchema`, so a dev migrating from the retired
 *     `defineCustomModule` (which REQUIRED a `paramsJsonSchema` field) CANNOT
 *     mechanically paste their old arg and silently land on the unsafe path - it
 *     is an unknown-property TS error that steers them to omit it and let the
 *     derivation run;
 * (2) `unsafe` in the identifier surfaces at every callsite + in autocomplete,
 *     satisfying spec 4.1's "labelled UNSAFE in types" requirement (a JSDoc line
 *     alone does not).
 * When supplied it reopens zod-vs-JSON drift, so `definePolicyPack` runs BOTH the
 * regorus keyword gate AND the key-set reconciliation the old `defineCustomModule`
 * ran, so the override is not WEAKER than what it replaces (see the factory body).
 * Prefer omitting it.
 */
export interface DefinePolicyPackArgs<
	TId extends string,
	TParams,
	TWasmArgs,
	TSecrets,
	TOptions = unknown,
> {
	readonly id: TId;
	readonly paramsSchema: z.ZodType<TParams>;
	readonly wasmArgsSchema: z.ZodType<TWasmArgs>;
	readonly secretsSchema: z.ZodType<TSecrets>;
	/** UNSAFE escape hatch. Prefer omitting - the schema derives from `paramsSchema`. See the doc above. */
	readonly unsafeParamsJsonSchemaOverride?: object;
	readonly deployments: PolicyPack<TId, TParams, TWasmArgs, TSecrets, TOptions>["deployments"];
	readonly metadata: PolicyPack<TId, TParams, TWasmArgs, TSecrets, TOptions>["metadata"];
	prepareQuery?(args: PrepareQueryArgs, options?: TOptions): Promise<PrepareQueryResult<TWasmArgs>>;
}

/**
 * The ONE factory for a Newton policy pack. A first-party pack AND a
 * curator-authored custom oracle are constructed identically - there is no
 * separate "custom module" concept. Front-loads (fail-early, before any RPC)
 * the checks the retired defineCustomModule did, MINUS the KNOWN_PACK_IDS
 * membership gate (Q7: an unknown id is normal, not suspect; provenance is
 * metadata, not a block - see provenance.ts). Derives + gates `paramsJsonSchema`
 * from the zod `paramsSchema` (one source of truth) unless an explicit
 * (unsafe) override is supplied.
 *
 * Validation:
 * - `id` is a non-empty string not starting with "/".
 * - the derived short pack id matches ^[a-z][a-z0-9_]*$.
 * - the three zod schemas are present.
 * - `metadata` carries `{ name, version, description }` strings.
 * - `deployments` is a plain object.
 * - `paramsJsonSchema` (derived or override) survives the exact regorus gate
 *   `generateCompositeParamsSchema` runs.
 *
 * @throws {PolicyPackDefinitionError} on a shape problem (bad id, missing schema,
 *   non-object deployments/metadata), or when an explicit
 *   `unsafeParamsJsonSchemaOverride` fails the regorus gate or the zod/JSON
 *   key-set reconciliation.
 * @throws {ParamsSchemaDerivationError} on the default (no-override) path, when
 *   the zod `paramsSchema` derives a JSON Schema the regorus gate rejects.
 */
export function definePolicyPack<
	const TId extends string,
	TParams,
	TWasmArgs,
	TSecrets,
	TOptions = unknown,
>(
	spec: DefinePolicyPackArgs<TId, TParams, TWasmArgs, TSecrets, TOptions>,
): PolicyPack<TId, TParams, TWasmArgs, TSecrets, TOptions> {
	if (typeof spec.id !== "string" || spec.id.length === 0) {
		throw new PolicyPackDefinitionError(
			"id must be a non-empty string of the form `<pack>/<purpose>/<version>`, e.g. `my-oracle/max-ltv/v1`",
		);
	}
	if (spec.id.startsWith("/")) {
		throw new PolicyPackDefinitionError(
			`id must not start with "/", got ${JSON.stringify(spec.id)}`,
		);
	}

	const shortId = shortPackIdFromModuleId(spec.id);
	if (!SHORT_ID_RE.test(shortId)) {
		throw new PolicyPackDefinitionError(
			`id \`${spec.id}\` derives short pack id \`${shortId}\`, which is not a valid Rego dot-path segment. It must match ${SHORT_ID_RE} (lowercase letter, then lowercase alphanumerics or underscore) so composite Rego can read \`data.params.${shortId}\` / \`data.wasm.${shortId}\`. Use snake_case, e.g. \`bizantine_ltv\`.`,
		);
	}

	for (const [name, schema] of [
		["paramsSchema", spec.paramsSchema],
		["wasmArgsSchema", spec.wasmArgsSchema],
		["secretsSchema", spec.secretsSchema],
	] as const) {
		if (!schema || typeof (schema as { safeParse?: unknown }).safeParse !== "function") {
			throw new PolicyPackDefinitionError(`${name} must be a zod schema`);
		}
	}

	if (
		!spec.deployments ||
		typeof spec.deployments !== "object" ||
		Array.isArray(spec.deployments)
	) {
		throw new PolicyPackDefinitionError(
			"deployments must be a `chainId -> env -> Deployment` object (use `{}` for a pack defined before it is deployed anywhere)",
		);
	}

	if (!spec.metadata || typeof spec.metadata !== "object" || Array.isArray(spec.metadata)) {
		throw new PolicyPackDefinitionError(
			"metadata must be an object with `{ name, version, description }`",
		);
	}
	for (const key of ["name", "version", "description"] as const) {
		if (typeof (spec.metadata as Record<string, unknown>)[key] !== "string") {
			throw new PolicyPackDefinitionError(
				`metadata.${key} must be a string - metadata requires \`{ name, version, description }\`.`,
			);
		}
	}

	// Zod-first: derive paramsJsonSchema unless the UNSAFE override is given.
	let paramsJsonSchema: object;
	if (spec.unsafeParamsJsonSchemaOverride === undefined) {
		paramsJsonSchema = deriveParamsJsonSchema(spec.paramsSchema, { id: spec.id });
	} else {
		const override = spec.unsafeParamsJsonSchemaOverride;
		if (typeof override !== "object" || Array.isArray(override)) {
			throw new PolicyPackDefinitionError(
				"unsafeParamsJsonSchemaOverride must be a JSON Schema object - prefer omitting it so the schema derives from paramsSchema",
			);
		}
		// (1) Gate the override through the same regorus keyword production path.
		try {
			generateCompositeParamsSchema({ modules: [{ id: spec.id, paramsJsonSchema: override }] });
		} catch (err) {
			// Re-throw as PolicyPackDefinitionError so the test's error-class assertion passes
			throw new PolicyPackDefinitionError(err instanceof Error ? err.message : String(err));
		}
		// (2) Reconcile the two params surfaces - PORTED from the retired
		// defineCustomModule so the override is NOT a safety regression (finding
		// DX-1). `paramsSchema` (zod) gates SDK validation; the override is pinned
		// on-chain and read by depositors. If their PROPERTY key sets disagree,
		// SDK-valid params get denied fail-closed at the AVS, or the on-chain schema
		// misrepresents enforcement (a verifiability defect). Best-effort: only when
		// paramsSchema is a ZodObject (exposes `.shape`); opaque schemas (record/
		// union) can't be introspected and are skipped (same as the old code). Key
		// sets only, NOT `required` - an optional zod field is a legit property
		// absent from `required`.
		const zodShape = (spec.paramsSchema as { shape?: Record<string, unknown> })?.shape;
		if (zodShape && typeof zodShape === "object") {
			const jsonProps = (override as { properties?: Record<string, unknown> }).properties ?? {};
			const zodKeys = Object.keys(zodShape).sort();
			const jsonKeys = Object.keys(jsonProps).sort();
			if (zodKeys.join(",") !== jsonKeys.join(",")) {
				throw new PolicyPackDefinitionError(
					`paramsSchema (zod) and unsafeParamsJsonSchemaOverride describe different fields: zod has [${zodKeys.join(", ")}], override.properties has [${jsonKeys.join(", ")}]. ` +
						"They must agree - the zod gates SDK validation, the override is pinned on-chain; a mismatch means SDK-valid params get denied at the AVS, or the on-chain schema misrepresents what is enforced. Omit the override so it derives from paramsSchema, or align the two by hand.",
				);
			}
		}
		paramsJsonSchema = override;
	}

	const pack: PolicyPack<TId, TParams, TWasmArgs, TSecrets, TOptions> = {
		id: spec.id,
		paramsSchema: spec.paramsSchema,
		wasmArgsSchema: spec.wasmArgsSchema,
		secretsSchema: spec.secretsSchema,
		paramsJsonSchema,
		deployments: spec.deployments,
		metadata: spec.metadata,
	};
	// Only attach prepareQuery when supplied, so `"prepareQuery" in pack` stays
	// false for query-less packs.
	if (spec.prepareQuery) {
		return { ...pack, prepareQuery: spec.prepareQuery };
	}
	return pack;
}

/**
 * Thrown by {@link definePolicyPack} for a shape-of-args problem: a bad id, an
 * invalid short id, a missing schema, a non-object deployments/metadata. A
 * regorus-hostile derived schema throws `ParamsSchemaDerivationError` (from the
 * derivation helper); a regorus-hostile explicit override throws
 * `PolicyPackDefinitionError` (the override path catches the gate's
 * `MalformedManifestError` and re-throws it as this class).
 */
export class PolicyPackDefinitionError extends Error {
	override readonly name = "PolicyPackDefinitionError";
}
