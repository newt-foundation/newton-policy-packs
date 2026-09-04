package safe_signer_threshold

import future.keywords

default allow := false

t := data.params

# Phase 0 § Stream B namespacing: every pack's WASM output is wrapped under
# its `PACK_ID` key by `policy.js`'s `wrapOutput("safe_signer_threshold", ...)` so the
# AVS-side shallow `merge_jsons` composes cleanly across packs without
# top-level key collisions on shared field names.
v := data.wasm.safe_signer_threshold

# The oracle could not read the Safe (bad address, RPC failure, non-Safe
# contract). Fail closed — an unreadable Safe is not a compliant Safe.
deny contains "oracle_error" if v.error

# The Safe the oracle actually read must be the one the wallet owner bound
# this policy to. Guards against a caller pointing wasm_args at some other
# well-configured Safe.
deny contains "safe_address_mismatch" if lower(v.safe_address) != lower(t.safe_address)

# The attested chain. Unlike most packs, this policy reads the INTENT as well
# as the oracle: the oracle chose which RPC to query from its own wasm_args, so
# nothing but the signed intent can confirm the Safe was read on the chain the
# transaction will actually execute on. Pointing wasm_args at a well-configured
# Sepolia Safe while executing on Base must not pass.
#
# `input.chain_id` arrives as a STRING (camelCase `chainId` in the intent JSON
# renders to snake_case here — see docs/CONTRIBUTING.md), while the oracle
# reports a number. Both shapes are normalized to a number; anything else
# leaves this undefined, which blocks `allow` below.
intent_chain_id := input.chain_id if is_number(input.chain_id)

intent_chain_id := to_number(input.chain_id) if is_string(input.chain_id)

deny contains "chain_id_mismatch" if intent_chain_id != v.chain_id

# newton-cli's `--chain-id` flag does NOT populate `input.chain_id` — only a
# `chainId` key in the intent JSON does. Report the absence rather than let the
# comparison above silent-skip into a pass.
deny contains "intent_chain_id_missing" if not intent_chain_id_valid

# Indirection through a rule is deliberate: `not is_number(intent_chain_id)`
# evaluates to *undefined* (not true) when `intent_chain_id` itself is
# undefined, because an undefined term makes the whole builtin call undefined.
# Negating a rule reference does what's wanted.
intent_chain_id_valid if is_number(intent_chain_id)

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
    intent_chain_id == v.chain_id
    v.threshold >= t.min_threshold
    v.owner_count >= t.min_owners
    v.owner_count <= t.max_owners
}

address_matches if lower(v.safe_address) == lower(t.safe_address)
