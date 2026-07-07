import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyProvenance } from "./provenance";
import { AUDITED_POLICY_DATA } from "./known-pack-provenance.generated";
import { KNOWN_PACK_IDS } from "./known-pack-ids";

const CHAIN = "8453";
const ENV = "prod" as const;
const AUDITED = "0x000000000000000000000000000000000000aaaa";
const OTHER = "0x000000000000000000000000000000000000bbbb";

test("audited: first-party short id + address matches the registry", () => {
	// Requires the generated map to carry vaultsfyi@8453/prod = AUDITED. The test
	// injects that via the override arg so it does not depend on real deployments.
	const p = classifyProvenance({
		shortId: "vaultsfyi",
		resolvedPolicyData: AUDITED,
		chainId: CHAIN,
		env: ENV,
		registry: { vaultsfyi: { [CHAIN]: { prod: AUDITED } } },
	});
	assert.equal(p, "audited");
});

test("custom: short id is not a first-party name", () => {
	const p = classifyProvenance({
		shortId: "bizantine_ltv",
		resolvedPolicyData: OTHER,
		chainId: CHAIN,
		env: ENV,
		registry: { vaultsfyi: { [CHAIN]: { prod: AUDITED } } },
	});
	assert.equal(p, "custom");
});

test("impersonating: first-party name but address does NOT match", () => {
	const p = classifyProvenance({
		shortId: "vaultsfyi",
		resolvedPolicyData: OTHER,
		chainId: CHAIN,
		env: ENV,
		registry: { vaultsfyi: { [CHAIN]: { prod: AUDITED } } },
	});
	assert.equal(p, "impersonating");
});

test("address comparison is case-insensitive", () => {
	const p = classifyProvenance({
		shortId: "vaultsfyi",
		resolvedPolicyData: AUDITED.toUpperCase(),
		chainId: CHAIN,
		env: ENV,
		registry: { vaultsfyi: { [CHAIN]: { prod: AUDITED } } },
	});
	assert.equal(p, "audited");
});

test("first-party name with no registry entry for this chain/env is impersonating", () => {
	// A first-party name whose audited address is unknown on this cell cannot be
	// proven audited, so it must NOT be shown as audited - tag impersonating.
	const p = classifyProvenance({
		shortId: "vaultsfyi",
		resolvedPolicyData: OTHER,
		chainId: "1",
		env: ENV,
		registry: { vaultsfyi: { [CHAIN]: { prod: AUDITED } } },
	});
	assert.equal(p, "impersonating");
});

test("generated AUDITED_POLICY_DATA carries a real prod address for a deployed pack", () => {
	// Non-vacuous: proves gen:bindings populated the map from deployments.json, not
	// just that the classifier logic works. vaultsfyi has prod policyData on 8453
	// (verified in the repo-root deployments.json). If this fails, the generator
	// emitted an empty/wrong cell and the provenance signal is dead on arrival.
	const cell = AUDITED_POLICY_DATA.vaultsfyi?.["8453"]?.prod;
	assert.ok(cell, "vaultsfyi@8453/prod audited address must be present in the generated map");
	assert.match(cell as string, /^0x[0-9a-fA-F]{40}$/, "must be a 20-byte hex address");
});

test("every KNOWN_PACK_IDS entry has a key in the generated map (no missing pack)", () => {
	// The satisfies-clause guarantees this at compile time, but assert at runtime
	// too so a regenerated map that somehow drops a key fails loudly here.
	for (const id of KNOWN_PACK_IDS) {
		assert.ok(id in AUDITED_POLICY_DATA, `generated map missing key: ${id}`);
	}
});
