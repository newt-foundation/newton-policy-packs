package tempora_acv_calldata_gate

import future.keywords

# Tempora's "Step 1" from their sequencing proposal: the three rule types
# that only need the call's own calldata to decide — destination allowlist,
# permitted operations, absolute size backstop — enforced with ZERO oracle
# data and zero vendor dependency. This is deliberately NOT a composite over
# any policy pack: there is no data.wasm.* reference anywhere below.
#
# Because this gate has no oracle module in its composite manifest, it has
# no params slot to read either — "composite params are bijective with the
# oracle module set" (see manage-yield-source-gate, the precedent this
# mirrors). The three constants below are Rego constants, not on-chain
# params: change one, redeploy this policy. That is the same tradeoff
# manage-yield-source-gate already ships with for its target_vault constant.
#
# Concretely gates Morpho VaultV2's allocate()/deallocate() — confirmed
# from @morpho-org/blue-sdk-viem's ABI:
#   allocate(address adapter, bytes data, uint256 assets)
#   deallocate(address adapter, bytes data, uint256 assets)
# This is the "VaultV2 gap" raised early in the Tempora thread: VaultKit's
# typed shield.morpho.reallocate helper only targets MetaMorpho V1.1, but
# the generic guardedCall/sendCall path already gates VaultV2's raw
# allocate/deallocate calldata today — this Rego is exactly that generic
# path, hand-written against VaultV2's real ABI, no typed helper needed.

default allow := false

# The specific VaultV2 feeder vault-of-vaults this policy is bound to (one
# Shield instance per (curator, vault) — see vaultkit README). Placeholder:
# Tempora's own example feeder vault, shared in-thread —
# https://curator.morpho.org/vaults/8453/0xD65AB9B277b65AC077B83352C0b45FeA18973DD9
# (Base, chain id 8453). Replace with the real deployed target before use.
target_vault := "0xd65ab9b277b65ac077b83352c0b45fea18973dd9"

# The investable universe: adapter addresses allocate()/deallocate() may
# target. Placeholder set copied verbatim from the policy.rego Tempora
# shared in-thread on 8/6 (their "allowed_leaves"). Replace with the real
# curated set before use — this is example data, not a recommendation.
allowed_leaves := {
    "0xbeefe94c8ad530842bfe7d8b397938ffc1cb83b2",
    "0xbeef010f9cb27031ad51e3333f9af9c6b1228183",
    "0x1401d1271c47648ac70cbcdfa3776d4a87ce006b",
    "0xc1256ae5ff1cf2719d4937adb3bbccab2e00a2ca",
    "0x7bfa7c4f149e7415b73bdedfe609237e29cbf34a",
    "0xef417a2512c5a41f69ae4e021648b69a7cde5d03",
    "0xc0c5689e6f4d256e861f65465b691aeecc0deb12",
    "0x236919f11ff9ea9550a4287696c2fc9e18e6e890",
}

# Absolute size backstop, in the vault's asset base units (e.g. 6-decimal
# USDC: 100_000_000000 = 100k). Placeholder — set to the mandate's real cap.
# Caveat: Rego's to_number() is float64, so this comparison loses precision
# on values that don't fit in 53 bits (~9.007e15 base units — e.g. beyond
# ~9B tokens at 6 decimals, ~9M at 18). Fine for a backstop at any realistic
# vault size; would need a bigint-safe comparison (chunked string compare)
# if this pack is ever bound to a vault with base-unit caps near that range.
max_assets_per_call := 100000000000

# AVS renders decoded args as flat JSON strings (see manage-yield-source-gate
# for the same convention): arg[0] = adapter (address), arg[1] = data
# (bytes, deliberately not sliced — Merkle-proof calldata bound on-chain,
# same reasoning as executeHooks), arg[2] = assets (uint256, as a string).

deny contains "action:not_allocate_or_deallocate" if {
    not startswith(input.decoded_function_signature, "function allocate(address,bytes,uint256)")
    not startswith(input.decoded_function_signature, "function deallocate(address,bytes,uint256)")
}

deny contains "action:wrong_target" if {
    lower(input.to) != target_vault
}

deny contains "action:adapter_not_allowlisted" if {
    adapter := lower(input.decoded_function_arguments[0])
    not adapter in allowed_leaves
}

deny contains "action:assets_over_max" if {
    to_number(input.decoded_function_arguments[2]) > max_assets_per_call
}

allow if {
    is_string(input.to)
    is_string(input.decoded_function_signature)
    is_array(input.decoded_function_arguments)
    # allocate/deallocate both take exactly 3 args (adapter, data, assets) -
    # without this, a malformed/truncated args array on an otherwise-
    # matching signature would silently skip the adapter/assets checks
    # below (an undefined index just makes their `deny` rule not fire)
    # instead of denying.
    count(input.decoded_function_arguments) == 3
    not action_not_allocate_or_deallocate_blocks
    not wrong_target_blocks
    not adapter_not_allowlisted_blocks
    not assets_over_max_blocks
}

action_not_allocate_or_deallocate_blocks if {
    not startswith(input.decoded_function_signature, "function allocate(address,bytes,uint256)")
    not startswith(input.decoded_function_signature, "function deallocate(address,bytes,uint256)")
}

wrong_target_blocks if {
    lower(input.to) != target_vault
}

adapter_not_allowlisted_blocks if {
    adapter := lower(input.decoded_function_arguments[0])
    not adapter in allowed_leaves
}

assets_over_max_blocks if {
    to_number(input.decoded_function_arguments[2]) > max_assets_per_call
}
