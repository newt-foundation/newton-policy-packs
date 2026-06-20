import { type Address, getAddress, type Hex, hexToBytes, toHex } from "viem";
import type { ZodIssue } from "zod";
import { sortKeysDeep } from "./encoding";
import type { OracleModule } from "./oracle-module";

/**
 * Composite-policy manifest format. Phase 1.5 of the composite-policy rollout
 * (NEWT-1541). Full byte-level spec: `docs/composite-manifest-spec.md`.
 *
 * The manifest is the on-chain `policyParams` blob a Shield clone writes via
 * `setPolicy(policyParams, expireAfter)` when it's bound to a composite
 * `NewtonPolicy`. Single UTF-8 JSON object (NOT an ABI tuple) so the AVS host's
 * existing `serde_json::from_str` decoder consumes it without protocol-level
 * changes (NEWT-1516). The `_manifest` key namespace is reserved; its presence
 * is the discriminator between flat single-pack params and a composite
 * manifest.
 *
 * Read path:
 *   - `decodeManifest(bytes)` — pure decoder, no on-chain calls.
 *   - `isCompositeManifest(bytes)` — cheap pre-check returning a boolean.
 *   - `introspectComposite({ publicClient, shieldAddress })` — depositor
 *      verification helper that walks `getPolicyAddress` → `getPolicyId` →
 *      `getPolicyConfig` → `decodeManifest` → on-chain `getPolicyData()` and
 *      `getWasmCid()` checks. Lives in `composite-introspect.ts`.
 *
 * Write path (Phase 1.5 ships the encoder so round-trip tests can exist
 * without waiting for Phase 2's `defineComposite` builder):
 *   - `encodeCompositeParams(pack, params)` — validates each `params[id]`
 *      against its module's `paramsSchema` and emits canonical-form bytes.
 */
export const MANIFEST_MAGIC = "NPM1" as const;
export const MANIFEST_MAX_SUPPORTED_VERSION = 1 as const;

/**
 * The `OracleModule.id` is `<pack>/<purpose>/<version>` (e.g.
 * `"vaultsfyi/risk-envelope/v1"`) — a unique identifier that survives multiple
 * versions or purposes of the same pack. The MANIFEST `params` map keys, by
 * contrast, are SHORT pack ids (`"vaultsfyi"`) — the same identifier
 * `wrapOutput("vaultsfyi", ...)` uses for `data.wasm.vaultsfyi` Phase 0
 * namespacing. Symmetric across the AVS-side namespaces:
 *
 *   data.wasm.<short-id>.<field>     // WASM oracle output (Phase 0)
 *   data.params.<short-id>.<field>   // composite manifest params (Phase 1.5)
 *
 * Keeping `params` keys short lets composite Rego authors use plain dot
 * notation (`data.params.vaultsfyi.risk_score_floor`) instead of
 * bracket-on-slashes (`data.params["vaultsfyi/risk-envelope/v1"].risk_score_floor`),
 * and matches the `composite-policies.md` Rego authoring guide.
 *
 * `manifest.modules[].id` keeps the FULL pack id for traceability —
 * cross-referencing `OracleModule.id` directly is what depositor introspection
 * uses to look up each module's published artifacts.
 */
export function shortPackIdFromModuleId(moduleId: string): string {
	if (typeof moduleId !== "string" || moduleId.length === 0) {
		throw new MalformedManifestError(
			`module id must be a non-empty string, got ${JSON.stringify(moduleId)}`,
		);
	}
	if (moduleId.startsWith("/")) {
		throw new MalformedManifestError(
			`module id must not start with "/", got ${JSON.stringify(moduleId)}`,
		);
	}
	const slash = moduleId.indexOf("/");
	const shortId = slash === -1 ? moduleId : moduleId.slice(0, slash);
	if (shortId.length === 0) {
		throw new MalformedManifestError(
			`derived short pack id is empty for module id ${JSON.stringify(moduleId)}`,
		);
	}
	return shortId;
}

/**
 * The minimal module shape `generateCompositeParamsSchema` reads: a full
 * module id (to derive the short `params` key) and the module's raw inner
 * params JSON Schema (inlined verbatim under `params.<shortId>`). Both
 * `OracleModule` and `PolicyPack` satisfy this via their `paramsJsonSchema`
 * field, so callers can pass either.
 */
interface ParamsSchemaModule {
	readonly id: string;
	readonly paramsJsonSchema: object;
}

/**
 * Deep-clone a JSON-Schema value through `structuredClone`. We inline each
 * module's `paramsJsonSchema` into the envelope; cloning prevents the
 * generated object from aliasing the (frozen `as const`) source literal, so a
 * downstream consumer that mutates the result can't corrupt a pack's exported
 * schema constant. `structuredClone` is in Node ≥17 — the package's runtime
 * floor — and JSON Schemas are plain JSON, so it round-trips losslessly.
 */
function cloneJsonSchema(schema: object): object {
	return structuredClone(schema) as object;
}

/**
 * Build the JSON Schema that describes the on-chain composite-manifest
 * ENVELOPE `encodeCompositePolicyPack` writes — i.e. the literal
 * `{ _manifest, modules, params }` blob, NOT the inner per-module params.
 *
 * This is the schema a curator pins on the composite `NewtonPolicy` (via
 * `setPolicy({ policyParams: <schema>, ... })`'s pinned-schema slot). It MUST
 * describe the whole manifest because the AVS validates the raw on-chain
 * `policyParams` bytes AS-IS against the pinned schema — it does NOT unwrap the
 * `_manifest` envelope first (newton-prover-avs `task.rs` /
 * `rego-kernel/src/rego.rs`). A hand-written per-example schema that described
 * only the inner params produced the mainnet failure
 * `Missing required property 'vaultsfyi' at ''` — the validator saw `_manifest`
 * / `modules` / `params` at the root, not `vaultsfyi`. Deriving the envelope
 * schema from the same modules the encoder uses removes that drift.
 *
 * Regorus support note: the emitted schema uses only keywords regorus's
 * `Schema::from_serde_json_value` accepts (`type`, `required`, `properties`,
 * `additionalProperties`, `const`, `items`, `minItems`, `minimum`, `maximum`,
 * `enum`, `anyOf`, `allOf`). Each module's inner schema is INLINED (no `$ref`,
 * which regorus does not support) and no `$schema` marker is emitted. The
 * inner schemas come from each pack's regorus-clean `params_schema.json`, so
 * the inlined result stays regorus-clean too.
 *
 * The `params` key for each module is its SHORT pack id
 * (`shortPackIdFromModuleId(module.id)`), matching what the encoder writes and
 * what composite Rego reads as `data.params.<shortId>`.
 *
 * @param pack - any object exposing `modules` with `{ id, paramsJsonSchema }`.
 *   Both `MinimalCompositePack`'s `OracleModule[]` and a raw `OracleModule[]`
 *   wrapper satisfy it.
 * @returns the envelope JSON Schema as a plain object, ready to ABI-/JSON-encode
 *   into the policy's pinned-schema slot.
 */
export function generateCompositeParamsSchema(pack: {
	readonly modules: ReadonlyArray<ParamsSchemaModule>;
}): object {
	if (pack.modules.length === 0) {
		throw new MalformedManifestError(
			"pack.modules is empty — a composite params schema must describe at least one module",
		);
	}

	const paramsProperties: Record<string, object> = {};
	const paramsRequired: string[] = [];
	const seenShortIds = new Set<string>();
	for (const module of pack.modules) {
		const shortId = shortPackIdFromModuleId(module.id);
		if (seenShortIds.has(shortId)) {
			throw new MalformedManifestError(
				`duplicate short pack id \`${shortId}\` derived from module id \`${module.id}\` — two modules share the same short id, which would make params.${shortId} ambiguous`,
			);
		}
		seenShortIds.add(shortId);
		// Inline the module's inner params schema verbatim (deep-cloned, no
		// `$ref`). This is the canonical schema the pack's zod was generated
		// from, so the envelope describes exactly what the encoder validated.
		paramsProperties[shortId] = cloneJsonSchema(module.paramsJsonSchema);
		paramsRequired.push(shortId);
	}

	return {
		type: "object",
		additionalProperties: false,
		required: ["_manifest", "modules", "params"],
		properties: {
			_manifest: {
				type: "object",
				required: ["magic", "version"],
				properties: {
					magic: { const: MANIFEST_MAGIC },
					version: { type: "integer", minimum: 1, maximum: MANIFEST_MAX_SUPPORTED_VERSION },
				},
			},
			modules: {
				type: "array",
				minItems: 1,
				items: {
					type: "object",
					required: ["id", "policyDataAddress", "wasmCid"],
					properties: {
						id: { type: "string" },
						policyDataAddress: { type: "string" },
						wasmCid: { type: "string" },
					},
				},
			},
			params: {
				type: "object",
				additionalProperties: false,
				required: paramsRequired,
				properties: paramsProperties,
			},
		},
	};
}

export interface CompositeManifest {
	readonly magic: typeof MANIFEST_MAGIC;
	readonly version: number;
	readonly modules: ReadonlyArray<{
		readonly id: string;
		readonly policyDataAddress: Address;
		readonly wasmCid: string;
	}>;
	readonly params: Readonly<Record<string, unknown>>;
}

/**
 * Minimal `CompositePolicyPack` shape `encodeCompositeParams` needs in Phase
 * 1.5. Phase 2's `defineComposite(...)` produces a richer `CompositePolicyPack`
 * carrying cached on-chain state and aggregated `prepareQuery`; the encoder's
 * signature stays unchanged.
 *
 * Fields:
 * - `modules` — ordered, position-significant per `PolicyValidationLib.sol:51-57`.
 *   The order MUST match the on-chain `INewtonPolicy.getPolicyData()` array;
 *   `defineComposite` enforces this at construction time. The encoder takes
 *   the array as-is — it can't validate ordering without an `INewtonPolicy`
 *   reference, which is `defineComposite`'s job, not the encoder's.
 * - `chainId` and `env` — used to look up each module's deployed
 *   `policyDataAddress` and `wasmCid` from `module.deployments[chainId][env]`.
 *   Throws `UnsupportedChainError` / `UnsupportedEnvError` (re-exported from
 *   `pack.ts`) on cell mismatch.
 */
export interface MinimalCompositePack {
	readonly modules: ReadonlyArray<OracleModule<unknown, unknown, unknown>>;
	readonly chainId: string;
	readonly env: "stagef" | "prod";
}

/**
 * Cheap pre-check. Parses bytes as UTF-8 JSON and returns `true` iff the
 * payload has a `_manifest.magic === "NPM1"` field. Useful for tools
 * dispatching between single-pack and composite paths without throwing.
 *
 * Returns `false` for non-JSON bytes, JSON without `_manifest`, or `_manifest`
 * with the wrong magic value. Does NOT throw.
 */
export function isCompositeManifest(encoded: Hex): boolean {
	let parsed: unknown;
	try {
		const json = new TextDecoder("utf-8", { fatal: true }).decode(hexToBytes(encoded));
		parsed = JSON.parse(json);
	} catch {
		return false;
	}
	if (!parsed || typeof parsed !== "object") return false;
	const obj = parsed as Record<string, unknown>;
	const manifest = obj._manifest;
	if (!manifest || typeof manifest !== "object") return false;
	return (manifest as { magic?: unknown }).magic === MANIFEST_MAGIC;
}

/**
 * Decode a composite manifest from `policyParams` bytes. Pure decoder; no
 * on-chain calls. See `composite-manifest-spec.md` § "Decoder API" for the
 * error semantics.
 */
export function decodeManifest(encoded: Hex): CompositeManifest {
	let raw: string;
	try {
		raw = new TextDecoder("utf-8", { fatal: true }).decode(hexToBytes(encoded));
	} catch (cause) {
		throw new NotJsonError(
			"composite manifest bytes are not valid UTF-8 — probably an unrelated tool wrote this blob",
			{ cause },
		);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (cause) {
		throw new NotJsonError(
			"composite manifest bytes do not parse as JSON — probably an unrelated tool wrote this blob",
			{ cause },
		);
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new NotAManifestError(
			"top-level JSON value is not an object — probably a single-pack params blob",
			parsed,
		);
	}
	const obj = parsed as Record<string, unknown>;
	if (!("_manifest" in obj)) {
		throw new NotAManifestError(
			"`_manifest` key absent — probably a single-pack params blob; call `pack.paramsSchema.parse(err.parsedJson)` to handle the single-pack case",
			parsed,
		);
	}
	const manifest = obj._manifest;
	if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
		throw new MalformedManifestError("`_manifest` is not an object");
	}
	const m = manifest as Record<string, unknown>;
	if (m.magic !== MANIFEST_MAGIC) {
		throw new BadManifestMagicError(
			`expected _manifest.magic = "${MANIFEST_MAGIC}", got ${JSON.stringify(m.magic)}`,
			m.magic,
		);
	}
	if (typeof m.version !== "number" || !Number.isInteger(m.version) || m.version < 1) {
		throw new MalformedManifestError(
			`_manifest.version must be a positive integer, got ${JSON.stringify(m.version)}`,
		);
	}
	if (m.version > MANIFEST_MAX_SUPPORTED_VERSION) {
		throw new UnsupportedManifestVersionError(
			`manifest version ${m.version} is past this SDK's max supported version (${MANIFEST_MAX_SUPPORTED_VERSION}); upgrade @newton-xyz/policy-pack-shared`,
			m.version,
			MANIFEST_MAX_SUPPORTED_VERSION,
		);
	}

	const modules = obj.modules;
	if (!Array.isArray(modules) || modules.length === 0) {
		throw new MalformedManifestError("`modules` must be a non-empty array");
	}
	const decodedModules = modules.map((mod, i) => {
		if (!mod || typeof mod !== "object") {
			throw new MalformedManifestError(`modules[${i}] is not an object`);
		}
		const e = mod as Record<string, unknown>;
		if (typeof e.id !== "string" || e.id.length === 0) {
			throw new MalformedManifestError(`modules[${i}].id missing or not a non-empty string`);
		}
		if (typeof e.policyDataAddress !== "string") {
			throw new MalformedManifestError(`modules[${i}].policyDataAddress must be a string`);
		}
		// `getAddress(...)` throws on malformed addresses with viem's
		// InvalidAddressError. Re-wrap so callers get a manifest-specific class
		// that carries the offending position.
		let normalized: Address;
		try {
			normalized = getAddress(e.policyDataAddress);
		} catch (cause) {
			throw new MalformedManifestError(
				`modules[${i}].policyDataAddress is not a valid address: ${e.policyDataAddress}`,
				{ cause },
			);
		}
		if (typeof e.wasmCid !== "string" || e.wasmCid.length === 0) {
			throw new MalformedManifestError(`modules[${i}].wasmCid missing or not a non-empty string`);
		}
		return { id: e.id, policyDataAddress: normalized, wasmCid: e.wasmCid };
	});

	// Reject duplicate module IDs. With duplicates, `params[id]` is ambiguous
	// (which module owns it?) and Set-based validation can't tell us which
	// duplicate to keep. Defense in depth — the encoder rejects this too, but
	// bytes might come from a non-SDK writer.
	const seenDecodedIds = new Set<string>();
	for (const m of decodedModules) {
		if (seenDecodedIds.has(m.id)) {
			throw new MalformedManifestError(
				`duplicate module id \`${m.id}\` in modules[] — every module MUST have a unique id`,
			);
		}
		seenDecodedIds.add(m.id);
	}

	const params = obj.params;
	if (!params || typeof params !== "object" || Array.isArray(params)) {
		throw new MalformedManifestError(
			'`params` must be an object keyed by short pack id (e.g. `"vaultsfyi"`)',
		);
	}
	// `params` keys are SHORT pack ids derived from each module's full id via
	// shortPackIdFromModuleId. See encoder + the comment on that helper.
	const declaredShortIds = new Set(decodedModules.map((m) => shortPackIdFromModuleId(m.id)));
	if (declaredShortIds.size !== decodedModules.length) {
		throw new MalformedManifestError(
			"two modules in modules[] share the same short pack id — would make data.params.<shortId> ambiguous in Rego",
		);
	}
	const paramKeys = Object.keys(params);
	for (const shortId of declaredShortIds) {
		if (!paramKeys.includes(shortId)) {
			throw new MalformedManifestError(
				`params[${JSON.stringify(shortId)}] missing — every module declared in modules[] MUST have a params entry under its short pack id, even if it's {}`,
			);
		}
	}
	for (const k of paramKeys) {
		if (!declaredShortIds.has(k)) {
			throw new MalformedManifestError(
				`params[${JSON.stringify(k)}] declared but no matching short pack id in modules[]`,
			);
		}
	}

	return {
		magic: MANIFEST_MAGIC,
		version: m.version,
		modules: decodedModules,
		params: params as Record<string, unknown>,
	};
}

/**
 * Optional per-module historical-binding override for `encodeCompositeParams`.
 * When provided, the encoder emits these `policyDataAddress` / `wasmCid`
 * values into the manifest INSTEAD of looking them up from each module's
 * `deployments` map.
 *
 * Used by Phase 2's `defineComposite` historical-pin path — when a curator
 * pinned an existing composite to its on-chain `getPolicyData()` snapshot
 * (because a pack redeployed and the current `module.deployments[chainId][env]`
 * no longer matches), the encoder must emit those pinned addresses, not the
 * fresh ones. Without this propagation, the historical pin only validates
 * but doesn't survive into the encoded manifest, defeating the mechanism.
 *
 * Caller (Phase 2 `defineComposite`) is responsible for verifying the
 * historical bindings match on-chain state via `getWasmCid()` BEFORE passing
 * them in. This parameter is the "trust-the-caller" hatch; the encoder
 * doesn't re-verify.
 */
export interface HistoricalBinding {
	readonly policyDataAddress: Address;
	readonly wasmCid: string;
}

/**
 * Encode a composite manifest from a `MinimalCompositePack` + per-module
 * params. Validates each `params[id]` against its module's `paramsSchema`
 * before emitting bytes; throws `CompositeParamsValidationError` on schema
 * mismatch.
 *
 * Mirrors `encodePolicyParams(pack, params)` for single-pack params: same
 * sorted-key canonical form, same `Hex` return shape ready for a viem
 * `setPolicy(bytes)` call.
 *
 * Requires every module declared in `pack.modules` to have a corresponding
 * entry in `params` (use `{}` for keyless packs like balancer / redstone).
 * The strict policy is documented in `composite-manifest-spec.md` § "params"
 * — catches a class of partial-write bugs.
 *
 * `historicalBindings` (optional) — Phase 2 historical-pin override. When
 * provided, must have the same length as `pack.modules` and is consumed
 * positionally. Each `historicalBindings[i]` overrides the
 * `module.deployments` lookup for `pack.modules[i]`.
 */
export function encodeCompositeParams(
	pack: MinimalCompositePack,
	params: Record<string, unknown>,
	historicalBindings?: ReadonlyArray<HistoricalBinding>,
): Hex {
	// Reject empty `pack.modules` so the encoder never produces bytes that the
	// decoder will reject. Round-trip invariant — a manifest with zero modules
	// is meaningless (composites are length N≥1; single-pack policies don't
	// use this code path at all).
	if (pack.modules.length === 0) {
		throw new CompositeParamsValidationError(
			"pack.modules is empty — a composite manifest must declare at least one module",
			"",
			[],
		);
	}
	// Reject duplicate module IDs. With duplicates, `params[id]` is ambiguous
	// and `validatedParams[id]` overwrites silently, so the encoded manifest
	// drops one set of validated params. Catch it here, not in the decoder
	// where the bytes are already on-chain.
	const seenIds = new Set<string>();
	for (const module of pack.modules) {
		if (seenIds.has(module.id)) {
			throw new CompositeParamsValidationError(
				`duplicate module id \`${module.id}\` in pack.modules — every module MUST have a unique id`,
				module.id,
				[],
			);
		}
		seenIds.add(module.id);
	}
	if (historicalBindings && historicalBindings.length !== pack.modules.length) {
		throw new CompositeParamsValidationError(
			`historicalBindings.length (${historicalBindings.length}) must equal pack.modules.length (${pack.modules.length})`,
			"",
			[],
		);
	}
	const modulesEncoded = pack.modules.map((module, i) => {
		// Historical-pin path: bypass module.deployments and use the pinned
		// values verbatim. defineComposite has already verified each pinned
		// address against on-chain getWasmCid(); the encoder trusts that
		// verification.
		if (historicalBindings) {
			const binding = historicalBindings[i];
			// biome-ignore lint/style/noNonNullAssertion: length checked above
			return {
				id: module.id,
				policyDataAddress: getAddress(binding!.policyDataAddress),
				wasmCid: binding!.wasmCid,
			};
		}
		const perEnv = module.deployments[pack.chainId];
		if (!perEnv) {
			throw new ManifestDeploymentMissingError(
				`module \`${module.id}\` has no deployment on chain ${pack.chainId}`,
				module.id,
				pack.chainId,
				pack.env,
			);
		}
		const deployment = perEnv[pack.env];
		if (!deployment) {
			throw new ManifestDeploymentMissingError(
				`module \`${module.id}\` is deployed on chain ${pack.chainId} but not in env "${pack.env}"`,
				module.id,
				pack.chainId,
				pack.env,
			);
		}
		return {
			id: module.id,
			policyDataAddress: getAddress(deployment.policyData),
			wasmCid: deployment.wasmCid,
		};
	});

	// `params` keyed by SHORT pack id (e.g. `"vaultsfyi"`), NOT full module id
	// (`"vaultsfyi/risk-envelope/v1"`). See shortPackIdFromModuleId for the
	// rationale. Two modules sharing the same short id at composite time would
	// collide here — defense against that is in Phase 2 (KNOWN_PACK_IDS), but
	// catch the symptom now: if encoding finds a collision, fail loudly.
	const validatedParams: Record<string, unknown> = {};
	const shortIds = new Set<string>();
	for (const module of pack.modules) {
		const shortId = shortPackIdFromModuleId(module.id);
		if (shortIds.has(shortId)) {
			throw new CompositeParamsValidationError(
				`duplicate short pack id \`${shortId}\` derived from module id \`${module.id}\` — two modules share the same short id, which would make data.params.${shortId} ambiguous in Rego`,
				module.id,
				[],
			);
		}
		shortIds.add(shortId);
		if (!(shortId in params)) {
			throw new CompositeParamsValidationError(
				`params[${JSON.stringify(shortId)}] missing — every module MUST have a params entry under its short pack id, even if {}`,
				module.id,
				[],
			);
		}
		const result = module.paramsSchema.safeParse(params[shortId]);
		if (!result.success) {
			throw new CompositeParamsValidationError(
				`params for module \`${module.id}\` (short id \`${shortId}\`) failed schema validation`,
				module.id,
				result.error.issues,
			);
		}
		validatedParams[shortId] = result.data;
	}
	for (const k of Object.keys(params)) {
		if (!shortIds.has(k)) {
			throw new CompositeParamsValidationError(
				`params[${JSON.stringify(k)}] declared but no matching short pack id in pack.modules`,
				k,
				[],
			);
		}
	}

	const manifest = {
		_manifest: { magic: MANIFEST_MAGIC, version: MANIFEST_MAX_SUPPORTED_VERSION },
		modules: modulesEncoded,
		params: validatedParams,
	};
	return toHex(JSON.stringify(sortKeysDeep(manifest)));
}

/**
 * Bytes don't parse as UTF-8 JSON. The blob was probably written by an
 * unrelated tool. Distinct from `NotAManifestError` so the "try single-pack
 * recovery" hint doesn't crash on truly non-JSON input.
 */
export class NotJsonError extends Error {
	override readonly name = "NotJsonError";
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
	}
}

/**
 * JSON parses but the `_manifest` key is absent. The blob is probably a
 * single-pack flat-JSON params blob. `err.parsedJson` carries the parsed
 * value so the caller can pass it to `pack.paramsSchema.parse(err.parsedJson)`
 * without re-invoking `JSON.parse`.
 */
export class NotAManifestError extends Error {
	override readonly name = "NotAManifestError";
	constructor(
		message: string,
		readonly parsedJson: unknown,
	) {
		super(message);
	}
}

/**
 * `_manifest.magic` is present but not `"NPM1"`. The blob was written by an
 * unrelated tool that happens to use the same `_manifest` key.
 */
export class BadManifestMagicError extends Error {
	override readonly name = "BadManifestMagicError";
	constructor(
		message: string,
		readonly actualMagic: unknown,
	) {
		super(message);
	}
}

/**
 * `_manifest.version` is past the SDK's max supported version. Upgrade
 * `@newton-xyz/policy-pack-shared` to read this manifest.
 */
export class UnsupportedManifestVersionError extends Error {
	override readonly name = "UnsupportedManifestVersionError";
	constructor(
		message: string,
		readonly version: number,
		readonly maxSupported: number,
	) {
		super(message);
	}
}

/**
 * Post-magic structural validation failed (missing field, wrong type, etc.).
 * Usually a `defineComposite` (Phase 2) bug — fix the writer.
 */
export class MalformedManifestError extends Error {
	override readonly name = "MalformedManifestError";
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
	}
}

/**
 * `encodeCompositeParams` failed schema validation on one of the
 * `params[id]` entries (or the entry was missing for a declared module, or an
 * extra entry was passed for an undeclared module). `err.zodIssues` carries
 * the offending issues from the underlying `safeParse` failure.
 */
export class CompositeParamsValidationError extends Error {
	override readonly name = "CompositeParamsValidationError";
	constructor(
		message: string,
		readonly moduleId: string,
		readonly zodIssues: ReadonlyArray<ZodIssue>,
	) {
		super(message);
	}
}

/**
 * `encodeCompositeParams` couldn't find a `(chainId, env)` deployment for one
 * of the modules in `pack.modules`. Distinct from
 * `UnsupportedChainError` / `UnsupportedEnvError` (which come from
 * `getDeployment`) because the recovery is the same: the curator either picked
 * the wrong cell, or one of the modules hasn't been deployed there yet — fix
 * the cell or remove the module from the composite.
 */
export class ManifestDeploymentMissingError extends Error {
	override readonly name = "ManifestDeploymentMissingError";
	constructor(
		message: string,
		readonly moduleId: string,
		readonly chainId: string,
		readonly env: "stagef" | "prod",
	) {
		super(message);
	}
}
