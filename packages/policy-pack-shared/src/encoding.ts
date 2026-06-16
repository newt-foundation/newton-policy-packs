import { type Hex, hexToBytes, toHex } from "viem";
import type { z } from "zod";

/**
 * The on-chain `policyParams` byte format is a Newton-protocol invariant. The
 * AVS host reads it as `String::from_utf8 → serde_json::from_str` (see
 * `newton-prover-avs/crates/core/src/common/task.rs:402-408`); the SDK must
 * therefore write **UTF-8 JSON**. Keys are sorted recursively so two
 * semantically-equal params objects always produce byte-identical output —
 * the SDK's `verifyPolicyBinding` does a byte-equality check against
 * `getPolicyConfig().policyParams`, which would otherwise depend on JS
 * `JSON.stringify` insertion order.
 */
export function sortKeysDeep(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortKeysDeep);
	if (value && typeof value === "object") {
		const obj = value as Record<string, unknown>;
		const sorted: Record<string, unknown> = {};
		for (const key of Object.keys(obj).sort()) {
			sorted[key] = sortKeysDeep(obj[key]);
		}
		return sorted;
	}
	return value;
}

/**
 * Encode a pack's params for on-chain storage. Validates against the pack's
 * `paramsSchema` so a curator typo throws here rather than silently writing
 * AVS-rejecting bytes. Returns `Hex` so it drops directly into a viem
 * `setPolicy(bytes)` call.
 */
export function encodePolicyParams<T>(
	pack: { readonly paramsSchema: z.ZodType<T> },
	params: T,
): Hex {
	const validated = pack.paramsSchema.parse(params);
	return toHex(JSON.stringify(sortKeysDeep(validated)));
}

/**
 * Decode `policyParams` bytes read from `getPolicyConfig().policyParams` back
 * into the pack's typed params shape. Revalidates against `paramsSchema` so a
 * stale or corrupted on-chain blob throws at the SDK boundary rather than
 * yielding a partially-valid object that crashes deeper in the call.
 *
 * `fatal: true` matches AVS-side `String::from_utf8` behavior — invalid UTF-8
 * throws here rather than silently becoming U+FFFD and diverging from a path
 * the AVS would reject.
 */
export function decodePolicyParams<T>(
	pack: { readonly paramsSchema: z.ZodType<T> },
	encoded: Hex,
): T {
	const json = new TextDecoder("utf-8", { fatal: true }).decode(hexToBytes(encoded));
	return pack.paramsSchema.parse(JSON.parse(json));
}
