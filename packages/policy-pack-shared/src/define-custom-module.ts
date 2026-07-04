import { generateCompositeParamsSchema, shortPackIdFromModuleId } from "./composite-manifest";
import { isKnownPackId } from "./known-pack-ids";
import type { PolicyPack } from "./pack";

/**
 * Grammar a derived short pack id must satisfy: a lowercase letter followed by
 * lowercase alphanumerics or underscores. This is the set that is safe as a Rego
 * dot-path segment (`data.params.<shortId>`) and as a plain composite-manifest
 * key. Every published `KNOWN_PACK_IDS` entry already matches it. Excludes
 * hyphens (Rego reads `a-b` as subtraction), dots, spaces, uppercase, and
 * leading digits. The leading `[a-z]` anchor also rejects prototype keys like
 * `__proto__` (they start with `_`), which would otherwise corrupt the generated
 * envelope object.
 */
const SHORT_ID_RE = /^[a-z][a-z0-9_]*$/;

/**
 * Arguments for {@link defineCustomModule}. Structurally the `PolicyPack`
 * contract with one difference: `paramsJsonSchema` is REQUIRED, not optional.
 *
 * A `PolicyPack` may omit `paramsJsonSchema` when it's only ever used single-pack
 * (see `pack.ts`), but a module built to be composed with others MUST ship it —
 * `generateCompositeParamsSchema` needs each module's inner JSON Schema to pin
 * the on-chain envelope. Requiring it here surfaces the omission at construction
 * instead of deep inside `defineComposite`.
 */
export interface DefineCustomModuleArgs<TParams, TWasmArgs, TSecrets>
	extends Omit<PolicyPack<TParams, TWasmArgs, TSecrets>, "paramsJsonSchema"> {
	readonly paramsJsonSchema: object;
}

/**
 * Safe constructor for a custom (bespoke / unpublished) `PolicyPack` that
 * composes with published `@newton-xyz/policy-pack-<name>` packs in one
 * `defineComposite(...)` call.
 *
 * Policy packs are an optional building block: a curator can bring their own
 * policy-data oracle and mix it with published packs in a single vault policy.
 * Hand-rolling the `PolicyPack` object works, but a mistake (a regorus-hostile
 * keyword in `paramsJsonSchema`, a short id that collides with a published pack)
 * surfaces only when the module is composited — deep inside
 * `generateCompositeParamsSchema` or, worse, fail-closed at attestation time.
 * This helper front-loads those checks so a bad module throws HERE, at define
 * time, with an actionable message.
 *
 * Composing the result with published packs still requires
 * `defineComposite({ modules: [...], allowUnknownPackIds: true })` — the flag is
 * how the composite builder is told a non-`KNOWN_PACK_IDS` short id is
 * intentional rather than a typo. See `docs/writing-composite-policies.md`.
 *
 * Validation performed (all fail-early, before any RPC):
 * - `id` is a non-empty string not starting with `/`.
 * - the derived short pack id matches `^[a-z][a-z0-9_]*$` — it is used as a Rego
 *   dot-path segment (`data.params.<shortId>`) and a manifest key, so hyphens,
 *   dots, spaces, uppercase, leading digits, and prototype keys are rejected.
 * - the derived short pack id is NOT in `KNOWN_PACK_IDS` — a custom module must
 *   not claim a published pack's `data.params.<shortId>` / `data.wasm.<shortId>`
 *   namespace.
 * - the three zod schemas are present; `metadata` carries `{ name, version,
 *   description }` strings.
 * - `paramsJsonSchema` is present AND survives the exact gate
 *   `generateCompositeParamsSchema` runs (`assertRegorusSupportedKeywords`), so
 *   a `$ref` / `oneOf` / `format` keyword that passes `opa test` and zod but
 *   fails-closed at the AVS is caught now. This reuses the production path
 *   rather than duplicating the keyword allowlist, so the two can't drift.
 * - when `paramsSchema` is a `z.object`, its field set matches
 *   `paramsJsonSchema.properties` — the zod (SDK validation) and the JSON Schema
 *   (pinned on-chain) must describe the same params, or SDK-valid params get
 *   denied fail-closed at the AVS / the on-chain schema misrepresents enforcement.
 *
 * @throws {CustomModuleError} on a shape problem (bad id, namespace collision,
 *   missing schema).
 * @throws {MalformedManifestError} (re-thrown from `generateCompositeParamsSchema`)
 *   when `paramsJsonSchema` uses a JSON Schema keyword newton-rego can't parse.
 */
export function defineCustomModule<TParams, TWasmArgs, TSecrets>(
	args: DefineCustomModuleArgs<TParams, TWasmArgs, TSecrets>,
): PolicyPack<TParams, TWasmArgs, TSecrets> {
	if (typeof args.id !== "string" || args.id.length === 0) {
		throw new CustomModuleError(
			"id must be a non-empty string of the form `<pack>/<purpose>/<version>`, e.g. `my-oracle/max-ltv/v1`",
		);
	}
	if (args.id.startsWith("/")) {
		throw new CustomModuleError(`id must not start with "/", got ${JSON.stringify(args.id)}`);
	}

	const shortId = shortPackIdFromModuleId(args.id);
	// The short id is used as a Rego dot-path segment (`data.params.<shortId>`,
	// `data.wasm.<shortId>`) AND as a composite-manifest params key. A hyphen makes
	// `data.params.foo-bar` parse in Rego as subtraction, not key access; a dot,
	// space, or uppercase is likewise not a bare-key dot-path; a `__proto__` /
	// `constructor` key corrupts the generated envelope object. Enforce the same
	// snake_case grammar the published packs already follow (all KNOWN_PACK_IDS
	// match it) so a custom module is dot-notation-safe by construction.
	if (!SHORT_ID_RE.test(shortId)) {
		throw new CustomModuleError(
			`custom module id \`${args.id}\` derives short pack id \`${shortId}\`, which is not a valid Rego dot-path segment. A short id must match ${SHORT_ID_RE} (lowercase letter, then lowercase alphanumerics or underscore) so composite Rego can read \`data.params.${shortId}\` / \`data.wasm.${shortId}\` with dot notation. Use snake_case, e.g. \`bizantine_ltv\`.`,
		);
	}
	if (isKnownPackId(shortId)) {
		throw new CustomModuleError(
			`custom module id \`${args.id}\` derives short pack id \`${shortId}\`, which is a published pack in KNOWN_PACK_IDS — a custom module must not claim a published pack's \`data.params.${shortId}\` / \`data.wasm.${shortId}\` namespace. Pick a distinct short id.`,
		);
	}

	for (const [name, schema] of [
		["paramsSchema", args.paramsSchema],
		["wasmArgsSchema", args.wasmArgsSchema],
		["secretsSchema", args.secretsSchema],
	] as const) {
		if (!schema || typeof (schema as { safeParse?: unknown }).safeParse !== "function") {
			throw new CustomModuleError(`${name} must be a zod schema`);
		}
	}

	// `typeof x === "object"` is true for arrays (and would be for null), so guard
	// both. An array slips past a bare object check and `generateCompositeParamsSchema`
	// inlines it as the module's inner schema — an empty array trips no keyword, so
	// the malformed envelope would only fail downstream at attestation time. Reject
	// it here, where the helper promises to fail.
	if (
		!args.paramsJsonSchema ||
		typeof args.paramsJsonSchema !== "object" ||
		Array.isArray(args.paramsJsonSchema)
	) {
		throw new CustomModuleError(
			"paramsJsonSchema is required and must be a JSON Schema object — a custom module must ship the raw params_schema.json its paramsSchema was generated from so it can be composited. See docs/writing-composite-policies.md.",
		);
	}

	if (
		!args.deployments ||
		typeof args.deployments !== "object" ||
		Array.isArray(args.deployments)
	) {
		throw new CustomModuleError(
			"deployments must be a `chainId -> env -> Deployment` object (use `{}` for a module defined before it is deployed anywhere)",
		);
	}

	if (!args.metadata || typeof args.metadata !== "object" || Array.isArray(args.metadata)) {
		throw new CustomModuleError("metadata must be an object with `{ name, version, description }`");
	}
	// Enforce the three keys the message promises (and that `PolicyPack.metadata`
	// requires) - a bare `typeof === object` check would let `metadata: {}` through
	// with undefined name/version/description feeding telemetry + introspection.
	for (const key of ["name", "version", "description"] as const) {
		if (typeof (args.metadata as Record<string, unknown>)[key] !== "string") {
			throw new CustomModuleError(
				`metadata.${key} must be a string — metadata requires \`{ name, version, description }\`.`,
			);
		}
	}

	// Dry-run the exact gate defineComposite runs. Throws MalformedManifestError
	// on a regorus-hostile keyword ($ref, oneOf, format, ...) — surfaced now, not
	// deep in the composite build. Reusing the production path (not a duplicated
	// keyword allowlist) means this check can never drift from real composition.
	generateCompositeParamsSchema({
		modules: [{ id: args.id, paramsJsonSchema: args.paramsJsonSchema }],
	});

	// Reconcile the two params surfaces. `paramsSchema` (zod) gates SDK-side
	// enforcement; `paramsJsonSchema` is inlined verbatim into the on-chain pinned
	// envelope depositors verify. Published packs codegen both from one source so
	// they can't drift; a custom module hand-writes both. If their property sets
	// disagree, SDK-valid params can be denied fail-closed at the AVS, or the
	// on-chain schema misrepresents what is enforced (a verifiability defect). We
	// reconcile the PROPERTY key sets (not `required` - an optional zod field is a
	// legitimate property absent from `required`). Best-effort: only when the zod
	// schema is a ZodObject (exposes `.shape`); opaque schemas (record/union) are
	// skipped since their key set can't be introspected.
	const zodShape = (args.paramsSchema as { shape?: Record<string, unknown> })?.shape;
	if (zodShape && typeof zodShape === "object") {
		const jsonProps =
			(args.paramsJsonSchema as { properties?: Record<string, unknown> }).properties ?? {};
		const zodKeys = Object.keys(zodShape).sort();
		const jsonKeys = Object.keys(jsonProps).sort();
		if (zodKeys.join(",") !== jsonKeys.join(",")) {
			throw new CustomModuleError(
				`paramsSchema (zod) and paramsJsonSchema describe different fields: zod has [${zodKeys.join(", ")}], paramsJsonSchema.properties has [${jsonKeys.join(", ")}]. ` +
					"They must agree - the zod gates SDK validation, the JSON Schema is pinned on-chain; a mismatch means SDK-valid params get denied at the AVS, or the on-chain schema misrepresents what is enforced. Generate both from one source, or align them by hand.",
			);
		}
	}

	const pack: PolicyPack<TParams, TWasmArgs, TSecrets> = {
		id: args.id,
		paramsSchema: args.paramsSchema,
		wasmArgsSchema: args.wasmArgsSchema,
		secretsSchema: args.secretsSchema,
		paramsJsonSchema: args.paramsJsonSchema,
		deployments: args.deployments,
		metadata: args.metadata,
	};
	// Only attach prepareQuery when the caller supplied one, so `"prepareQuery"
	// in pack` stays false for query-less modules (mirrors oracleModuleFromPack,
	// whose OracleModule view omits the key entirely).
	if (args.prepareQuery) {
		return { ...pack, prepareQuery: args.prepareQuery };
	}
	return pack;
}

/**
 * Thrown by {@link defineCustomModule} for a shape-of-args problem: a bad `id`,
 * a short id that collides with a published pack, or a missing schema. Distinct
 * from `CompositeBuilderError` (scoped to `defineComposite`) and
 * `MalformedManifestError` (the regorus-keyword failure, re-thrown from
 * `generateCompositeParamsSchema` as-is so the two paths report identically).
 */
export class CustomModuleError extends Error {
	override readonly name = "CustomModuleError";
}
