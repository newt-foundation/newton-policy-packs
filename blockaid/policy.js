import { fetch as httpFetch } from "newton:provider/http@0.1.0";

const BLOCKAID_BASE = "https://api.blockaid.io";

let _secrets = {};

function secret(name) {
  if (typeof getSecret === "function") return getSecret(name);
  return _secrets[name];
}

function postJson(path, payload) {
  const apiKey = secret("BLOCKAID_API_KEY");
  const body = new TextEncoder().encode(JSON.stringify(payload));
  const r = httpFetch({
    url: `${BLOCKAID_BASE}${path}`,
    method: "POST",
    headers: [
      ["accept", "application/json"],
      ["content-type", "application/json"],
      ["x-api-key", apiKey ?? ""],
    ],
    body,
  });
  if (typeof r === "string") throw new Error(`http: ${r}`);
  if (r.tag === "err") throw new Error(`http: ${r.val}`);
  const resp = r.val ?? r;
  const text = new TextDecoder().decode(new Uint8Array(resp.body));
  return { status: resp.status ?? 200, body: text };
}

function scanEvmTransaction({ chain, from, to, value, data }) {
  const { status, body } = postJson("/v0/evm/transaction/scan", {
    chain,
    account_address: from,
    transaction: { from, to, value, data },
    options: ["validation", "simulation"],
  });
  if (status >= 400) throw new Error(`blockaid ${status}: ${body.slice(0, 200)}`);
  return JSON.parse(body);
}

export function run(input) {
  try {
    const parsed = JSON.parse(input);
    _secrets = parsed;
    const { chain, from, to, value, data } = parsed;
    if (!chain) throw new Error("missing chain");
    if (!from) throw new Error("missing from");
    if (!to) throw new Error("missing to");

    const scan = scanEvmTransaction({
      chain,
      from,
      to,
      value: value ?? "0x0",
      data: data ?? "0x",
    });
    const validation = scan.validation ?? {};
    const simulation = scan.simulation ?? {};

    const classification = validation.result_type ?? validation.classification ?? "Unknown";

    const features = (validation.features ?? [])
      .map((f) => f.feature_id ?? f.type ?? f.name ?? "")
      .filter(Boolean)
      .map(String);

    const accountSummary = simulation.account_summary ?? {};
    const totals = accountSummary.total_usd_diff ?? {};
    const expectedInUsd = Number(totals.in ?? 0);
    const expectedOutUsd = Number(totals.out ?? 0);

    const assetsDiffs = accountSummary.account_assets_diffs ?? accountSummary.assets_diffs ?? [];
    const receivedShares = assetsDiffs.some((d) => {
      const inUsd = Number(d.in?.usd_price ?? d.in?.value ?? 0);
      return inUsd > 0;
    });

    const simulationStatus = simulation.status ?? "Success";
    const simulationSucceeded = simulationStatus === "Success" || simulationStatus === undefined;

    let outboundInboundRatio = null;
    if (expectedInUsd > 0) {
      outboundInboundRatio = expectedOutUsd / expectedInUsd;
    }

    return JSON.stringify({
      classification,
      features,
      expected_inbound_value_usd: expectedInUsd,
      expected_outbound_value_usd: expectedOutUsd,
      outbound_inbound_ratio: outboundInboundRatio,
      received_shares: receivedShares,
      simulation_succeeded: simulationSucceeded,
      timestamp: Date.now(),
    });
  } catch (e) {
    return JSON.stringify({ error: String(e) });
  }
}
