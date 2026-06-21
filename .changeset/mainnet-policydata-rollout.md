---
"@newton-xyz/policy-pack-balancer": minor
"@newton-xyz/policy-pack-blockaid": minor
"@newton-xyz/policy-pack-chainalysis": minor
"@newton-xyz/policy-pack-guardrail": minor
"@newton-xyz/policy-pack-persona": minor
"@newton-xyz/policy-pack-redstone": minor
"@newton-xyz/policy-pack-sumsub": minor
"@newton-xyz/policy-pack-vaultsfyi": minor
"@newton-xyz/policy-pack-webacy": minor
---

Deploy each pack's policyData oracle on Ethereum (1) and Base (8453) mainnet.

Every pack now carries a `prod` deployment on both mainnets in its `deployments` map (Sepolia and Base Sepolia were already present). Curators on Ethereum or Base mainnet can reference these oracle addresses directly via `getDeployment(pack, 1, "prod")` / `getDeployment(pack, 8453, "prod")`. The on-chain `wasmCid` is identical to the testnet deployments for each pack (the same WASM bytes deployed across cells), so a policy that passed on testnet evaluates identically on mainnet.
