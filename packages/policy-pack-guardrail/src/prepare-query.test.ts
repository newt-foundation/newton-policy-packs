import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import type { PublicClient } from "viem";
import { prepareQuery } from "./prepare-query";

// Guardrail's WASM resolves its lookup target as `vaultAddress ?? protocolId`
// (see `guardrail/policy.js`), so `prepareQuery` must not emit a default
// `vaultAddress` when the caller asks for protocol-level alerts — otherwise the
// `target`-derived vault address silently shadows `protocolId`. These tests pin
// that precedence and the schema's "at least one of protocolId/vaultAddress".

const TARGET = "0x000000000000000000000000000000000000dEaD" as const;
const OVERRIDE_VAULT = "0x00000000000000000000000000000000000a11Ce" as const;

// Minimal `PublicClient` stand-in: `prepareQuery` only reads `chain?.id`.
function clientOnChain(id: number | undefined): PublicClient {
	return { chain: id === undefined ? undefined : { id } } as PublicClient;
}

describe("guardrail prepareQuery", () => {
	it("defaults vaultAddress to the action target when no override is given", async () => {
		const { wasmArgs } = await prepareQuery(
			{ publicClient: clientOnChain(1), target: TARGET },
			undefined,
		);
		assert.equal(wasmArgs.vaultAddress, TARGET);
		assert.equal(wasmArgs.protocolId, undefined);
		assert.equal(wasmArgs.chainId, 1);
	});

	it("screens the protocol when protocolId is the only target option", async () => {
		// Regression: protocolId-only must NOT carry a vaultAddress, or the WASM's
		// `vaultAddress ?? protocolId` would ignore protocolId entirely.
		const { wasmArgs } = await prepareQuery(
			{ publicClient: clientOnChain(1), target: TARGET },
			{ protocolId: "aave-v3" },
		);
		assert.equal(wasmArgs.vaultAddress, undefined);
		assert.equal(wasmArgs.protocolId, "aave-v3");
	});

	it("lets an explicit vaultAddress override win even alongside protocolId", async () => {
		const { wasmArgs } = await prepareQuery(
			{ publicClient: clientOnChain(1), target: TARGET },
			{ protocolId: "aave-v3", vaultAddress: OVERRIDE_VAULT },
		);
		assert.equal(wasmArgs.vaultAddress, OVERRIDE_VAULT);
		assert.equal(wasmArgs.protocolId, "aave-v3");
	});

	it("uses the vaultAddress override over the action target", async () => {
		const { wasmArgs } = await prepareQuery(
			{ publicClient: clientOnChain(1), target: TARGET },
			{ vaultAddress: OVERRIDE_VAULT },
		);
		assert.equal(wasmArgs.vaultAddress, OVERRIDE_VAULT);
		assert.equal(wasmArgs.protocolId, undefined);
	});

	it("prefers the chainId override and omits chainId when no chain is resolvable", async () => {
		const overridden = await prepareQuery(
			{ publicClient: clientOnChain(1), target: TARGET },
			{ chainId: 8453 },
		);
		assert.equal(overridden.wasmArgs.chainId, 8453);

		const noChain = await prepareQuery(
			{ publicClient: clientOnChain(undefined), target: TARGET },
			{ protocolId: "aave-v3" },
		);
		assert.equal(noChain.wasmArgs.chainId, undefined);
		assert.equal(noChain.wasmArgs.protocolId, "aave-v3");
		// Schema's anyOf still holds: protocolId present even with no vault/chain.
	});
});
