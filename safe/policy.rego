package safe_signer_threshold

import future.keywords

default allow := false

t := data.params

# Phase 0 § Stream B namespacing: every pack's WASM output is wrapped under
# its `PACK_ID` key by `policy.js`'s `wrapOutput("safe", ...)` so the
# AVS-side shallow `merge_jsons` composes cleanly across packs without
# top-level key collisions on shared field names.
v := data.wasm.safe

# The oracle could not read the Safe (bad address, RPC failure, non-Safe
# contract). Fail closed — an unreadable Safe is not a compliant Safe.
deny contains "oracle_error" if v.error

# The Safe the oracle actually read must be the one the wallet owner bound
# this policy to. Guards against a caller pointing wasm_args at some other
# well-configured Safe.
deny contains "safe_address_mismatch" if lower(v.safe_address) != lower(t.safe_address)

deny contains "threshold_below_minimum" if v.threshold < t.min_threshold

deny contains "owners_below_minimum" if v.owner_count < t.min_owners

deny contains "owners_above_maximum" if v.owner_count > t.max_owners

# Positive assertions rather than `count(deny) == 0`: an empty or malformed
# pack slot leaves every field undefined, which silent-skips all the deny
# rules above. Requiring the fields to be present and numeric fails closed.
allow if {
    not v.error
    address_matches
    is_number(v.threshold)
    is_number(v.owner_count)
    v.threshold >= t.min_threshold
    v.owner_count >= t.min_owners
    v.owner_count <= t.max_owners
}

address_matches if lower(v.safe_address) == lower(t.safe_address)
