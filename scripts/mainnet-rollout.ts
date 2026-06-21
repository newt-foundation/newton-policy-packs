/**
 * One-shot mainnet rollout runner for the full policyData oracle matrix.
 *
 * Deploys every (pack, chain, env) cell that is NOT already in deployments.json,
 * across {Ethereum 1, Base 8453} × {stagef, prod} for all 9 packs. Wraps
 * `scripts/deploy.sh` (which carries the triple-signal mainnet gate + writes
 * dist/last_deploy.json) and adds:
 *
 *   - Idempotency: skips cells already recorded in deployments.json (a re-deploy
 *     reverts with Create2Failed since the CREATE2 address is occupied — burning
 *     a guaranteed-revert tx). Real ETH, so we don't even attempt it.
 *   - Eth gas ceiling: aborts before any chain-1 tx if live gas-price exceeds
 *     MAX_ETH_GWEI. Base has 300x+ headroom so no ceiling is enforced there.
 *   - Base-first ordering: cheapest/lowest-risk cells first.
 *   - Fail-fast: stops on the first non-skip failure so a bad cell is inspected
 *     before spending more.
 *
 * NOT a substitute for sync-deployments.sh — deploy.sh writes per-pack
 * dist/last_deploy.json snapshots; `pnpm run deploy:sync` folds them into
 * deployments.json afterward. This runner only orchestrates the deploys.
 *
 * Usage (real mainnet — all three signals required by deploy.sh):
 *   NEWTON_ALLOW_MAINNET_DEPLOY=1 NEWTON_ALLOW_MAINNET_DEPLOY_FLAG=1 \
 *     pnpm tsx scripts/mainnet-rollout.ts            # deploy
 *   pnpm tsx scripts/mainnet-rollout.ts --dry-run    # print the plan, no broadcast
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

const PACKS = [
	"balancer",
	"blockaid",
	"chainalysis",
	"guardrail",
	"persona",
	"redstone",
	"sumsub",
	"vaultsfyi",
	"webacy",
] as const;

// Base first (cheap, low risk), then Ethereum.
const CHAINS = ["8453", "1"] as const;
const ENVS = ["prod", "stagef"] as const;

const MAX_ETH_GWEI = 3; // abort an Eth deploy if live gas-price exceeds this

const ENV_FILE: Record<string, string> = {
	prod: resolve(REPO_ROOT, ".env.deploy.mainnet.prod"),
	stagef: resolve(REPO_ROOT, ".env.deploy.mainnet.stagef"),
};

interface DeploymentCell {
	policyData: string;
	wasmCid?: string;
	priorWasmCids?: string[];
	policyCodeHash?: string;
	deployedAt?: string;
}
interface DeploymentsFile {
	packs: Record<string, Record<string, Record<string, DeploymentCell>>>;
}

function alreadyDeployed(
	deployments: DeploymentsFile,
	pack: string,
	chain: string,
	env: string,
): boolean {
	return Boolean(deployments.packs[pack]?.[chain]?.[env]);
}

/** Live gas-price in gwei for a chain, read from the env file's RPC_URL_<chain>. */
function liveGasGwei(chain: string, envFile: string): number {
	const rpc = readRpc(chain, envFile);
	const r = spawnSync("cast", ["gas-price", "--rpc-url", rpc], { encoding: "utf8" });
	if (r.status !== 0) throw new Error(`cast gas-price failed for chain ${chain}: ${r.stderr}`);
	return Number(r.stdout.trim()) / 1e9;
}

function readRpc(chain: string, envFile: string): string {
	const line = readFileSync(envFile, "utf8")
		.split("\n")
		.find((l) => l.startsWith(`RPC_URL_${chain}=`));
	if (!line) throw new Error(`RPC_URL_${chain} not in ${envFile}`);
	return line.slice(`RPC_URL_${chain}=`.length).trim();
}

function deployCell(pack: string, chain: string, env: string, dryRun: boolean): boolean {
	const envFile = ENV_FILE[env];
	if (!envFile || !existsSync(envFile)) {
		console.error(`✗ ${pack} ${chain}/${env}: env file missing (${envFile})`);
		return false;
	}

	// Eth gas ceiling pre-check.
	if (chain === "1") {
		const gwei = liveGasGwei(chain, envFile);
		if (gwei > MAX_ETH_GWEI) {
			console.error(
				`✗ ABORT ${pack} ${chain}/${env}: Eth gas ${gwei.toFixed(3)} gwei > ${MAX_ETH_GWEI} gwei ceiling. ` +
					`Pausing rollout — re-run when gas settles.`,
			);
			return false;
		}
		console.log(`  (eth gas ${gwei.toFixed(3)} gwei, under ${MAX_ETH_GWEI} ceiling)`);
	}

	const args = [
		resolve(REPO_ROOT, "scripts/deploy.sh"),
		pack,
		"--env",
		env,
		"--chain",
		chain,
		"--env-file",
		envFile,
		"--allow-mainnet",
	];
	console.log(`→ ${dryRun ? "[dry-run] " : ""}deploy ${pack} ${chain}/${env}`);
	if (dryRun) return true;

	const r = spawnSync("bash", args, {
		cwd: REPO_ROOT,
		stdio: "inherit",
		env: {
			...process.env,
			NEWTON_ALLOW_MAINNET_DEPLOY: "1",
			NEWTON_ALLOW_MAINNET_DEPLOY_FLAG: "1",
		},
	});
	if (r.status !== 0) return false;

	// Merge THIS cell into deployments.json immediately, reading only this pack's
	// just-written snapshot. We deliberately do NOT shell out to
	// `sync-deployments.sh` here: that script globs EVERY pack's
	// dist/last_deploy.json and fail-closes if any snapshot's env ≠ --env. Mid
	// rollout the snapshot pool spans two envs (e.g. 8 packs still on prod while
	// we deploy the first stagef cell), so a global sync would (correctly) abort.
	// A single-snapshot inline merge sidesteps that and keeps the rollout
	// resumable — a completed cell lands in deployments.json, so a re-run skips
	// it instead of hitting Create2Failed.
	const ok = mergeSnapshot(pack, chain, env);
	if (!ok) {
		console.error(
			`✗ ${pack} ${chain}/${env}: deployed but snapshot merge failed — fix deployments.json before continuing`,
		);
		return false;
	}
	return true;
}

interface Snapshot {
	pack: string;
	chainId: string;
	env: string;
	policyData: string;
	policyCids: { wasmCid?: string; policyCodeHash?: string };
	deployedAt?: string;
}

/**
 * Fold this pack's dist/last_deploy.json into deployments.json, writing only
 * `packs[pack][chainId][env]`. Mirrors sync-deployments.sh's per-cell merge
 * (priorWasmCids history carry-forward + date-only) but for a single snapshot,
 * and asserts the snapshot's (pack, chain, env) matches what we just deployed
 * so a stale/clobbered snapshot can't write the wrong cell.
 */
function mergeSnapshot(pack: string, chain: string, env: string): boolean {
	const snapPath = resolve(REPO_ROOT, pack, "dist/last_deploy.json");
	if (!existsSync(snapPath)) {
		console.error(`  snapshot missing: ${snapPath}`);
		return false;
	}
	const s = JSON.parse(readFileSync(snapPath, "utf8")) as Snapshot;
	if (s.pack !== pack || s.chainId !== chain || s.env !== env) {
		console.error(
			`  snapshot mismatch: expected ${pack}/${chain}/${env}, snapshot is ${s.pack}/${s.chainId}/${s.env}`,
		);
		return false;
	}
	const depPath = resolve(REPO_ROOT, "deployments.json");
	const dep = JSON.parse(readFileSync(depPath, "utf8")) as DeploymentsFile;
	dep.packs[pack] ??= {};
	dep.packs[pack][chain] ??= {};
	const prev = (dep.packs[pack][chain][env] ?? {}) as {
		wasmCid?: string;
		priorWasmCids?: string[];
	};
	const newWasmCid = s.policyCids.wasmCid;
	const history = Array.isArray(prev.priorWasmCids) ? [...prev.priorWasmCids] : [];
	if (prev.wasmCid && prev.wasmCid !== newWasmCid) history.unshift(prev.wasmCid);
	const priorWasmCids = [...new Set(history)].filter((c) => c !== newWasmCid);
	dep.packs[pack][chain][env] = {
		policyData: s.policyData,
		wasmCid: newWasmCid,
		...(priorWasmCids.length ? { priorWasmCids } : {}),
		policyCodeHash: s.policyCids.policyCodeHash,
		deployedAt: (s.deployedAt ?? "").slice(0, 10),
	};
	writeFileSync(depPath, `${JSON.stringify(dep, null, 2)}\n`);
	console.log(`  merged ${pack}@${chain}/${env}: policyData=${s.policyData}`);
	return true;
}

function main(): void {
	const dryRun = process.argv.includes("--dry-run");
	const deployments = JSON.parse(
		readFileSync(resolve(REPO_ROOT, "deployments.json"), "utf8"),
	) as DeploymentsFile;

	const plan: { pack: string; chain: string; env: string }[] = [];
	const skipped: string[] = [];
	for (const chain of CHAINS) {
		for (const env of ENVS) {
			for (const pack of PACKS) {
				if (alreadyDeployed(deployments, pack, chain, env)) {
					skipped.push(`${pack} ${chain}/${env}`);
				} else {
					plan.push({ pack, chain, env });
				}
			}
		}
	}

	console.log(
		`Plan: ${plan.length} cells to deploy, ${skipped.length} already-deployed (skipped).`,
	);
	if (skipped.length) console.log(`  Skipping: ${skipped.join(", ")}`);
	console.log("");

	let done = 0;
	for (const { pack, chain, env } of plan) {
		const ok = deployCell(pack, chain, env, dryRun);
		if (!ok) {
			console.error(
				`\nStopped after ${done}/${plan.length} deploys. Fix the cell above and re-run ` +
					`(idempotent — completed cells are skipped once deployments.json is synced).`,
			);
			process.exit(1);
		}
		done++;
	}
	console.log(
		`\n✓ ${dryRun ? "[dry-run] " : ""}${done}/${plan.length} cells ${dryRun ? "planned" : "deployed"}.`,
	);
	if (!dryRun) {
		console.log(
			"Next: `pnpm run deploy:sync --env prod` and `--env stagef` to fold snapshots into deployments.json.",
		);
	}
}

main();
