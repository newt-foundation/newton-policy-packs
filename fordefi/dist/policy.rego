package fordefi_transaction_safety

import future.keywords

default allow := false

t := data.params
v := data.wasm.fordefi

deny contains "must_be_signed_internally" if v.signed_externally

deny contains "insufficient_signers" if count(v.signatures) < t.min_signatures

deny contains "risk_factors_present" if count(v.managed_transaction_data.risks) > 0

deny contains "aml_check_failed" if v.managed_transaction_data.aml_policy_match.action_type != "allow"

allow if {
    count(deny) == 0
}
