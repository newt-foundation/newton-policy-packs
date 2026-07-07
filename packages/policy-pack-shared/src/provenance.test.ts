import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyProvenance } from "./provenance";

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
