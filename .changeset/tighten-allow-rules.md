---
"@newton-xyz/policy-pack-blockaid": minor
"@newton-xyz/policy-pack-guardrail": minor
"@newton-xyz/policy-pack-webacy": minor
---

Close fail-open paths in blockaid, guardrail, and webacy allow rules.

- **blockaid**: switch from `classification != "Malicious"` to a positive allowlist `{"Benign", "Warning"}`. The previous check let `"Unknown"` (the parse-failure default in policy.js) and any future Blockaid result type pass. Adds a `blockaid_unknown_classification` deny tag.
- **guardrail**: add a required `require_health` boolean param (default true on the operator side) and require `health_available == true` whenever it is set. The previous `health_ok if v.health_available == false` clause turned every health-endpoint outage into an allow. Adds a `guardrail_health_unavailable` deny tag.
- **webacy**: gate allow on `within_expected_range == true` and a new required `max_abs_dev_pct` param against `abs_dev_clean`. Tokens currently outside their peg range with no recent depeg events / no streak / non-stale data previously passed silently. Also tightens `wasm_args` `lookback_days` to a hard `[1, 30]` range — out-of-range inputs now throw in the WASM (rego denies via `default allow := false`) instead of being silently clamped.

Operators must set the new params (`require_health`, `max_abs_dev_pct`) when binding these policies; missing required params will fail validation.
