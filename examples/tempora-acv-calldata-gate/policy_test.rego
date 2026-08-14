package tempora_acv_calldata_gate_test

import data.tempora_acv_calldata_gate

target_vault := "0xd65ab9b277b65ac077b83352c0b45fea18973dd9"

allowed_adapter := "0xbeefe94c8ad530842bfe7d8b397938ffc1cb83b2"

other_adapter := "0x000000000000000000000000000000000000ff"

clean_allocate_input := {
    "to": target_vault,
    "decoded_function_signature": "function allocate(address,bytes,uint256)",
    "decoded_function_arguments": [allowed_adapter, "0x", "1000000000"],
}

clean_deallocate_input := {
    "to": target_vault,
    "decoded_function_signature": "function deallocate(address,bytes,uint256)",
    "decoded_function_arguments": [allowed_adapter, "0x", "1000000000"],
}

test_allow_clean_allocate if {
    tempora_acv_calldata_gate.allow with input as clean_allocate_input
    count(tempora_acv_calldata_gate.deny) == 0 with input as clean_allocate_input
}

test_allow_clean_deallocate if {
    tempora_acv_calldata_gate.allow with input as clean_deallocate_input
}

test_deny_wrong_function if {
    i := object.union(clean_allocate_input, {"decoded_function_signature": "function setOwner(address)"})
    "action:not_allocate_or_deallocate" in tempora_acv_calldata_gate.deny with input as i
    not tempora_acv_calldata_gate.allow with input as i
}

test_deny_wrong_target if {
    i := object.union(clean_allocate_input, {"to": "0x000000000000000000000000000000000000aa"})
    "action:wrong_target" in tempora_acv_calldata_gate.deny with input as i
    not tempora_acv_calldata_gate.allow with input as i
}

test_target_check_is_case_insensitive if {
    i := object.union(clean_allocate_input, {"to": upper(target_vault)})
    not "action:wrong_target" in tempora_acv_calldata_gate.deny with input as i
    tempora_acv_calldata_gate.allow with input as i
}

test_deny_adapter_not_allowlisted if {
    i := object.union(clean_allocate_input, {"decoded_function_arguments": [other_adapter, "0x", "1000000000"]})
    "action:adapter_not_allowlisted" in tempora_acv_calldata_gate.deny with input as i
    not tempora_acv_calldata_gate.allow with input as i
}

test_adapter_check_is_case_insensitive if {
    i := object.union(clean_allocate_input, {"decoded_function_arguments": [upper(allowed_adapter), "0x", "1000000000"]})
    not "action:adapter_not_allowlisted" in tempora_acv_calldata_gate.deny with input as i
    tempora_acv_calldata_gate.allow with input as i
}

test_deny_assets_over_max if {
    i := object.union(clean_allocate_input, {"decoded_function_arguments": [allowed_adapter, "0x", "999999999999999"]})
    "action:assets_over_max" in tempora_acv_calldata_gate.deny with input as i
    not tempora_acv_calldata_gate.allow with input as i
}

test_allow_assets_exactly_at_max if {
    i := object.union(clean_allocate_input, {"decoded_function_arguments": [allowed_adapter, "0x", "100000000000"]})
    not "action:assets_over_max" in tempora_acv_calldata_gate.deny with input as i
    tempora_acv_calldata_gate.allow with input as i
}

test_deny_on_truncated_args if {
    # Signature matches, but the args array is short (malformed decode) -
    # must not silently skip the adapter/assets checks and fall through.
    i := object.union(clean_allocate_input, {"decoded_function_arguments": [allowed_adapter]})
    not tempora_acv_calldata_gate.allow with input as i
}

test_deny_on_empty_input if {
    not tempora_acv_calldata_gate.allow with input as {}
}

test_multiple_denies_do_not_fail_open if {
    i := {
        "to": "0x000000000000000000000000000000000000aa",
        "decoded_function_signature": "function setOwner(address)",
        "decoded_function_arguments": [other_adapter, "0x", "999999999999999"],
    }
    deny := tempora_acv_calldata_gate.deny with input as i
    "action:not_allocate_or_deallocate" in deny
    "action:wrong_target" in deny
    "action:adapter_not_allowlisted" in deny
    "action:assets_over_max" in deny
    count(deny) >= 4
    not tempora_acv_calldata_gate.allow with input as i
}
