package safe_signer_threshold_test

import data.safe_signer_threshold

default_params := {
    "safe_address": "0x1111111111111111111111111111111111111111",
    "min_threshold": 2,
    "min_owners": 3,
    "max_owners": 5,
}

clean_data := {
    "safe_address": "0x1111111111111111111111111111111111111111",
    "chain_id": 11155111,
    "block_number": 11629333,
    "threshold": 3,
    "owner_count": 4,
}

# The attested intent. `input.chain_id` is a STRING in AVS-rendered intents
# (camelCase `chainId` in the intent JSON → snake_case here), which is why
# `policy.rego` normalizes it before comparing against the oracle's numeric
# `chain_id`. Every assertion below passes an intent: the policy reads
# `input`, so an assertion without one isn't meaningful.
default_intent := {"chain_id": "11155111"}

# Phase 0 § Stream B namespacing: `policy.rego` reads from
# `data.wasm.safe_signer_threshold.<field>`, so test fixtures wrap the inner
# shape under the `safe_signer_threshold` key.
wrap(inner) := {"safe_signer_threshold": inner}

with_data(overrides) := wrap(object.union(clean_data, overrides))

intent(chain_id) := {"chain_id": chain_id}

test_allow_when_all_clean if {
    d := wrap(clean_data)
    safe_signer_threshold.allow with data.params as default_params with data.wasm as d with input as default_intent
    count(safe_signer_threshold.deny) == 0 with data.params as default_params with data.wasm as d with input as default_intent
}

test_deny_threshold_below_minimum if {
    d := with_data({"threshold": 1})
    "threshold_below_minimum" in safe_signer_threshold.deny with data.params as default_params with data.wasm as d with input as default_intent
    not safe_signer_threshold.allow with data.params as default_params with data.wasm as d with input as default_intent
}

test_allow_threshold_exactly_at_minimum if {
    d := with_data({"threshold": 2})
    not "threshold_below_minimum" in safe_signer_threshold.deny with data.params as default_params with data.wasm as d with input as default_intent
    safe_signer_threshold.allow with data.params as default_params with data.wasm as d with input as default_intent
}

test_deny_owners_below_minimum if {
    d := with_data({"owner_count": 2, "threshold": 2})
    "owners_below_minimum" in safe_signer_threshold.deny with data.params as default_params with data.wasm as d with input as default_intent
    not safe_signer_threshold.allow with data.params as default_params with data.wasm as d with input as default_intent
}

test_deny_owners_above_maximum if {
    d := with_data({"owner_count": 6})
    "owners_above_maximum" in safe_signer_threshold.deny with data.params as default_params with data.wasm as d with input as default_intent
    not safe_signer_threshold.allow with data.params as default_params with data.wasm as d with input as default_intent
}

test_allow_owners_at_both_bounds if {
    at_min := with_data({"owner_count": 3})
    at_max := with_data({"owner_count": 5})
    safe_signer_threshold.allow with data.params as default_params with data.wasm as at_min with input as default_intent
    safe_signer_threshold.allow with data.params as default_params with data.wasm as at_max with input as default_intent
}

test_deny_safe_address_mismatch if {
    d := with_data({"safe_address": "0x2222222222222222222222222222222222222222"})
    "safe_address_mismatch" in safe_signer_threshold.deny with data.params as default_params with data.wasm as d with input as default_intent
    not safe_signer_threshold.allow with data.params as default_params with data.wasm as d with input as default_intent
}

# The oracle lowercases the address it read; params may hold a checksummed
# (mixed-case) address. The comparison must not care.
test_address_match_is_case_insensitive if {
    p := object.union(default_params, {"safe_address": "0xABCdefABCDEFabcDEF0123456789abcdefABCdef"})
    d := with_data({"safe_address": "0xabcdefabcdefabcdef0123456789abcdefabcdef"})
    not "safe_address_mismatch" in safe_signer_threshold.deny with data.params as p with data.wasm as d with input as default_intent
    safe_signer_threshold.allow with data.params as p with data.wasm as d with input as default_intent
}

# --- intent/oracle chain agreement -----------------------------------------

# The oracle read a Safe on Sepolia but the transaction executes on Base
# Sepolia. Both Safes may be perfectly configured; the pairing is still wrong.
test_deny_chain_id_mismatch if {
    d := wrap(clean_data)
    "chain_id_mismatch" in safe_signer_threshold.deny with data.params as default_params with data.wasm as d with input as intent("84532")
    not safe_signer_threshold.allow with data.params as default_params with data.wasm as d with input as intent("84532")
}

test_allow_when_both_are_base_sepolia if {
    d := with_data({"chain_id": 84532})
    not "chain_id_mismatch" in safe_signer_threshold.deny with data.params as default_params with data.wasm as d with input as intent("84532")
    safe_signer_threshold.allow with data.params as default_params with data.wasm as d with input as intent("84532")
}

# `--chain-id` on newton-cli does not populate `input.chain_id`; only a
# `chainId` key in the intent JSON does. Absent means deny, not pass.
test_deny_when_intent_chain_id_missing if {
    d := wrap(clean_data)
    "intent_chain_id_missing" in safe_signer_threshold.deny with data.params as default_params with data.wasm as d with input as {}
    not safe_signer_threshold.allow with data.params as default_params with data.wasm as d with input as {}
}

# A numeric `input.chain_id` (some simulator paths) compares the same as the
# documented string form.
test_numeric_intent_chain_id_is_accepted if {
    d := wrap(clean_data)
    count(safe_signer_threshold.deny) == 0 with data.params as default_params with data.wasm as d with input as intent(11155111)
    safe_signer_threshold.allow with data.params as default_params with data.wasm as d with input as intent(11155111)
}

test_deny_numeric_intent_chain_id_mismatch if {
    d := wrap(clean_data)
    "chain_id_mismatch" in safe_signer_threshold.deny with data.params as default_params with data.wasm as d with input as intent(84532)
    not safe_signer_threshold.allow with data.params as default_params with data.wasm as d with input as intent(84532)
}

# A non-numeric string can't be normalized, so it reads as absent rather than
# as a match.
test_deny_unparseable_intent_chain_id if {
    d := wrap(clean_data)
    "intent_chain_id_missing" in safe_signer_threshold.deny with data.params as default_params with data.wasm as d with input as intent("mainnet")
    not safe_signer_threshold.allow with data.params as default_params with data.wasm as d with input as intent("mainnet")
}

# An oracle payload with no chain_id at all must not satisfy the comparison.
test_deny_when_oracle_omits_chain_id if {
    d := wrap({
        "safe_address": "0x1111111111111111111111111111111111111111",
        "threshold": 3,
        "owner_count": 4,
    })
    not safe_signer_threshold.allow with data.params as default_params with data.wasm as d with input as default_intent
}

# --- fail-closed behaviour --------------------------------------------------

test_deny_on_oracle_error if {
    d := wrap({"error": "rpc: empty result for 0xe75235b8 at 0x1111... (not a Safe?)"})
    "oracle_error" in safe_signer_threshold.deny with data.params as default_params with data.wasm as d with input as default_intent
    not safe_signer_threshold.allow with data.params as default_params with data.wasm as d with input as default_intent
}

# An error payload carries no safe_address/threshold/owner_count, so the
# other deny rules silent-skip. `allow` must still be false.
test_deny_on_empty_payload if {
    not safe_signer_threshold.allow with data.params as default_params with data.wasm as wrap({}) with input as default_intent
}

# Non-numeric field (e.g. a string smuggled through the oracle) must not
# satisfy the numeric comparisons in `allow`.
test_deny_on_non_numeric_threshold if {
    d := with_data({"threshold": "3"})
    not safe_signer_threshold.allow with data.params as default_params with data.wasm as d with input as default_intent
}

test_multiple_denies_do_not_fail_open if {
    d := with_data({
        "safe_address": "0x3333333333333333333333333333333333333333",
        "chain_id": 84532,
        "threshold": 1,
        "owner_count": 1,
    })
    deny := safe_signer_threshold.deny with data.params as default_params with data.wasm as d with input as default_intent
    "safe_address_mismatch" in deny
    "chain_id_mismatch" in deny
    "threshold_below_minimum" in deny
    "owners_below_minimum" in deny
    count(deny) >= 4
    not safe_signer_threshold.allow with data.params as default_params with data.wasm as d with input as default_intent
}
