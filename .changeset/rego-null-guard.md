---
"@newton-xyz/policy-pack-redstone": patch
"@newton-xyz/policy-pack-vaultsfyi": patch
---

The reference `policy.rego` now fails closed when an oracle field it compares is not a number. Rego orders null below every number, so a null field (what the oracle writes for a NaN) passed `<=` and `allow` came out true. Curators who copied the earlier Rego should redeploy their policy with this version.
