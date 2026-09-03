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
    "threshold": 3,
    "owner_count": 4,
}

# Phase 0 § Stream B namespacing: `policy.rego` reads from
# `data.wasm.safe_signer_threshold.<field>`, so test fixtures wrap the inner shape under the
# `safe_signer_threshold` key.
wrap(inner) := {"safe_signer_threshold": inner}

with_data(overrides) := wrap(object.union(clean_data, overrides))

test_allow_when_all_clean if {
    d := wrap(clean_data)
    safe_signer_threshold.allow with data.params as default_params with data.wasm as d
    count(safe_signer_threshold.deny) == 0 with data.params as default_params with data.wasm as d
}

test_deny_threshold_below_minimum if {
    d := with_data({"threshold": 1})
    "threshold_below_minimum" in safe_signer_threshold.deny with data.params as default_params with data.wasm as d
    not safe_signer_threshold.allow with data.params as default_params with data.wasm as d
}

test_allow_threshold_exactly_at_minimum if {
    d := with_data({"threshold": 2})
    not "threshold_below_minimum" in safe_signer_threshold.deny with data.params as default_params with data.wasm as d
    safe_signer_threshold.allow with data.params as default_params with data.wasm as d
}

test_deny_owners_below_minimum if {
    d := with_data({"owner_count": 2, "threshold": 2})
    "owners_below_minimum" in safe_signer_threshold.deny with data.params as default_params with data.wasm as d
    not safe_signer_threshold.allow with data.params as default_params with data.wasm as d
}

test_deny_owners_above_maximum if {
    d := with_data({"owner_count": 6})
    "owners_above_maximum" in safe_signer_threshold.deny with data.params as default_params with data.wasm as d
    not safe_signer_threshold.allow with data.params as default_params with data.wasm as d
}

test_allow_owners_at_both_bounds if {
    at_min := with_data({"owner_count": 3})
    at_max := with_data({"owner_count": 5})
    safe_signer_threshold.allow with data.params as default_params with data.wasm as at_min
    safe_signer_threshold.allow with data.params as default_params with data.wasm as at_max
}

test_deny_safe_address_mismatch if {
    d := with_data({"safe_address": "0x2222222222222222222222222222222222222222"})
    "safe_address_mismatch" in safe_signer_threshold.deny with data.params as default_params with data.wasm as d
    not safe_signer_threshold.allow with data.params as default_params with data.wasm as d
}

# The oracle lowercases the address it read; params may hold a checksummed
# (mixed-case) address. The comparison must not care.
test_address_match_is_case_insensitive if {
    p := object.union(default_params, {"safe_address": "0xABCdefABCDEFabcDEF0123456789abcdefABCdef"})
    d := with_data({"safe_address": "0xabcdefabcdefabcdef0123456789abcdefabcdef"})
    not "safe_address_mismatch" in safe_signer_threshold.deny with data.params as p with data.wasm as d
    safe_signer_threshold.allow with data.params as p with data.wasm as d
}

test_deny_on_oracle_error if {
    d := wrap({"error": "rpc: empty result for 0xe75235b8 at 0x1111... (not a Safe?)"})
    "oracle_error" in safe_signer_threshold.deny with data.params as default_params with data.wasm as d
    not safe_signer_threshold.allow with data.params as default_params with data.wasm as d
}

# An error payload carries no safe_address/threshold/owner_count, so the
# other deny rules silent-skip. `allow` must still be false.
test_deny_on_empty_payload if {
    not safe_signer_threshold.allow with data.params as default_params with data.wasm as wrap({})
}

# Non-numeric field (e.g. a string smuggled through the oracle) must not
# satisfy the numeric comparisons in `allow`.
test_deny_on_non_numeric_threshold if {
    d := with_data({"threshold": "3"})
    not safe_signer_threshold.allow with data.params as default_params with data.wasm as d
}

test_multiple_denies_do_not_fail_open if {
    d := with_data({
        "safe_address": "0x3333333333333333333333333333333333333333",
        "threshold": 1,
        "owner_count": 1,
    })
    deny := safe_signer_threshold.deny with data.params as default_params with data.wasm as d
    "safe_address_mismatch" in deny
    "threshold_below_minimum" in deny
    "owners_below_minimum" in deny
    count(deny) >= 3
    not safe_signer_threshold.allow with data.params as default_params with data.wasm as d
}

# A Safe on the other supported chain reads exactly the same — chain_id is
# reported for observability, not gated on.
test_base_sepolia_safe_allows if {
    d := with_data({"chain_id": 84532})
    safe_signer_threshold.allow with data.params as default_params with data.wasm as d
}
