import { generateCompositeParamsSchema, shortPackIdFromModuleId } from "./composite-manifest";
import { isKnownPackId } from "./known-pack-ids";
import type { PolicyPack } from "./pack";

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
 * - the derived short pack id is NOT in `KNOWN_PACK_IDS` — a custom module must
 *   not claim a published pack's `data.params.<shortId>` / `data.wasm.<shortId>`
 *   namespace.
 * - the three zod schemas are present.
 * - `paramsJsonSchema` is present AND survives the exact gate
 *   `generateCompositeParamsSchema` runs (`assertRegorusSupportedKeywords`), so
 *   a `$ref` / `oneOf` / `format` keyword that passes `opa test` and zod but
 *   fails-closed at the AVS is caught now. This reuses the production path
 *   rather than duplicating the keyword allowlist, so the two can't drift.
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
		throw new CustomModuleError(
			"metadata must be an object with at least `{ name, version, description }`",
		);
	}

	// Dry-run the exact gate defineComposite runs. Throws MalformedManifestError
	// on a regorus-hostile keyword ($ref, oneOf, format, ...) — surfaced now, not
	// deep in the composite build. Reusing the production path (not a duplicated
	// keyword allowlist) means this check can never drift from real composition.
	generateCompositeParamsSchema({
		modules: [{ id: args.id, paramsJsonSchema: args.paramsJsonSchema }],
	});

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
