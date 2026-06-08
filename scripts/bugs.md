# SDK + Gateway + tooling bugs surfaced by this harness

Tracker for issues found while running scripts/cmd/*. Plan: bundle these into
PRs against `@newton-xyz/sdk`, `newton-cli`, and the gateway/operators once
we've stabilized the dashboard.

SDK pinned at `@newton-xyz/sdk@1.0.0`. Gateway tested against
`https://gateway.stagef.testnet.newton.xyz/rpc`. `newton-cli` from `~/.newton/bin/newton-cli`.

---

## 1. `gatewayApiUrl` override doesn't auto-append `/rpc` — SDK POSTs to gateway root, gets empty body

**Severity:** High — silently breaks every SDK call when caller overrides `gatewayApiUrl` with the URL shape the docs/dashboard `.env` use.

**Symptom (consumer-visible):**
```
ERROR: Unexpected end of JSON input
SyntaxError: Unexpected end of JSON input
    at JSON.parse (<anonymous>)
    at parseJSONFromBytes (node:internal/deps/undici/undici:4319:19)
```

This bubbles up from every method we tried (`evaluateIntentDirect`,
`simulatePolicy`, `simulatePolicyDataWithClient`) and is the single cause of
all of them failing. The actual error is the empty-response one in bug #2.

**Root cause** — `node_modules/@newton-xyz/sdk/dist/es/utils/https.mjs`:

```js
class u {
  constructor(e, r) {
    this.baseUrl = r || o[e];   // r = override; o[e] = default
  }
  async Post(e, r, a) {
    const s = i(e, r);
    return (await fetch(this.baseUrl, { ... })).json();
  }
}
```

The default URLs in `const.mjs` already include `/rpc`:

```js
const i = {
  [t.id]: "https://gateway.testnet.newton.xyz/rpc",
  [a.id]: "https://gateway.newton.xyz/rpc",
  ...
};
```

…but when a consumer overrides via `newtonWalletClientActions({}, { gatewayApiUrl })`, the override is taken verbatim. So if you pass
`https://gateway.stagef.testnet.newton.xyz` (the shape that's in the
dashboard's `.env.local` and the docs), the SDK POSTs to the *root*. The
gateway returns an empty body, `.json()` throws `Unexpected end of JSON input`.

**Repro:**
```ts
const wc = createWalletClient({ chain: sepolia, transport: http(rpcUrl), account })
  .extend(newtonWalletClientActions({ apiKey }, {
    gatewayApiUrl: 'https://gateway.stagef.testnet.newton.xyz', // no /rpc
  }));
await wc.evaluateIntentDirect({ ... }); // throws: Unexpected end of JSON input
```

Adding `/rpc` to the override makes everything work.

**Fix options (in `AvsHttpService`):**
1. **Best:** auto-append `/rpc` if the override doesn't already end in it. The dashboard's `.env.local` and the docs both use the bare shape; users will keep tripping on this.
2. Document loudly that overrides must include the `/rpc` suffix.

---

## 2. `AvsHttpService.Post` doesn't check `response.ok` — gateway errors surface as `Unexpected end of JSON input`

**Severity:** High — masks every gateway error as an unrelated parse error.

This is the reason bug #1 took a long time to find. The SDK does a blind
`.json()` on whatever the gateway returns, so any non-JSON or empty body
becomes `SyntaxError: Unexpected end of JSON input`. Same symptom for:

- 401 from gateway when auth/URL is wrong (empty body)
- 400/422 with a `text/plain` JSON-RPC validation message (e.g. bug #3)
- Network/proxy errors that return HTML

**Source** — `node_modules/@newton-xyz/sdk/dist/es/utils/https.mjs`:

```js
async Post(e, r, a) {
  const s = i(e, r);
  return (await fetch(this.baseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${a}` },
    body: JSON.stringify(s),
  })).json();   // <-- assumes JSON, no status check, no content-type check
}
```

**Fix:**

```js
async Post(method, params, apiKey) {
  const body = createJsonRpcRequestPayload(method, params);
  const res = await fetch(this.baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Newton gateway ${res.status} ${res.statusText}: ${text || '(empty body)'}`);
  }
  if (!text) {
    throw new Error(`Newton gateway returned empty body (status ${res.status})`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`Newton gateway returned non-JSON (status ${res.status}): ${text.slice(0, 500)}`);
  }
}
```

Without this fix, every gateway-side bug looks like a parse bug to the consumer.

---

## 3. `simulatePolicyDataWithClient` and `simulatePolicy` omit `chain_id` — gateway returns HTTP 400

**Severity:** Medium — both methods unusable as currently shipped.

**Direct curl shows the real error** (currently masked by bug #2):
```json
{"jsonrpc":"2.0","result":null,
 "error":{"InvalidRequest":"Invalid request format: missing field `chain_id`"},
 "id":null}
```

**Root cause** — `node_modules/@newton-xyz/sdk/dist/es/modules/avs/index.mjs`,
function `M` (`simulatePolicyDataWithClient`):

```js
const i = {
  policy_data_address: e.policyDataAddress,
  policy_client: e.policyClient,
  wasm_args: e.wasmArgs,
  // no chain_id
};
```

Same problem in function `z` (`simulatePolicy`):

```js
const i = {
  policy_client: e.policyClient,
  policy: e.policy,
  intent: h(e.intent),
  entrypoint: e.entrypoint,
  policy_data: e.policyData.map(...),
  policy_params: e.policyParams ?? {},
  intent_signature: ...,
  // no chain_id
};
```

`SimulatePolicyDataWithClientParams` and `SimulatePolicyParams` also lack a
`chainId` field, so the caller can't add it.

Compare to `simulatePolicyData` (function `K` in the same file) which DOES
include `chain_id: e.chainId` and works.

**Fix:**
1. Add `chainId: number` to both `SimulatePolicyDataWithClientParams` and `SimulatePolicyParams`.
2. Include `chain_id: e.chainId` in the request body for functions `M` and `z`.

---

## 4. `evaluateIntentDirect` drops `validate_calldata` from the response

**Severity:** High — makes `includeValidateCalldata: true` useless via the SDK; consumers must hit the gateway directly to get the calldata for `validateAndExecuteDirect`.

**Symptom:** request includes `include_validate_calldata: true`, gateway response includes `validate_calldata: "0xfcb11dd5..."` (verified via curl), but `walletClient.evaluateIntentDirect(...).result` has no `validate_calldata` field.

**Root cause** — function `F` (`evaluateIntentDirect`) in
`node_modules/@newton-xyz/sdk/dist/es/modules/avs/index.mjs`:

```js
const u = a.result;
const c = {
  evaluationResult: x(Uint8Array.from(u.task_response.evaluation_result)),
  intent: u.task_response.intent,
  intentSignature: u.task_response.intent_signature,
  policyAddress: u.task_response.policy_address,
  policyClient: u.task_response.policy_client,
  policyConfig: u.task_response.policy_config,
  policyId: u.task_response.policy_id,
  policyTaskData: u.task_response.policy_task_data,
  taskId: u.task_id,
  initializationTimestamp: u.task_response.initialization_timestamp,
};
return {
  result: {
    evaluationResult: !!A(c.evaluationResult),
    task: u.task,
    taskResponse: c,
    blsSignature: u.signature_data,
    // <-- u.validate_calldata is in `u` but never propagated
  },
};
```

The gateway response (verified via curl) contains:
```json
{ "result": { ..., "validate_calldata": "0xfcb11dd5..." } }
```

The SDK doesn't read `u.validate_calldata` so it's silently dropped.

**Fix:** in function `F`, propagate the field:
```js
return {
  result: {
    evaluationResult: !!A(c.evaluationResult),
    task: u.task,
    taskResponse: c,
    blsSignature: u.signature_data,
    validateCalldata: u.validate_calldata,
  },
};
```

Also add `validateCalldata?: \`0x\${string}\`` to the `EvaluateIntentDirectResult` type.

---

## 6. Operators reject every newly-built WASM with `wasi:http/types@0.2.10` linker error

**Severity:** High — every pack rebuilt fresh fails on-chain at instantiation. Operators return `Quorum not reached` with `operator_errors[*].message` saying:
```
component imports instance `wasi:http/types@0.2.10`,
but a matching implementation was not found in the linker
```

**Root cause** (proven by inspection with `wasm-tools component print`):

`componentize-js` (every version 0.16+ tested) bakes a hard-coded
`wasi:http/incoming-handler@0.2.10#handle` export into the produced
component, regardless of `--disable http --disable fetch-event` flags. The
StarlingMonkey JS engine inside componentize-js exposes a fetch-event
handler at the WASI level by default; jco's `--disable` only stubs the
runtime *implementation* of those imports, not the wasm-level *export
declaration*.

That export's signature references `wasi:http/types@0.2.10` types. When
the operator's wasmtime instantiates the component, it tries to resolve
those types against the linker — and the linker doesn't have them
registered.

**Why the fix isn't on the policy author's side:** verified empirically.

```bash
# Same wasm built with componentize-js 0.16.0, 0.17.0, 0.18.5, 0.19.3, 0.20.0
# all produce: (export "wasi:http/incoming-handler@0.2.10#handle" ...)
# regardless of -d http / -d fetch-event / -d all
```

So pinning componentize-js to an older version doesn't help, and adding
more `--disable` flags doesn't help either. The export is hard-coded.

**Real fix — register a wasi:http linker in the operator runtime:**

In `newton-prover-avs/crates/enclave/src/wasm.rs:519`, the linker setup is:

```rust
wasmtime_wasi::p2::add_to_linker_async(&mut linker)?;
newton::provider::http::add_to_linker(...);
newton::provider::secrets::add_to_linker(...);
newton::provider::tlsn::add_to_linker(...);
```

Need to also call:

```rust
wasmtime_wasi_http::add_only_http_to_linker_async(&mut linker)?;
```

…with `wasmtime-wasi-http = "36"` added to `crates/enclave/Cargo.toml`
(matching the existing `wasmtime = "36"` and `wasmtime-wasi = "36"` pins).
The operator never *uses* the WASI HTTP impl — no policy.js calls
`wasi:http/*` directly — but registering the linker satisfies the import
type-check that componentize-js's bake-in forces. Equivalent to a no-op
linker stub.

Same fix needed in `crates/data-provider/src/wasm/executor.rs` if it has
a parallel linker setup.

**Bonus newton-cli bug:** `bin/newton-cli/src/commands/policy_build.rs:49`
calls jco with `-d stdio random clocks http fetch-event` (one `-d` flag,
five positional values). jco's `-d` accepts multi-values, but only when
written as `-d val1 -d val2 -d val3` OR via `--disable val1,val2,val3`.
The current invocation only disables `stdio` — the rest are silently
parsed as positional jco args. Doesn't change the fundamental bug above,
but it does mean newton-cli's intent isn't being honored. Fix: split into
five `-d <feature>` flags.

**Symptom from the gateway:**
```
Quorum not reached: Unified Prepare: Quorum NOT reached for quorums [0] (threshold: 40%)
```

…with `operator_errors[*].message`:
```
Data provider error: Parse error: Failed to process policy data:
policy data 0x...: Parse error: enclave WASM execution failed:
compilation failed: policy eval failed:
failed to instantiate WASM component: component imports instance
`wasi:http/types@0.2.10`, but a matching implementation was not
found in the linker
```

**Root cause hypothesis:** `jco componentize` (or its underlying
`componentize-js` / StarlingMonkey engine) hard-codes a small WASI HTTP
import even when the user disables HTTP — likely a `wasi:http/incoming-handler#handle`
export expectation baked into the engine. The Newton enclave's component
linker only provides `newton:provider/{http,secrets,tlsn}@0.2.0`, so
component instantiation fails.

**Why does anything work in production then?** Existing PolicyData
contracts on-chain were built with an older `jco`/`componentize-js` that
didn't add this import, OR the operator runtime used to ship a no-op WASI
HTTP linker that's since been removed. Worth bisecting which side regressed.

**Things to try (upstream fix candidates):**

1. **In `newton-prover-avs/bin/newton-cli/src/commands/policy_build.rs`** —
   pin `componentize-js` / `jco` to whatever version produced the
   currently-working production wasms. Probably the easiest path. Find a
   working pack's `wasmCid`, fetch from IPFS, dump its WIT imports, see
   what `jco --version` produced an import-free build, and pin that.

2. **In the enclave runtime** — register a no-op linker stub for
   `wasi:http/types@0.2.10` and `wasi:http/incoming-handler@0.2.10` so any
   leftover imports resolve to functions that throw. Doesn't break
   anything because no `policy.js` actually calls them (the JS uses
   `newton:provider/http`).

3. **Strip the imports post-componentize** — run `wasm-tools component
   delete-imports wasi:http/...` on the produced wasm before pinning. Hacky
   but a one-liner in `newton-cli`'s build step.

**Repro & verification command:**
```bash
strings dist/policy.wasm | grep 'wasi:http'
```
Should print nothing on a working build. Currently prints:
```
wasi:http/incoming-handler@0.2.10
wasi:http/types@0.2.10
```

Per `jco componentize --help`, `-d / --disable` advertises `http` as a
disable-able feature, but in practice it only stubs the *implementation*,
not the WIT-level *import declaration* — so the enclave linker still sees
the import and fails.

---

## 5. Gateway requires `id` to be a UUID even though the JSON-RPC spec allows any string

**Severity:** Cosmetic — the SDK happens to use `crypto.randomUUID()`, so this
only bites people writing diagnostic `curl` commands. (Like us.)

**Repro:**
```bash
curl ... -d '{"jsonrpc":"2.0","method":"newt_simulatePolicyData","params":{...},"id":"diag-1"}'
```

**Response:**
```
HTTP/2 422
content-type: text/plain; charset=utf-8

Failed to deserialize the JSON body into the target type:
id: UUID parsing failed: invalid character ...
```

JSON-RPC 2.0 explicitly allows `id` to be a `String, Number, or NULL`. The
gateway should accept any string, not require UUID format. Gateway-side fix.
