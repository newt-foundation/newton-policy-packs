import type { Address, Hex, PublicClient } from "viem";
import type { z } from "zod";
import {
	type CompositeManifest,
	decodeManifest,
	isCompositeManifest,
	NotAManifestError,
	NotJsonError,
} from "./composite-manifest";

/**
 * Discriminated dispatch for tools that don't know in advance whether a
 * Shield is bound to a single-pack or a composite policy. Walks the same
 * read path as `introspectComposite` (getPolicyAddress → getPolicyId →
 * getPolicyConfig) and returns either:
 *
 *   { kind: "single-pack", params }
 *   { kind: "composite", manifest }
 *
 * Single-pack `params` is the parsed JSON from `policyParams` bytes,
 * optionally validated through a caller-supplied `paramsSchema`.
 *
 * Throws Phase 1.5 typed errors on malformed bytes:
 *   - `NotJsonError` — bytes don't parse as UTF-8 JSON
 *   - `BadManifestMagicError` / `UnsupportedManifestVersionError` /
 *     `MalformedManifestError` — bytes have `_manifest` but are
 *     structurally invalid (propagated from `decodeManifest`)
 *   - `SinglePackParamsValidationError` — caller supplied a
 *     `paramsSchema` and the parsed params failed validation
 *
 * The dispatcher does NOT silently coerce corrupt bytes into a
 * "single-pack" verdict — every recoverable failure mode has a typed
 * error so depositor UIs render the right "policy is malformed" message.
 *
 * Per `docs/define-composite-spec.md` § "getPolicyManifest discriminated
 * dispatch".
 */

const POLICY_CLIENT_ABI = [
	{
		type: "function",
		name: "getPolicyAddress",
		inputs: [],
		outputs: [{ name: "", type: "address" }],
		stateMutability: "view",
	},
] as const;

const NEWTON_POLICY_ABI = [
	{
		type: "function",
		name: "getPolicyId",
		inputs: [{ name: "client", type: "address" }],
		outputs: [{ name: "", type: "bytes32" }],
		stateMutability: "view",
	},
	{
		type: "function",
		name: "getPolicyConfig",
		inputs: [{ name: "policyId", type: "bytes32" }],
		outputs: [
			{
				type: "tuple",
				components: [
					{ name: "policyId", type: "bytes32" },
					{ name: "policyParams", type: "bytes" },
					{ name: "expireAfter", type: "uint32" },
					{ name: "expireUnit", type: "uint8" },
				],
			},
		],
		stateMutability: "view",
	},
] as const;

export interface GetPolicyManifestArgs<TSinglePackParams = unknown> {
	readonly publicClient: PublicClient;
	readonly shieldAddress: Address;
	/**
	 * Optional single-pack `paramsSchema` (zod). When provided, the
	 * single-pack branch validates the parsed JSON through it and throws
	 * `SinglePackParamsValidationError` on failure; the returned `params`
	 * narrows to the schema's inferred type via the call-site type
	 * parameter `TSinglePackParams`. When omitted, the single-pack branch
	 * returns the parsed JSON as-is (typed `unknown`).
	 */
	readonly singlePackPack?: { readonly paramsSchema: z.ZodType<TSinglePackParams> };
}

export type PolicyManifest<TSinglePackParams = unknown> =
	| { readonly kind: "single-pack"; readonly params: TSinglePackParams }
	| { readonly kind: "composite"; readonly manifest: CompositeManifest };

export async function getPolicyManifest<TSinglePackParams = unknown>({
	publicClient,
	shieldAddress,
	singlePackPack,
}: GetPolicyManifestArgs<TSinglePackParams>): Promise<PolicyManifest<TSinglePackParams>> {
	const policyAddress = (await publicClient.readContract({
		address: shieldAddress,
		abi: POLICY_CLIENT_ABI,
		functionName: "getPolicyAddress",
	})) as Address;
	const policyId = (await publicClient.readContract({
		address: policyAddress,
		abi: NEWTON_POLICY_ABI,
		functionName: "getPolicyId",
		args: [shieldAddress],
	})) as Hex;
	const policyConfig = (await publicClient.readContract({
		address: policyAddress,
		abi: NEWTON_POLICY_ABI,
		functionName: "getPolicyConfig",
		args: [policyId],
	})) as { policyId: Hex; policyParams: Hex; expireAfter: number; expireUnit: number };

	const bytes = policyConfig.policyParams;

	// Composite branch: cheap pre-check, then full decode (which may throw
	// BadManifestMagicError / UnsupportedManifestVersionError /
	// MalformedManifestError for malformed-but-recognizable manifests).
	if (isCompositeManifest(bytes)) {
		return { kind: "composite", manifest: decodeManifest(bytes) };
	}

	// Single-pack branch: parse the bytes as JSON, optionally validate.
	// decodeManifest's NotJsonError + NotAManifestError tell us exactly what
	// went wrong — reuse them rather than re-implementing the parse.
	let parsed: unknown;
	try {
		// decodeManifest throws NotJsonError on non-UTF-8 / non-JSON; it throws
		// NotAManifestError when the JSON parses but lacks `_manifest`. We want
		// the parsed value from the latter case for the single-pack path.
		decodeManifest(bytes);
		// If decodeManifest didn't throw, the bytes are a valid composite manifest
		// — but isCompositeManifest already returned false, so this is unreachable.
		// Still, guard explicitly.
		throw new Error("unreachable: isCompositeManifest=false but decodeManifest succeeded");
	} catch (err) {
		if (err instanceof NotJsonError) {
			throw err;
		}
		if (err instanceof NotAManifestError) {
			parsed = err.parsedJson;
		} else {
			// Composite-typed error (BadManifestMagicError / UnsupportedManifestVersionError /
			// MalformedManifestError) — propagate unchanged. The bytes look like
			// a composite manifest but are structurally invalid; that's not a
			// single-pack situation.
			throw err;
		}
	}

	if (singlePackPack) {
		const result = singlePackPack.paramsSchema.safeParse(parsed);
		if (!result.success) {
			throw new SinglePackParamsValidationError(
				"single-pack params failed paramsSchema validation",
				result.error.issues,
				parsed,
			);
		}
		return { kind: "single-pack", params: result.data };
	}

	// No paramsSchema provided — caller chose to skip validation. The parsed
	// value is typed `unknown` at the SDK boundary, but the call-site type
	// parameter `TSinglePackParams` narrows to whatever the caller passed.
	// When `TSinglePackParams = unknown` (the default), this is just `unknown`
	// at the API surface. When the caller explicitly types it, they're
	// declaring trust in the bytes — which is their choice.
	return { kind: "single-pack", params: parsed as TSinglePackParams };
}

/**
 * Caller supplied a `singlePackPack.paramsSchema` and the parsed
 * single-pack `policyParams` failed validation. `err.zodIssues` carries
 * the offending issues; `err.parsedJson` is the raw parsed value for
 * callers needing to surface the bad input.
 */
export class SinglePackParamsValidationError extends Error {
	override readonly name = "SinglePackParamsValidationError";
	constructor(
		message: string,
		readonly zodIssues: ReadonlyArray<z.ZodIssue>,
		readonly parsedJson: unknown,
	) {
		super(message);
	}
}
