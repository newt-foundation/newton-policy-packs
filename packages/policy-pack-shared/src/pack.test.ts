import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { z } from "zod";
import type { Deployment, GatewayEnv, PolicyPack } from "./index";
import { getDeployment, UnsupportedChainError, UnsupportedEnvError } from "./index";

const STAGEF_BALANCER: Deployment = {
	policy: "0x9EE0B769E62aEEa3282396ee7a4D5B16119De14C",
	policyData: "0x4b1c450b1DA523EdB0C2aB0c905267281d36cb7c",
	wasmCid: "bafybeibb4rxzaqaolsqmc7kymnr34a3vj6bo6xfom5cggr4ouyqahlspvu",
	policyCodeHash: "0x5ec04403a9345b012b891ce29b0c291736ef98d1f50901739b563246af05ed29",
	deployedAt: "2026-06-14",
	notes: "Phase 0 Stream D",
};

const PROD_BALANCER: Deployment = {
	policy: "0x1111111111111111111111111111111111111111",
	policyData: "0x2222222222222222222222222222222222222222",
	wasmCid: "bafybeiprodprodprodprodprodprodprodprodprodprodprodprod",
	policyCodeHash: "0x3333333333333333333333333333333333333333333333333333333333333333",
	deployedAt: "2026-06-14",
	notes: "synthetic prod fixture",
};

function makePack(
	deployments: Readonly<Partial<Record<string, Readonly<Partial<Record<GatewayEnv, Deployment>>>>>>,
): PolicyPack<unknown, unknown, unknown> {
	return {
		id: "balancer/risk-envelope/v1",
		paramsSchema: z.object({}),
		wasmArgsSchema: z.object({}),
		secretsSchema: z.object({}),
		deployments,
		metadata: {
			name: "balancer",
			version: "0.0.0",
			description: "test fixture",
		},
	};
}

describe("getDeployment", () => {
	it("returns the (chainId, env) Deployment when both axes hit", () => {
		const pack = makePack({
			"11155111": { stagef: STAGEF_BALANCER, prod: PROD_BALANCER },
		});

		const stagef = getDeployment(pack, "11155111", "stagef");
		assert.equal(stagef.policy, STAGEF_BALANCER.policy);
		assert.equal(stagef.policyData, STAGEF_BALANCER.policyData);

		const prod = getDeployment(pack, "11155111", "prod");
		assert.equal(prod.policy, PROD_BALANCER.policy);
		assert.equal(prod.policyData, PROD_BALANCER.policyData);
	});

	it("returns the right Deployment when only one env is deployed on a chain", () => {
		const pack = makePack({ "11155111": { stagef: STAGEF_BALANCER } });
		const dep = getDeployment(pack, "11155111", "stagef");
		assert.equal(dep.policy, STAGEF_BALANCER.policy);
	});

	it("throws UnsupportedChainError when the chain has no entry at all", () => {
		const pack = makePack({ "11155111": { stagef: STAGEF_BALANCER } });
		assert.throws(
			() => getDeployment(pack, "1", "stagef"),
			(err: unknown) => {
				assert.ok(err instanceof UnsupportedChainError);
				assert.equal(err.packId, "balancer/risk-envelope/v1");
				assert.equal(err.chainId, "1");
				assert.deepEqual([...err.supportedChainIds], ["11155111"]);
				return true;
			},
		);
	});

	it("throws UnsupportedEnvError when the chain has entries but not the requested env", () => {
		// Load-bearing case for Phase 0 schema migration: pre-Stream-D2 each
		// pack only has `stagef` deployed. A curator setting `env: "prod"` must
		// get a distinct, actionable error — not silently fall back to stagef.
		const pack = makePack({ "11155111": { stagef: STAGEF_BALANCER } });
		assert.throws(
			() => getDeployment(pack, "11155111", "prod"),
			(err: unknown) => {
				assert.ok(err instanceof UnsupportedEnvError);
				assert.equal(err.packId, "balancer/risk-envelope/v1");
				assert.equal(err.chainId, "11155111");
				assert.equal(err.env, "prod");
				assert.deepEqual([...err.supportedEnvs], ["stagef"]);
				// And specifically NOT an UnsupportedChainError — the recovery is
				// different (deploy the env, not pick a different chain).
				assert.ok(!(err instanceof UnsupportedChainError));
				return true;
			},
		);
	});

	it("UnsupportedChainError lists supported chains in the message", () => {
		const pack = makePack({
			"11155111": { stagef: STAGEF_BALANCER },
			"84532": { stagef: STAGEF_BALANCER },
		});
		assert.throws(
			() => getDeployment(pack, "1", "stagef"),
			(err: unknown) => {
				assert.ok(err instanceof Error);
				// Sorted, comma-separated.
				assert.match(err.message, /11155111, 84532/);
				return true;
			},
		);
	});
});
