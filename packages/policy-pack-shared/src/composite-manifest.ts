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

	const params = obj.params;
	if (!params || typeof params !== "object" || Array.isArray(params)) {
		throw new MalformedManifestError("`params` must be an object keyed by module id");
	}
	const declaredIds = new Set(decodedModules.map((m) => m.id));
	const paramKeys = Object.keys(params);
	for (const id of declaredIds) {
		if (!paramKeys.includes(id)) {
			throw new MalformedManifestError(
				`params[${JSON.stringify(id)}] missing — every module declared in modules[] MUST have a params entry, even if it's {}`,
			);
		}
	}
	for (const k of paramKeys) {
		if (!declaredIds.has(k)) {
			throw new MalformedManifestError(
				`params[${JSON.stringify(k)}] declared but no matching module in modules[]`,
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
 */
export function encodeCompositeParams(
	pack: MinimalCompositePack,
	params: Record<string, unknown>,
): Hex {
	const modulesEncoded = pack.modules.map((module) => {
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

	const validatedParams: Record<string, unknown> = {};
	for (const module of pack.modules) {
		if (!(module.id in params)) {
			throw new CompositeParamsValidationError(
				`params[${JSON.stringify(module.id)}] missing — every module MUST have a params entry, even if {}`,
				module.id,
				[],
			);
		}
		const result = module.paramsSchema.safeParse(params[module.id]);
		if (!result.success) {
			throw new CompositeParamsValidationError(
				`params for module \`${module.id}\` failed schema validation`,
				module.id,
				result.error.issues,
			);
		}
		validatedParams[module.id] = result.data;
	}
	for (const k of Object.keys(params)) {
		if (!pack.modules.some((m) => m.id === k)) {
			throw new CompositeParamsValidationError(
				`params[${JSON.stringify(k)}] declared but no matching module in pack.modules`,
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
