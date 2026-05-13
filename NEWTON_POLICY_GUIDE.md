# Newton Policy Creation Guide

This guide walks you through writing a Newton Policy (WASM oracle + Rego rules), simulating it locally, deploying it to the Newton network, and deploying + configuring a Newton Policy Wallet smart contract that enforces the policy on-chain.

**What this guide covers:**
- Writing a WASM data oracle component in JavaScript
- Writing and understanding Rego policy rules
- Simulating both the WASM oracle and the full policy locally before deploying
- Uploading policy files to IPFS and deploying via `newton-cli`
- Deploying a `NewtonPolicyWallet` smart contract on Sepolia
- Setting the policy on the deployed wallet

---

## Prerequisites

### Tooling

You'll need:

- **Rust + Cargo** (for `newton-cli`)
- **Node.js + npm** (for `@bytecodealliance/jco` and building the WASM component)
- **Foundry** (for deploying the Solidity contracts)

On macOS:

```bash
# Rust (includes cargo)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
# restart shell

# Node + npm (Node >= 18 required)
brew install node
# restart shell

# Foundry (forge/cast/anvil)
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

### Install `newton-cli`

```bash
cargo install newton-cli@0.1.31
newton-cli --help
```

### Install `@bytecodealliance/jco`

The `jco` CLI provides the `componentize` subcommand for building WASM components from JavaScript.

#### Option A (recommended): install globally

```bash
npm install -g @bytecodealliance/jco @bytecodealliance/componentize-js
jco componentize --help
```

#### Option B: keep it local and run via `npx`

```bash
mkdir policy-workspace && cd policy-workspace
npm init -y
npm install --save-dev @bytecodealliance/jco @bytecodealliance/componentize-js
npx jco componentize --help
```

---

## Step 1 – Write and build the WASM policy component

Create a working directory:

```bash
mkdir policy-workspace && cd policy-workspace
mkdir -p policy-files
```

### 1.1 Create `newton-provider.wit`

The WIT (WebAssembly Interface Types) file defines the interface your WASM component implements. Create `newton-provider.wit`:

```
package newton:provider@0.1.0;

interface http {
    record http-request {
        url: string,
        method: string,
        headers: list<tuple<string, string>>,
        body: option<list<u8>>,
    }

    record http-response {
        status: u16,
        headers: list<tuple<string, string>>,
        body: list<u8>,
    }

    fetch: func(request: http-request) -> result<http-response, string>;
}

world newton-provider {
    import http;
    export run: func(input: string) -> result<string, string>;
}
```

### 1.2 Create `policy.js`

The WASM oracle is a JavaScript file that exports a `run` function. At runtime, Newton calls this function with `wasm_args` (a JSON string) to fetch external data. The return value is a JSON string that becomes available in Rego as `data.data.*`.

Create `policy.js` (skeleton — replace the body with your actual data fetching logic):

```js
export function run(/* wasm_args */) {
  /*const wasmArgs = JSON.parse(wasm_args);

  const response = httpFetch({
    url: `https://fetch-request-url?param=${wasmArgs.param}`,
    method: "GET",
    headers: [],
    body: null
  });

  const body = JSON.parse(
    new TextDecoder().decode(new Uint8Array(response.body))
  );*/

  return JSON.stringify({
    success: true
  });
}
```

The commented-out block shows how to make HTTP requests using the `httpFetch` built-in provided by the Newton WASM runtime (imported from the WIT interface).

### 1.3 Build `policy.wasm` using `jco componentize`

```bash
# if installed globally:
jco componentize -w newton-provider.wit -o policy.wasm policy.js -d stdio random clocks http fetch-event

# if using Option B (local dev dependency):
# npx jco componentize -w newton-provider.wit -o policy.wasm policy.js -d stdio random clocks http fetch-event
```

This produces `policy.wasm` in the current directory.

---

## Step 2 – Write the Rego policy

### 2.1 Understanding available attributes

In your Rego policy, you have access to three categories of data:

#### Policy parameters (`data.params.*`)

Parameters that the policy client (your wallet) sets when calling `setPolicy()`. These are encoded as JSON in the `policyParams` field of `PolicyConfig`. Use them to configure policy behavior per wallet (e.g., spending limits, whitelisted addresses).

```rego
# Access policy parameters set by the wallet owner
max_value := data.params.max_value_wei
allowed_recipients := data.params.allowed_recipients
```

#### WASM data output (`data.data.*`)

The JSON object returned by your WASM oracle's `run` function. Newton runs the WASM component before evaluating Rego, and the returned fields are available under `data.data`.

```rego
# Access data fetched by your WASM oracle
token_price := data.data.price_usd
is_success := data.data.success
```

#### Intent attributes (`input.*`)

The transaction intent submitted by the user. These fields describe the transaction that the wallet wants to execute:

| Field | Type | Description |
|-------|------|-------------|
| `input.from` | address | The signer/sender address |
| `input.to` | address | The target contract/address |
| `input.value` | uint256 | ETH value in wei |
| `input.decoded_function_arguments[0]` | any | First decoded argument of the target function call |
| `input.chain_id` | uint256 | Chain ID (e.g., 11155111 for Sepolia) |
| `input.function.name` | string | Name of the function being called on the target |

### 2.2 Rego syntax reference

Newton uses a subset of the Open Policy Agent (OPA) Rego language. This section covers the key constructs you'll use.

#### Module structure

Every policy file must start with a `package` declaration. The package name determines the entrypoint path.

```rego
package your_policy          # defines the namespace

import future.keywords       # enables modern keyword syntax (optional)
```

The entrypoint rule is typically `allow`. When you deploy, you specify it as `your_policy.allow`.

#### Rule types

**Value rules** — assign a computed value:

```rego
is_admin := input.from == "0xAdminAddress"
token_limit := data.params.max_tokens * 1000000
```

**Default rules** — provide a fallback when no other rule matches:

```rego
default allow := false      # deny by default (recommended)
default is_valid := false
```

**Conditional rules** — evaluate to true when all conditions in the body are met:

```rego
allow if {
    is_admin
    input.chain_id == 11155111
}
```

Multiple rule bodies for the same name are combined with OR:

```rego
allow if { is_admin }       # allow if admin
allow if { is_whitelisted } # OR if whitelisted
```

**Function rules** — reusable parameterized rules:

```rego
within_limit(amount, limit) if {
    amount <= limit
}
```

**Set comprehensions** — build a set from a collection:

```rego
allowed_set := {addr | addr := data.params.whitelist[_]}
```

**Object comprehensions** — build a key-value map:

```rego
addr_map := {addr: true | addr := data.params.whitelist[_]}
```

#### Key expressions

```rego
# Iteration
some i; item := array[i]

# Universal quantification
every addr in data.params.whitelist {
    addr != input.to
}

# Membership test
input.from in data.params.whitelist

# Negation
not is_blocked

# Walrus assignment
address := input.from
```

#### Supported built-in functions

| Function | Description |
|----------|-------------|
| `count(collection)` | Number of elements in array, set, or object |
| `sum(array)` | Sum of numeric array elements |
| `min(array)` | Minimum value in array |
| `array.slice(arr, start, stop)` | Slice of array from start to stop |
| `union(set_of_sets)` | Union of a set of sets |
| `object.keys(obj)` | Keys of an object as a set |
| `contains(str, substr)` | True if string contains substring |
| `ceil(number)` | Ceiling of a number |
| `time.parse_rfc3339_ns(str)` | Parse RFC3339 timestamp to nanoseconds |
| `regex.match(pattern, str)` | True if string matches regex pattern |
| `semver.is_valid(str)` | True if string is a valid semver |

#### Unsupported features

The following OPA features are **not supported** by Newton and must not be used:

- Cryptography functions (`crypto.*`)
- JWT functions (`io.jwt.*`)
- HTTP requests (`http.send`) — use the WASM oracle for external data instead
- Glob matching (`glob.*`)
- GraphQL (`graphql.*`)
- Any networking built-ins

### 2.3 Full example: MockERC20 token buy policy

This example shows all three attribute categories in action. It enforces:
- Admin bypass (owner can always transact)
- Recipient whitelist check
- Token price ceiling (from WASM oracle)
- Per-transaction value limit (from policy params)

```rego
package mock_erc20_policy

import future.keywords

default allow := false

# Admin always allowed
is_admin if {
    input.from == data.params.admin_address
}

# Check recipient is in the whitelist
is_whitelisted_recipient if {
    some addr in data.params.allowed_recipients
    addr == input.to
}

# Check token price from WASM oracle is below max
price_acceptable if {
    data.data.token_price_usd <= data.params.max_price_usd
}

# Check transaction value is within limit
value_within_limit if {
    input.value <= data.params.max_value_wei
}

# Admin bypass
allow if {
    is_admin
}

# Standard allow path: whitelist + price + value limit
allow if {
    is_whitelisted_recipient
    price_acceptable
    value_within_limit
    input.chain_id == 11155111
}
```

### 2.4 Create `policy.rego` for this guide

For a simple "always allow if WASM succeeds" policy:

```rego
package your_policy

default allow := false

is_success := data.data.success  # Result of running the WASM component

allow if {
    is_success
}
```

Save this as `policy.rego` in `policy-workspace/`.

### 2.5 Create metadata files

#### `params_schema.json`

Defines what policy parameters clients are allowed to set. Use an empty object for no parameters:

```json
{
  "type": "object",
  "description": "",
  "properties": {}
}
```

For a policy with parameters (e.g., the MockERC20 example above):

```json
{
  "type": "object",
  "description": "Parameters for the MockERC20 buy policy",
  "properties": {
    "admin_address": {
      "type": "string",
      "description": "Address that always bypasses policy checks"
    },
    "allowed_recipients": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Whitelisted recipient addresses"
    },
    "max_price_usd": {
      "type": "number",
      "description": "Maximum token price in USD"
    },
    "max_value_wei": {
      "type": "string",
      "description": "Maximum ETH value per transaction in wei"
    }
  }
}
```

#### `policy_data_metadata.json`

Metadata for the WASM oracle component:

```json
{
  "name": "Your Policy Wasm",
  "version": "0.0.1",
  "author": "",
  "link": "",
  "description": "What the WASM does"
}
```

#### `policy_metadata.json`

Metadata for the overall policy:

```json
{
  "name": "Your Policy",
  "version": "0.0.1",
  "author": "",
  "link": "",
  "description": "Your policy description here"
}
```

### 2.6 Organize files into `policy-files/`

The `newton-cli policy-files generate-cids` command expects all files under `policy-files/`:

```bash
cp policy.wasm policy.rego params_schema.json policy_data_metadata.json policy_metadata.json policy-files/
```

Checkpoint — `policy-files/` should contain:

- `policy.wasm`
- `policy.rego`
- `params_schema.json`
- `policy_data_metadata.json`
- `policy_metadata.json`

---

## Step 3 – Simulate the policy locally

Before deploying, simulate both the WASM oracle and the full policy (WASM + Rego) to confirm they behave as expected.

**Note:** The `CHAIN_ID` environment variable must be set before running any `newton-cli` simulation commands:

```bash
export CHAIN_ID=11155111
```

### 3.1 Simulate the WASM oracle alone (`policy-data simulate`)

Test that your WASM component runs and returns the expected JSON output:

```bash
newton-cli policy-data simulate \
  --wasm-file policy.wasm \
  --input-json '{}'
```

If your WASM expects input arguments:

```bash
newton-cli policy-data simulate \
  --wasm-file policy.wasm \
  --input-json '{"param": "foo", "token_address": "0xAbCd..."}'
```

Expected output (for the skeleton `policy.js`):

```json
{
  "success": true
}
```

This output is what becomes `data.data.*` in your Rego rules. Verify the field names match what your Rego policy references before moving on.

### 3.2 Simulate the full policy (`policy simulate`)

The full simulation runs the WASM oracle and then evaluates the Rego policy against a sample intent. This requires three JSON input files.

#### Create `intent.json`

Sample intent representing the transaction you want to evaluate:

```json
{
  "from": "0xYourSignerAddress",
  "to": "0xTargetContractAddress",
  "value": "0x0",
  "data": "0x",
  "chain_id": 11155111,
  "function": {
    "name": "transfer"
  },
  "decoded_function_arguments": []
}
```

#### Create `wasm_args.json`

The arguments to pass to the WASM oracle's `run` function:

```json
{}
```

For a WASM oracle that expects parameters:

```json
{
  "token_address": "0xAbCd...",
  "block_number": 12345678
}
```

#### Create `policy_params.json`

The policy parameters (what the wallet owner would set via `setPolicy`):

```json
{}
```

For the MockERC20 example:

```json
{
  "admin_address": "0xYourAdminAddress",
  "allowed_recipients": ["0xAddress1", "0xAddress2"],
  "max_price_usd": 100,
  "max_value_wei": "1000000000000000000"
}
```

#### Run the full simulation

```bash
newton-cli policy simulate \
  --wasm-file policy-files/policy.wasm \
  --rego-file policy-files/policy.rego \
  --intent-json intent.json \
  --entrypoint "your_policy.allow" \
  --wasm-args wasm_args.json \
  --policy-params-data policy_params.json
```

**Note on entrypoint:** Specify the entrypoint as `<package_name>.<rule_name>` (e.g., `your_policy.allow`). The `newton-cli` automatically adds the `data.` prefix internally — do not include it here.

### 3.3 Interpreting simulation output

A successful allow looks like:

```json
{
  "allow": true
}
```

A blocked transaction:

```json
{
  "allow": false
}
```

Confirm your policy returns the expected `allow: true` or `allow: false` for your test cases before proceeding to deploy. Modify `intent.json`, `wasm_args.json`, or `policy_params.json` to test different scenarios (e.g., an intent that should be blocked, one that should be allowed).

---

## Step 4 – Upload to IPFS and deploy

### 4.1 Prepare IPFS pinning credentials

You'll need a Pinata JWT with write access. See the Pinata docs for how to create one.

### 4.2 Load environment variables

Create a file named `.env.policy`:

```bash
CHAIN_ID=11155111
PINATA_JWT=your_pinata_jwt
PINATA_GATEWAY=your_pinata_gateway
PRIVATE_KEY=0xYourDeploymentPK
RPC_URL=https://your-sepolia-rpc-url
```

Load it into your shell:

```bash
set -a
source .env.policy
set +a
```

### 4.3 Generate CIDs for `policy-files/`

```bash
newton-cli policy-files generate-cids \
  --directory policy-files \
  --output policy_cids.json \
  --entrypoint "your_policy.allow"
```

The `--entrypoint` must match your Rego `package` name + rule name (e.g., `package your_policy` + `allow` → `your_policy.allow`).

### 4.4 Deploy the policy data (WASM)

```bash
newton-cli policy-data deploy --policy-cids policy_cids.json
```

Save the output address:

```
Policy data deployed successfully at address: 0xPolicy_Data_Address
```

### 4.5 Deploy the policy

```bash
newton-cli policy deploy \
  --policy-cids policy_cids.json \
  --policy-data-address "0xPolicy_Data_Address"
```

Save the Policy address — you'll use it in Step 5 when deploying the Newton Policy Wallet.

---

## Step 5 – Deploy the Newton Policy Wallet

This step deploys a smart contract wallet that requires Newton attestations before executing transactions.

### 5.1 Create the wallet contract directory

```bash
mkdir newton-policy-wallet && cd newton-policy-wallet
forge init --no-git
git init
forge install newt-foundation/newton-contracts
```

### 5.2 Create the Solidity contract

Create `src/NewtonPolicyWallet.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {NewtonPolicyClient} from "newton-contracts/src/mixins/NewtonPolicyClient.sol";
import {INewtonProverTaskManager} from "newton-contracts/src/interfaces/INewtonProverTaskManager.sol";

contract NewtonPolicyWallet is NewtonPolicyClient {
    event Executed(address indexed to, uint256 value, bytes data, bytes32 taskId);
    error InvalidAttestation();
    error ExecutionFailed();

    constructor() {}

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        // Support INewtonPolicyClient interface (expected by Newton Policy contract)
        // 0xdbdcaa9c is the interface ID expected by the deployed Policy contract
        return interfaceId == 0xdbdcaa9c || super.supportsInterface(interfaceId);
    }

    function initialize(
        address policyTaskManager,
        address policy,
        address owner
    ) external {
        _initNewtonPolicyClient(policyTaskManager, policy, owner);
    }

    // setPolicy is inherited from NewtonPolicyClient - no need to redefine!
    // Just call: wallet.setPolicy(INewtonPolicy.PolicyConfig({policyParams: "{}", expireAfter: 31536000}))

    function validateAndExecuteDirect(
        address to,
        uint256 value,
        bytes calldata data,
        INewtonProverTaskManager.Task calldata task,
        INewtonProverTaskManager.TaskResponse calldata taskResponse,
        bytes calldata signatureData
    ) external returns (bytes memory) {
        require(_validateAttestationDirect(task, taskResponse, signatureData), InvalidAttestation());

        (bool success, bytes memory result) = to.call{value: value}(data);
        if (!success) revert ExecutionFailed();

        emit Executed(to, value, data, task.taskId);
        return result;
    }

    receive() external payable {}
}
```

**Key implementation notes:**
- Inherits `NewtonPolicyClient` which handles policy registration with the Newton Policy contract
- Must override `supportsInterface` to include `0xdbdcaa9c` (required by the deployed Newton Policy contract)
- Uses `initialize()` pattern instead of constructor args
- `setPolicy` is inherited — no custom wrapper needed
- Uses `_validateAttestationDirect()` for direct attestation verification
- Requires `via_ir = true` in `foundry.toml` due to stack depth constraints in newton-contracts

Update `foundry.toml`:

```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc = "0.8.27"
via_ir = true
optimizer = true
optimizer_runs = 200

remappings = [
    "newton-contracts/=lib/newton-contracts/",
    "forge-std/=lib/forge-std/src/"
]

fs_permissions = [{ access = "read", path = "./policy_params.json" }]

[rpc_endpoints]
sepolia = "${RPC_URL}"
```

### 5.3 Create the deployment script

Create `script/Deploy.s.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Script, console} from "forge-std/Script.sol";
import {NewtonPolicyWallet} from "../src/NewtonPolicyWallet.sol";

contract DeployScript is Script {
    // Newton Task Manager on Sepolia (MUST match the SDK gateway's task manager)
    // BLS signatures are bound to this address - using the wrong one causes InvalidAttestation
    address constant NEWTON_TASK_MANAGER = 0xecb741F4875770f9A5F060cb30F6c9eb5966eD13;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address policy = vm.envAddress("POLICY");
        address owner = vm.addr(deployerPrivateKey);  // Derive from private key

        vm.startBroadcast(deployerPrivateKey);

        // Deploy the wallet
        NewtonPolicyWallet wallet = new NewtonPolicyWallet();

        // Initialize with Newton Policy system
        wallet.initialize(NEWTON_TASK_MANAGER, policy, owner);

        console.log("NewtonPolicyWallet deployed at:", address(wallet));
        console.log("Initialized with:");
        console.log("  - Task Manager:", NEWTON_TASK_MANAGER);
        console.log("  - Policy:", policy);
        console.log("  - Owner:", owner);

        vm.stopBroadcast();
    }
}
```

### 5.4 Create the set-policy script

Create `script/SetPolicy.s.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Script, console} from "forge-std/Script.sol";
import {NewtonPolicyWallet} from "../src/NewtonPolicyWallet.sol";
import {INewtonPolicy} from "newton-contracts/src/interfaces/INewtonPolicy.sol";

contract SetPolicyScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address walletAddress = vm.envAddress("WALLET_ADDRESS");
        uint32 expireAfter = uint32(vm.envUint("EXPIRE_AFTER"));

        // Read policy params from file (empty JSON object by default)
        string memory paramsJson = vm.readFile("policy_params.json");
        bytes memory policyParams = bytes(paramsJson);

        vm.startBroadcast(deployerPrivateKey);

        NewtonPolicyWallet wallet = NewtonPolicyWallet(payable(walletAddress));

        // Call the inherited setPolicy function with PolicyConfig struct
        bytes32 newPolicyId = wallet.setPolicy(
            INewtonPolicy.PolicyConfig({
                policyParams: policyParams,
                expireAfter: expireAfter
            })
        );

        console.log("Policy set with ID:");
        console.logBytes32(newPolicyId);

        vm.stopBroadcast();
    }
}
```

### 5.5 Deploy the wallet

Create `.env` in the `newton-policy-wallet` directory:

```bash
PRIVATE_KEY=0xYourWalletDeployerPrivateKey
POLICY=<paste Policy address from Step 4.5>
RPC_URL=https://your-sepolia-rpc-url
```

The wallet owner is automatically derived from `PRIVATE_KEY`.

Deploy:

```bash
source .env
forge script script/Deploy.s.sol:DeployScript --rpc-url $RPC_URL --broadcast
```

Save the deployed wallet address from the output — you'll need it for the frontend guide.

### 5.6 Set the policy on the wallet

Create `policy_params.json` in `newton-policy-wallet/`:

```json
{}
```

Add to your `.env`:

```bash
WALLET_ADDRESS=0xYourWalletAddress
EXPIRE_AFTER=31536000
```

Run:

```bash
source .env
forge script script/SetPolicy.s.sol:SetPolicyScript --rpc-url $RPC_URL --broadcast
```

After this completes:
- Newton can generate attestations for your `NewtonPolicyWallet`
- The wallet will only execute transactions that pass your Rego policy

---

## Appendix: Common Pitfalls

### `jco componentize` not found

If you installed `@bytecodealliance/jco` locally (Option B) rather than globally, run it via `npx jco componentize ...` instead of `jco componentize ...`. You also need `@bytecodealliance/componentize-js` as a peer dependency.

### Simulation failures

- Ensure `CHAIN_ID` is exported before running any `newton-cli` command: `export CHAIN_ID=11155111`
- Verify field names in `data.data.*` match exactly what your WASM returns — check the output of `policy-data simulate` first
- Ensure `intent.json` uses valid Ethereum addresses (checksummed or lowercase)
- The `--entrypoint` flag should be `package_name.rule_name` (e.g., `your_policy.allow`) — do not include the `data.` prefix

### Foundry deployment issues

- Verify `PRIVATE_KEY` is prefixed with `0x`
- Ensure the deployer wallet has sufficient Sepolia ETH
- Check `RPC_URL` is valid and reachable
- Run `forge build` first to catch compilation errors before deploying
- If `forge init --no-commit` fails, use `forge init --no-git` instead (flag name varies by Foundry version)
- `forge install` requires a git repository — run `git init` first if you used `--no-git`

### Invalid attestation on wrong task manager

The wallet MUST be initialized with the correct Newton Task Manager address for Sepolia: `0xecb741F4875770f9A5F060cb30F6c9eb5966eD13`. BLS signatures are bound to this specific address — using any other address will always produce `InvalidAttestation` errors at execution time.

### Rego policy always returns `allow: false`

- Check that `default allow := false` is present (this is correct — deny by default)
- Verify the rule conditions use the correct attribute paths (`data.params.*`, `data.data.*`, `input.*`)
- Use `policy simulate` to test the policy with your specific intent values before deploying
- Remember that Rego uses `==` for equality checks, not `=`