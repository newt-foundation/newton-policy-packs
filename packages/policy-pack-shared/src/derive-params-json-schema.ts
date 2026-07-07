import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { generateCompositeParamsSchema, MalformedManifestError } from "./composite-manifest";

/**
 * Thrown by {@link deriveParamsJsonSchema} when the zod `paramsSchema` derives a
 * JSON Schema that uses a keyword newton-rego cannot parse (e.g. a `.datetime()` /
 * `.url()` / `.ip()` refinement produced `format`). This turns a fail-closed-at-
 * attestation surprise into a fail-at-authoring error - a DX win. The message
 * carries the underlying gate error plus the fix hint.
 */
export class ParamsSchemaDerivationError extends Error {
	override readonly name = "ParamsSchemaDerivationError";
	constructor(
		message: string,
		override readonly cause?: unknown,
	) {
		super(message);
	}
}

/**
 * Derive a regorus-clean `paramsJsonSchema` from a pack's zod `paramsSchema`.
 * This is the one-source-of-truth derivation: the zod schema is authoritative,
 * the JSON Schema is generated + gated at construction so a custom author writes
 * ONE schema and can't drift the two apart.
 *
 * Configuration (verified empirically against zod-to-json-schema 3.25.2, not
 * assumed):
 * - `$refStrategy: "none"` - regorus does not support `$ref`; inline everything.
 * - strip the root `$schema` - zod-to-json-schema emits it and it is not in the
 *   regorus keyword allowlist.
 * - `emailStrategy: "pattern:zod"` - renders `z.string().email()` as an
 *   allowlisted `pattern` (NOT `format`), so an email refinement passes. PROVEN.
 *
 * IMPORTANT - what does NOT convert (measured, do not overclaim): `dateStrategy`
 * applies to `z.date()`, NOT `z.string().datetime()`. A `z.string().datetime()`
 * refinement routes through the string parser and STILL emits `format:"date-time"`;
 * likewise `z.string().url()` -> `format:"uri"` and `z.string().ip()` -> `format`.
 * All three are rejected by the gate below - which is the CORRECT fail-closed
 * behavior (a fail-at-authoring error, not a fail-closed-at-attestation surprise),
 * but they are hard-fails, not silent conversions. Author params with plain
 * `.string()` / `.string().regex(...)` for those shapes. (`dateStrategy: "string"`
 * is kept only because it is harmless for any `z.date()` a pack might use.)
 *
 * Then GATE: run the derived schema through the exact production gate the
 * composite uses (`generateCompositeParamsSchema` -> `assertRegorusSupportedKeywords`)
 * so a rejected keyword throws HERE, not at attestation. Reusing the production
 * gate (not a duplicated allowlist) means this check can never drift from real
 * composition.
 *
 * @throws {ParamsSchemaDerivationError} when a refinement produced a keyword the
 *   regorus gate rejects (e.g. `.datetime()`/`.url()`/`.ip()` -> `format`).
 */
export function deriveParamsJsonSchema(
	paramsSchema: z.ZodType<unknown>,
	ctx: { id: string },
): object {
	const derived = zodToJsonSchema(paramsSchema, {
		$refStrategy: "none",
		emailStrategy: "pattern:zod",
		dateStrategy: "string",
	}) as Record<string, unknown>;
	// zod-to-json-schema emits a root `$schema` marker; regorus rejects it.
	delete derived.$schema;

	// Dry-run the exact gate the composite runs. It throws MalformedManifestError
	// on a regorus-hostile keyword. Wrap it with authoring guidance so the pack
	// author knows which refinement to change.
	try {
		generateCompositeParamsSchema({ modules: [{ id: ctx.id, paramsJsonSchema: derived }] });
	} catch (err) {
		if (err instanceof MalformedManifestError) {
			throw new ParamsSchemaDerivationError(
				`params schema for \`${ctx.id}\` derives a JSON Schema newton-rego cannot parse: ${err.message} ` +
					"A zod refinement (e.g. .datetime()/.url()/.ip()) produced an unsupported `format` keyword. " +
					"Use a plain .string() or .string().regex(...) shape instead so the derived schema stays regorus-clean.",
				err,
			);
		}
		throw err;
	}
	return derived;
}
