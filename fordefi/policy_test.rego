package fordefi_transaction_safety_test

import data.fordefi_transaction_safety

default_params := {
    "min_signatures": 3
}

passing_tx := {
  "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
  "created_at": "2019-08-24T14:15:22Z",
  "modified_at": "2019-08-24T14:15:22Z",
  "managed_transaction_data": {
    "created_by": {
      "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
      "user_type": "person",
      "name": "John Doe",
      "email": "string",
      "state": "active",
      "role": "admin"
    },
    "aborted_by": {
      "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
      "user_type": "person",
      "name": "John Doe",
      "email": "string",
      "state": "active",
      "role": "admin"
    },
    "finalized_for_signing_by": {
      "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
      "user_type": "person",
      "name": "John Doe",
      "email": "string",
      "state": "active",
      "role": "admin"
    },
    "device_signing_request": {
      "created_by": {
        "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
        "user_type": "person",
        "name": "John Doe",
        "email": "string",
        "state": "active",
        "role": "admin"
      },
      "signers": [
        {
          "user": {
            "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
            "user_type": "person",
            "name": "John Doe",
            "email": "string",
            "state": "active",
            "role": "admin"
          },
          "modified_at": "2019-08-24T14:15:22Z",
          "has_signed": true
        }
      ]
    },
    "approval_request": {
      "state": "created",
      "required_groups": 0,
      "approval_groups": [
        {
          "quorum_size": 0,
          "approvers": [
            {
              "user": {},
              "modified_at": "2019-08-24T14:15:22Z",
              "decision": "string",
              "state": "pending"
            }
          ]
        }
      ],
      "error_message": "string"
    },
    "aml_policy_match": {
      "is_default": true,
      "rule_id": "728c1541-d6d1-4290-9a53-cdf01dd32d60",
      "rule_name": "string",
      "action_type": "allow"
    },
    "policy_match": {
      "is_default": true,
      "rule_id": "728c1541-d6d1-4290-9a53-cdf01dd32d60",
      "rule_name": "string",
      "action_type": "allow"
    },
    "signer_type": "initiator",
    "risks": [],
    "error_pushing_to_blockchain_message": "string",
    "original_error_pushing_to_blockchain_message": "string",
    "vault": {
      "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
      "vault_group_id": "948d8050-0dde-409f-985b-6d7b133fc9e8",
      "vault_group_ids": [
        "497f6eca-6276-4993-bfeb-53cbbbba6f08"
      ],
      "name": "string",
      "address": "string",
      "state": "active",
      "type": "aptos",
      "logo_url": "http://example.com",
      "end_user": {
        "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
        "user_type": "end_user",
        "external_id": "user|1234",
        "state": "active"
      },
      "is_external_signer": false
    },
    "idempotence_id": "20a3c79f-f547-44b3-bdfc-d8aea82ad496",
    "has_current_user_vault_permissions": true,
    "batch_data": {
      "batch_id": "4da22c97-b7d5-4e31-8c3a-03870ebc7b20",
      "index_in_batch": 0,
      "batch_size": 0,
      "matched_policies": [
        {
          "is_default": true,
          "rule_id": "728c1541-d6d1-4290-9a53-cdf01dd32d60",
          "rule_name": "string",
          "action_type": "allow"
        }
      ]
    },
    "push_mode": "auto",
    "last_pushed_at": "2019-08-24T14:15:22Z",
    "sign_mode": "auto",
    "fee_paid_by": {
      "type": "vault",
      "vault": {
        "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
        "vault_group_id": "948d8050-0dde-409f-985b-6d7b133fc9e8",
        "vault_group_ids": [
          "497f6eca-6276-4993-bfeb-53cbbbba6f08"
        ],
        "name": "string",
        "address": "string",
        "state": "active",
        "type": "aptos",
        "logo_url": "http://example.com",
        "end_user": {
          "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
          "user_type": "end_user",
          "external_id": "user|1234",
          "state": "active"
        },
        "is_external_signer": false
      }
    },
    "attested_payload_for_signing": "string",
    "tx_policy_explanation_id": "1a8ad71c-266a-4642-bb49-fea1ea66fcc2"
  },
  "signatures": [
    {
      "data": "SGVsbG8=",
      "signed_by": {
        "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
        "user_type": "person",
        "name": "John Doe",
        "email": "string",
        "state": "active",
        "role": "admin"
      }
    },
    {
      "data": "SGVsbG8=",
      "signed_by": {
        "id": "597f6eca-6276-4993-bfeb-53cbbbba6f08",
        "user_type": "person",
        "name": "Jane Doe",
        "email": "string",
        "state": "active",
        "role": "admin"
      }
    },
    {
      "data": "SGVsbG8=",
      "signed_by": {
        "id": "697f6eca-6276-4993-bfeb-53cbbbba6f08",
        "user_type": "person",
        "name": "Jimmy Doe",
        "email": "string",
        "state": "active",
        "role": "admin"
      }
    }
  ],
  "note": "string",
  "spam_state": "unset",
  "direction": "outgoing",
  "signed_externally": false,
  "interacted_vaults": [
    {
      "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
      "vault_group_id": "948d8050-0dde-409f-985b-6d7b133fc9e8",
      "vault_group_ids": [
        "497f6eca-6276-4993-bfeb-53cbbbba6f08"
      ],
      "name": "string",
      "address": "string",
      "state": "active",
      "type": "aptos",
      "logo_url": "http://example.com",
      "end_user": {
        "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
        "user_type": "end_user",
        "external_id": "user|1234",
        "state": "active"
      },
      "is_external_signer": false
    }
  ],
  "related_transactions": [
    {
      "type": "swap_fulfilled_by",
      "hash": "string",
      "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
      "chain": {
        "chain_type": "aptos",
        "unique_id": "aptos_mainnet",
        "name": "string",
        "native_currency_symbol": "ETH",
        "native_currency_name": "Ether",
        "blockchain_explorer": {
          "transaction_url": "https://etherscan.io/tx/",
          "address_url": "https://etherscan.io/address/",
          "root_url": "https://etherscan.io/",
          "transaction_format_url": "https://etherscan.io/tx/%s",
          "address_format_url": "https://etherscan.io/address/%s",
          "asset_format_url": "https://etherscan.io/address/%s"
        },
        "logo_url": "http://example.com",
        "is_testnet": true,
        "is_enabled": true
      },
      "explorer_url": "http://example.com"
    }
  ],
  "organization_id": "7c60d51f-b44e-4682-87d6-449835ea4de6",
  "state": "waiting_for_approval",
  "state_changes": [
    {
      "changed_at": "2019-08-24T14:15:22Z",
      "reason": "failed_to_verify_signature",
      "previous_state": "waiting_for_approval",
      "new_state": "waiting_for_approval"
    }
  ],
  "type": "aptos_message",
  "aptos_message_type": "personal_message_type",
  "raw_original_message_to_sign": "SGVsbG8=",
  "string_original_message_to_sign": "string",
  "raw_full_message_to_sign": "SGVsbG8=",
  "string_full_message_to_sign": "string",
  "chain": {
    "chain_type": "aptos",
    "unique_id": "aptos_mainnet",
    "name": "string",
    "native_currency_symbol": "ETH",
    "native_currency_name": "Ether",
    "blockchain_explorer": {
      "transaction_url": "https://etherscan.io/tx/",
      "address_url": "https://etherscan.io/address/",
      "root_url": "https://etherscan.io/",
      "transaction_format_url": "https://etherscan.io/tx/%s",
      "address_format_url": "https://etherscan.io/address/%s",
      "asset_format_url": "https://etherscan.io/address/%s"
    },
    "logo_url": "http://example.com",
    "is_testnet": true,
    "is_enabled": true
  },
  "sender": {
    "vault": {
      "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
      "vault_group_id": "948d8050-0dde-409f-985b-6d7b133fc9e8",
      "vault_group_ids": [
        "497f6eca-6276-4993-bfeb-53cbbbba6f08"
      ],
      "name": "string",
      "address": "string",
      "state": "active",
      "type": "aptos",
      "logo_url": "http://example.com",
      "end_user": {
        "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
        "user_type": "end_user",
        "external_id": "user|1234",
        "state": "active"
      },
      "is_external_signer": false
    },
    "explorer_url": "http://example.com",
    "contact": {
      "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
      "name": "string",
      "address_ref": {
        "chain_type": "aptos",
        "address": "0x3300c18e7b931bdfc73dccf3e2d043ad1c9d120c777fff5aeeb9956224e5247a",
        "chains": [
          {
            "chain_type": "aptos",
            "unique_id": "aptos_mainnet"
          }
        ]
      }
    },
    "type": "aptos",
    "address": "0x3300c18e7b931bdfc73dccf3e2d043ad1c9d120c777fff5aeeb9956224e5247a"
  }
}

externally_signed := {
  "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
  "created_at": "2019-08-24T14:15:22Z",
  "modified_at": "2019-08-24T14:15:22Z",
  "managed_transaction_data": {
    "created_by": {
      "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
      "user_type": "person",
      "name": "John Doe",
      "email": "string",
      "state": "active",
      "role": "admin"
    },
    "aborted_by": {
      "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
      "user_type": "person",
      "name": "John Doe",
      "email": "string",
      "state": "active",
      "role": "admin"
    },
    "finalized_for_signing_by": {
      "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
      "user_type": "person",
      "name": "John Doe",
      "email": "string",
      "state": "active",
      "role": "admin"
    },
    "device_signing_request": {
      "created_by": {
        "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
        "user_type": "person",
        "name": "John Doe",
        "email": "string",
        "state": "active",
        "role": "admin"
      },
      "signers": [
        {
          "user": {
            "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
            "user_type": "person",
            "name": "John Doe",
            "email": "string",
            "state": "active",
            "role": "admin"
          },
          "modified_at": "2019-08-24T14:15:22Z",
          "has_signed": true
        }
      ]
    },
    "approval_request": {
      "state": "created",
      "required_groups": 0,
      "approval_groups": [
        {
          "quorum_size": 0,
          "approvers": [
            {
              "user": {},
              "modified_at": "2019-08-24T14:15:22Z",
              "decision": "string",
              "state": "pending"
            }
          ]
        }
      ],
      "error_message": "string"
    },
    "aml_policy_match": {
      "is_default": true,
      "rule_id": "728c1541-d6d1-4290-9a53-cdf01dd32d60",
      "rule_name": "string",
      "action_type": "allow"
    },
    "policy_match": {
      "is_default": true,
      "rule_id": "728c1541-d6d1-4290-9a53-cdf01dd32d60",
      "rule_name": "string",
      "action_type": "allow"
    },
    "signer_type": "initiator",
    "risks": [],
    "error_pushing_to_blockchain_message": "string",
    "original_error_pushing_to_blockchain_message": "string",
    "vault": {
      "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
      "vault_group_id": "948d8050-0dde-409f-985b-6d7b133fc9e8",
      "vault_group_ids": [
        "497f6eca-6276-4993-bfeb-53cbbbba6f08"
      ],
      "name": "string",
      "address": "string",
      "state": "active",
      "type": "aptos",
      "logo_url": "http://example.com",
      "end_user": {
        "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
        "user_type": "end_user",
        "external_id": "user|1234",
        "state": "active"
      },
      "is_external_signer": false
    },
    "idempotence_id": "20a3c79f-f547-44b3-bdfc-d8aea82ad496",
    "has_current_user_vault_permissions": true,
    "batch_data": {
      "batch_id": "4da22c97-b7d5-4e31-8c3a-03870ebc7b20",
      "index_in_batch": 0,
      "batch_size": 0,
      "matched_policies": [
        {
          "is_default": true,
          "rule_id": "728c1541-d6d1-4290-9a53-cdf01dd32d60",
          "rule_name": "string",
          "action_type": "allow"
        }
      ]
    },
    "push_mode": "auto",
    "last_pushed_at": "2019-08-24T14:15:22Z",
    "sign_mode": "auto",
    "fee_paid_by": {
      "type": "vault",
      "vault": {
        "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
        "vault_group_id": "948d8050-0dde-409f-985b-6d7b133fc9e8",
        "vault_group_ids": [
          "497f6eca-6276-4993-bfeb-53cbbbba6f08"
        ],
        "name": "string",
        "address": "string",
        "state": "active",
        "type": "aptos",
        "logo_url": "http://example.com",
        "end_user": {
          "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
          "user_type": "end_user",
          "external_id": "user|1234",
          "state": "active"
        },
        "is_external_signer": false
      }
    },
    "attested_payload_for_signing": "string",
    "tx_policy_explanation_id": "1a8ad71c-266a-4642-bb49-fea1ea66fcc2"
  },
  "signatures": [
    {
      "data": "SGVsbG8=",
      "signed_by": {
        "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
        "user_type": "person",
        "name": "John Doe",
        "email": "string",
        "state": "active",
        "role": "admin"
      }
    },
    {
      "data": "SGVsbG8=",
      "signed_by": {
        "id": "597f6eca-6276-4993-bfeb-53cbbbba6f08",
        "user_type": "person",
        "name": "Jane Doe",
        "email": "string",
        "state": "active",
        "role": "admin"
      }
    },
    {
      "data": "SGVsbG8=",
      "signed_by": {
        "id": "697f6eca-6276-4993-bfeb-53cbbbba6f08",
        "user_type": "person",
        "name": "Jimmy Doe",
        "email": "string",
        "state": "active",
        "role": "admin"
      }
    }
  ],
  "note": "string",
  "spam_state": "unset",
  "direction": "outgoing",
  "signed_externally": true,
  "interacted_vaults": [
    {
      "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
      "vault_group_id": "948d8050-0dde-409f-985b-6d7b133fc9e8",
      "vault_group_ids": [
        "497f6eca-6276-4993-bfeb-53cbbbba6f08"
      ],
      "name": "string",
      "address": "string",
      "state": "active",
      "type": "aptos",
      "logo_url": "http://example.com",
      "end_user": {
        "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
        "user_type": "end_user",
        "external_id": "user|1234",
        "state": "active"
      },
      "is_external_signer": false
    }
  ],
  "related_transactions": [
    {
      "type": "swap_fulfilled_by",
      "hash": "string",
      "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
      "chain": {
        "chain_type": "aptos",
        "unique_id": "aptos_mainnet",
        "name": "string",
        "native_currency_symbol": "ETH",
        "native_currency_name": "Ether",
        "blockchain_explorer": {
          "transaction_url": "https://etherscan.io/tx/",
          "address_url": "https://etherscan.io/address/",
          "root_url": "https://etherscan.io/",
          "transaction_format_url": "https://etherscan.io/tx/%s",
          "address_format_url": "https://etherscan.io/address/%s",
          "asset_format_url": "https://etherscan.io/address/%s"
        },
        "logo_url": "http://example.com",
        "is_testnet": true,
        "is_enabled": true
      },
      "explorer_url": "http://example.com"
    }
  ],
  "organization_id": "7c60d51f-b44e-4682-87d6-449835ea4de6",
  "state": "waiting_for_approval",
  "state_changes": [
    {
      "changed_at": "2019-08-24T14:15:22Z",
      "reason": "failed_to_verify_signature",
      "previous_state": "waiting_for_approval",
      "new_state": "waiting_for_approval"
    }
  ],
  "type": "aptos_message",
  "aptos_message_type": "personal_message_type",
  "raw_original_message_to_sign": "SGVsbG8=",
  "string_original_message_to_sign": "string",
  "raw_full_message_to_sign": "SGVsbG8=",
  "string_full_message_to_sign": "string",
  "chain": {
    "chain_type": "aptos",
    "unique_id": "aptos_mainnet",
    "name": "string",
    "native_currency_symbol": "ETH",
    "native_currency_name": "Ether",
    "blockchain_explorer": {
      "transaction_url": "https://etherscan.io/tx/",
      "address_url": "https://etherscan.io/address/",
      "root_url": "https://etherscan.io/",
      "transaction_format_url": "https://etherscan.io/tx/%s",
      "address_format_url": "https://etherscan.io/address/%s",
      "asset_format_url": "https://etherscan.io/address/%s"
    },
    "logo_url": "http://example.com",
    "is_testnet": true,
    "is_enabled": true
  },
  "sender": {
    "vault": {
      "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
      "vault_group_id": "948d8050-0dde-409f-985b-6d7b133fc9e8",
      "vault_group_ids": [
        "497f6eca-6276-4993-bfeb-53cbbbba6f08"
      ],
      "name": "string",
      "address": "string",
      "state": "active",
      "type": "aptos",
      "logo_url": "http://example.com",
      "end_user": {
        "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
        "user_type": "end_user",
        "external_id": "user|1234",
        "state": "active"
      },
      "is_external_signer": false
    },
    "explorer_url": "http://example.com",
    "contact": {
      "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
      "name": "string",
      "address_ref": {
        "chain_type": "aptos",
        "address": "0x3300c18e7b931bdfc73dccf3e2d043ad1c9d120c777fff5aeeb9956224e5247a",
        "chains": [
          {
            "chain_type": "aptos",
            "unique_id": "aptos_mainnet"
          }
        ]
      }
    },
    "type": "aptos",
    "address": "0x3300c18e7b931bdfc73dccf3e2d043ad1c9d120c777fff5aeeb9956224e5247a"
  }
}

aml_failed := {
  "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
  "created_at": "2019-08-24T14:15:22Z",
  "modified_at": "2019-08-24T14:15:22Z",
  "managed_transaction_data": {
    "created_by": {
      "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
      "user_type": "person",
      "name": "John Doe",
      "email": "string",
      "state": "active",
      "role": "admin"
    },
    "aborted_by": {
      "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
      "user_type": "person",
      "name": "John Doe",
      "email": "string",
      "state": "active",
      "role": "admin"
    },
    "finalized_for_signing_by": {
      "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
      "user_type": "person",
      "name": "John Doe",
      "email": "string",
      "state": "active",
      "role": "admin"
    },
    "device_signing_request": {
      "created_by": {
        "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
        "user_type": "person",
        "name": "John Doe",
        "email": "string",
        "state": "active",
        "role": "admin"
      },
      "signers": [
        {
          "user": {
            "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
            "user_type": "person",
            "name": "John Doe",
            "email": "string",
            "state": "active",
            "role": "admin"
          },
          "modified_at": "2019-08-24T14:15:22Z",
          "has_signed": true
        }
      ]
    },
    "approval_request": {
      "state": "created",
      "required_groups": 0,
      "approval_groups": [
        {
          "quorum_size": 0,
          "approvers": [
            {
              "user": {},
              "modified_at": "2019-08-24T14:15:22Z",
              "decision": "string",
              "state": "pending"
            }
          ]
        }
      ],
      "error_message": "string"
    },
    "aml_policy_match": {
      "is_default": true,
      "rule_id": "728c1541-d6d1-4290-9a53-cdf01dd32d60",
      "rule_name": "string",
      "action_type": "block"
    },
    "policy_match": {
      "is_default": true,
      "rule_id": "728c1541-d6d1-4290-9a53-cdf01dd32d60",
      "rule_name": "string",
      "action_type": "allow"
    },
    "signer_type": "initiator",
    "risks": [],
    "error_pushing_to_blockchain_message": "string",
    "original_error_pushing_to_blockchain_message": "string",
    "vault": {
      "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
      "vault_group_id": "948d8050-0dde-409f-985b-6d7b133fc9e8",
      "vault_group_ids": [
        "497f6eca-6276-4993-bfeb-53cbbbba6f08"
      ],
      "name": "string",
      "address": "string",
      "state": "active",
      "type": "aptos",
      "logo_url": "http://example.com",
      "end_user": {
        "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
        "user_type": "end_user",
        "external_id": "user|1234",
        "state": "active"
      },
      "is_external_signer": false
    },
    "idempotence_id": "20a3c79f-f547-44b3-bdfc-d8aea82ad496",
    "has_current_user_vault_permissions": true,
    "batch_data": {
      "batch_id": "4da22c97-b7d5-4e31-8c3a-03870ebc7b20",
      "index_in_batch": 0,
      "batch_size": 0,
      "matched_policies": [
        {
          "is_default": true,
          "rule_id": "728c1541-d6d1-4290-9a53-cdf01dd32d60",
          "rule_name": "string",
          "action_type": "allow"
        }
      ]
    },
    "push_mode": "auto",
    "last_pushed_at": "2019-08-24T14:15:22Z",
    "sign_mode": "auto",
    "fee_paid_by": {
      "type": "vault",
      "vault": {
        "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
        "vault_group_id": "948d8050-0dde-409f-985b-6d7b133fc9e8",
        "vault_group_ids": [
          "497f6eca-6276-4993-bfeb-53cbbbba6f08"
        ],
        "name": "string",
        "address": "string",
        "state": "active",
        "type": "aptos",
        "logo_url": "http://example.com",
        "end_user": {
          "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
          "user_type": "end_user",
          "external_id": "user|1234",
          "state": "active"
        },
        "is_external_signer": false
      }
    },
    "attested_payload_for_signing": "string",
    "tx_policy_explanation_id": "1a8ad71c-266a-4642-bb49-fea1ea66fcc2"
  },
  "signatures": [
    {
      "data": "SGVsbG8=",
      "signed_by": {
        "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
        "user_type": "person",
        "name": "John Doe",
        "email": "string",
        "state": "active",
        "role": "admin"
      }
    },
    {
      "data": "SGVsbG8=",
      "signed_by": {
        "id": "597f6eca-6276-4993-bfeb-53cbbbba6f08",
        "user_type": "person",
        "name": "Jane Doe",
        "email": "string",
        "state": "active",
        "role": "admin"
      }
    },
    {
      "data": "SGVsbG8=",
      "signed_by": {
        "id": "697f6eca-6276-4993-bfeb-53cbbbba6f08",
        "user_type": "person",
        "name": "Jimmy Doe",
        "email": "string",
        "state": "active",
        "role": "admin"
      }
    }
  ],
  "note": "string",
  "spam_state": "unset",
  "direction": "outgoing",
  "signed_externally": false,
  "interacted_vaults": [
    {
      "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
      "vault_group_id": "948d8050-0dde-409f-985b-6d7b133fc9e8",
      "vault_group_ids": [
        "497f6eca-6276-4993-bfeb-53cbbbba6f08"
      ],
      "name": "string",
      "address": "string",
      "state": "active",
      "type": "aptos",
      "logo_url": "http://example.com",
      "end_user": {
        "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
        "user_type": "end_user",
        "external_id": "user|1234",
        "state": "active"
      },
      "is_external_signer": false
    }
  ],
  "related_transactions": [
    {
      "type": "swap_fulfilled_by",
      "hash": "string",
      "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
      "chain": {
        "chain_type": "aptos",
        "unique_id": "aptos_mainnet",
        "name": "string",
        "native_currency_symbol": "ETH",
        "native_currency_name": "Ether",
        "blockchain_explorer": {
          "transaction_url": "https://etherscan.io/tx/",
          "address_url": "https://etherscan.io/address/",
          "root_url": "https://etherscan.io/",
          "transaction_format_url": "https://etherscan.io/tx/%s",
          "address_format_url": "https://etherscan.io/address/%s",
          "asset_format_url": "https://etherscan.io/address/%s"
        },
        "logo_url": "http://example.com",
        "is_testnet": true,
        "is_enabled": true
      },
      "explorer_url": "http://example.com"
    }
  ],
  "organization_id": "7c60d51f-b44e-4682-87d6-449835ea4de6",
  "state": "waiting_for_approval",
  "state_changes": [
    {
      "changed_at": "2019-08-24T14:15:22Z",
      "reason": "failed_to_verify_signature",
      "previous_state": "waiting_for_approval",
      "new_state": "waiting_for_approval"
    }
  ],
  "type": "aptos_message",
  "aptos_message_type": "personal_message_type",
  "raw_original_message_to_sign": "SGVsbG8=",
  "string_original_message_to_sign": "string",
  "raw_full_message_to_sign": "SGVsbG8=",
  "string_full_message_to_sign": "string",
  "chain": {
    "chain_type": "aptos",
    "unique_id": "aptos_mainnet",
    "name": "string",
    "native_currency_symbol": "ETH",
    "native_currency_name": "Ether",
    "blockchain_explorer": {
      "transaction_url": "https://etherscan.io/tx/",
      "address_url": "https://etherscan.io/address/",
      "root_url": "https://etherscan.io/",
      "transaction_format_url": "https://etherscan.io/tx/%s",
      "address_format_url": "https://etherscan.io/address/%s",
      "asset_format_url": "https://etherscan.io/address/%s"
    },
    "logo_url": "http://example.com",
    "is_testnet": true,
    "is_enabled": true
  },
  "sender": {
    "vault": {
      "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
      "vault_group_id": "948d8050-0dde-409f-985b-6d7b133fc9e8",
      "vault_group_ids": [
        "497f6eca-6276-4993-bfeb-53cbbbba6f08"
      ],
      "name": "string",
      "address": "string",
      "state": "active",
      "type": "aptos",
      "logo_url": "http://example.com",
      "end_user": {
        "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
        "user_type": "end_user",
        "external_id": "user|1234",
        "state": "active"
      },
      "is_external_signer": false
    },
    "explorer_url": "http://example.com",
    "contact": {
      "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
      "name": "string",
      "address_ref": {
        "chain_type": "aptos",
        "address": "0x3300c18e7b931bdfc73dccf3e2d043ad1c9d120c777fff5aeeb9956224e5247a",
        "chains": [
          {
            "chain_type": "aptos",
            "unique_id": "aptos_mainnet"
          }
        ]
      }
    },
    "type": "aptos",
    "address": "0x3300c18e7b931bdfc73dccf3e2d043ad1c9d120c777fff5aeeb9956224e5247a"
  }
}

insufficient_signatures := {
  "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
  "created_at": "2019-08-24T14:15:22Z",
  "modified_at": "2019-08-24T14:15:22Z",
  "managed_transaction_data": {
    "created_by": {
      "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
      "user_type": "person",
      "name": "John Doe",
      "email": "string",
      "state": "active",
      "role": "admin"
    },
    "aborted_by": {
      "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
      "user_type": "person",
      "name": "John Doe",
      "email": "string",
      "state": "active",
      "role": "admin"
    },
    "finalized_for_signing_by": {
      "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
      "user_type": "person",
      "name": "John Doe",
      "email": "string",
      "state": "active",
      "role": "admin"
    },
    "device_signing_request": {
      "created_by": {
        "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
        "user_type": "person",
        "name": "John Doe",
        "email": "string",
        "state": "active",
        "role": "admin"
      },
      "signers": [
        {
          "user": {
            "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
            "user_type": "person",
            "name": "John Doe",
            "email": "string",
            "state": "active",
            "role": "admin"
          },
          "modified_at": "2019-08-24T14:15:22Z",
          "has_signed": true
        }
      ]
    },
    "approval_request": {
      "state": "created",
      "required_groups": 0,
      "approval_groups": [
        {
          "quorum_size": 0,
          "approvers": [
            {
              "user": {},
              "modified_at": "2019-08-24T14:15:22Z",
              "decision": "string",
              "state": "pending"
            }
          ]
        }
      ],
      "error_message": "string"
    },
    "aml_policy_match": {
      "is_default": true,
      "rule_id": "728c1541-d6d1-4290-9a53-cdf01dd32d60",
      "rule_name": "string",
      "action_type": "allow"
    },
    "policy_match": {
      "is_default": true,
      "rule_id": "728c1541-d6d1-4290-9a53-cdf01dd32d60",
      "rule_name": "string",
      "action_type": "allow"
    },
    "signer_type": "initiator",
    "risks": [],
    "error_pushing_to_blockchain_message": "string",
    "original_error_pushing_to_blockchain_message": "string",
    "vault": {
      "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
      "vault_group_id": "948d8050-0dde-409f-985b-6d7b133fc9e8",
      "vault_group_ids": [
        "497f6eca-6276-4993-bfeb-53cbbbba6f08"
      ],
      "name": "string",
      "address": "string",
      "state": "active",
      "type": "aptos",
      "logo_url": "http://example.com",
      "end_user": {
        "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
        "user_type": "end_user",
        "external_id": "user|1234",
        "state": "active"
      },
      "is_external_signer": false
    },
    "idempotence_id": "20a3c79f-f547-44b3-bdfc-d8aea82ad496",
    "has_current_user_vault_permissions": true,
    "batch_data": {
      "batch_id": "4da22c97-b7d5-4e31-8c3a-03870ebc7b20",
      "index_in_batch": 0,
      "batch_size": 0,
      "matched_policies": [
        {
          "is_default": true,
          "rule_id": "728c1541-d6d1-4290-9a53-cdf01dd32d60",
          "rule_name": "string",
          "action_type": "allow"
        }
      ]
    },
    "push_mode": "auto",
    "last_pushed_at": "2019-08-24T14:15:22Z",
    "sign_mode": "auto",
    "fee_paid_by": {
      "type": "vault",
      "vault": {
        "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
        "vault_group_id": "948d8050-0dde-409f-985b-6d7b133fc9e8",
        "vault_group_ids": [
          "497f6eca-6276-4993-bfeb-53cbbbba6f08"
        ],
        "name": "string",
        "address": "string",
        "state": "active",
        "type": "aptos",
        "logo_url": "http://example.com",
        "end_user": {
          "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
          "user_type": "end_user",
          "external_id": "user|1234",
          "state": "active"
        },
        "is_external_signer": false
      }
    },
    "attested_payload_for_signing": "string",
    "tx_policy_explanation_id": "1a8ad71c-266a-4642-bb49-fea1ea66fcc2"
  },
  "signatures": [
    {
      "data": "SGVsbG8=",
      "signed_by": {
        "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
        "user_type": "person",
        "name": "John Doe",
        "email": "string",
        "state": "active",
        "role": "admin"
      }
    }
  ],
  "note": "string",
  "spam_state": "unset",
  "direction": "outgoing",
  "signed_externally": false,
  "interacted_vaults": [
    {
      "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
      "vault_group_id": "948d8050-0dde-409f-985b-6d7b133fc9e8",
      "vault_group_ids": [
        "497f6eca-6276-4993-bfeb-53cbbbba6f08"
      ],
      "name": "string",
      "address": "string",
      "state": "active",
      "type": "aptos",
      "logo_url": "http://example.com",
      "end_user": {
        "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
        "user_type": "end_user",
        "external_id": "user|1234",
        "state": "active"
      },
      "is_external_signer": false
    }
  ],
  "related_transactions": [
    {
      "type": "swap_fulfilled_by",
      "hash": "string",
      "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
      "chain": {
        "chain_type": "aptos",
        "unique_id": "aptos_mainnet",
        "name": "string",
        "native_currency_symbol": "ETH",
        "native_currency_name": "Ether",
        "blockchain_explorer": {
          "transaction_url": "https://etherscan.io/tx/",
          "address_url": "https://etherscan.io/address/",
          "root_url": "https://etherscan.io/",
          "transaction_format_url": "https://etherscan.io/tx/%s",
          "address_format_url": "https://etherscan.io/address/%s",
          "asset_format_url": "https://etherscan.io/address/%s"
        },
        "logo_url": "http://example.com",
        "is_testnet": true,
        "is_enabled": true
      },
      "explorer_url": "http://example.com"
    }
  ],
  "organization_id": "7c60d51f-b44e-4682-87d6-449835ea4de6",
  "state": "waiting_for_approval",
  "state_changes": [
    {
      "changed_at": "2019-08-24T14:15:22Z",
      "reason": "failed_to_verify_signature",
      "previous_state": "waiting_for_approval",
      "new_state": "waiting_for_approval"
    }
  ],
  "type": "aptos_message",
  "aptos_message_type": "personal_message_type",
  "raw_original_message_to_sign": "SGVsbG8=",
  "string_original_message_to_sign": "string",
  "raw_full_message_to_sign": "SGVsbG8=",
  "string_full_message_to_sign": "string",
  "chain": {
    "chain_type": "aptos",
    "unique_id": "aptos_mainnet",
    "name": "string",
    "native_currency_symbol": "ETH",
    "native_currency_name": "Ether",
    "blockchain_explorer": {
      "transaction_url": "https://etherscan.io/tx/",
      "address_url": "https://etherscan.io/address/",
      "root_url": "https://etherscan.io/",
      "transaction_format_url": "https://etherscan.io/tx/%s",
      "address_format_url": "https://etherscan.io/address/%s",
      "asset_format_url": "https://etherscan.io/address/%s"
    },
    "logo_url": "http://example.com",
    "is_testnet": true,
    "is_enabled": true
  },
  "sender": {
    "vault": {
      "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
      "vault_group_id": "948d8050-0dde-409f-985b-6d7b133fc9e8",
      "vault_group_ids": [
        "497f6eca-6276-4993-bfeb-53cbbbba6f08"
      ],
      "name": "string",
      "address": "string",
      "state": "active",
      "type": "aptos",
      "logo_url": "http://example.com",
      "end_user": {
        "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
        "user_type": "end_user",
        "external_id": "user|1234",
        "state": "active"
      },
      "is_external_signer": false
    },
    "explorer_url": "http://example.com",
    "contact": {
      "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
      "name": "string",
      "address_ref": {
        "chain_type": "aptos",
        "address": "0x3300c18e7b931bdfc73dccf3e2d043ad1c9d120c777fff5aeeb9956224e5247a",
        "chains": [
          {
            "chain_type": "aptos",
            "unique_id": "aptos_mainnet"
          }
        ]
      }
    },
    "type": "aptos",
    "address": "0x3300c18e7b931bdfc73dccf3e2d043ad1c9d120c777fff5aeeb9956224e5247a"
  }
}

has_risks := {
  "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
  "created_at": "2019-08-24T14:15:22Z",
  "modified_at": "2019-08-24T14:15:22Z",
  "managed_transaction_data": {
    "created_by": {
      "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
      "user_type": "person",
      "name": "John Doe",
      "email": "string",
      "state": "active",
      "role": "admin"
    },
    "aborted_by": {
      "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
      "user_type": "person",
      "name": "John Doe",
      "email": "string",
      "state": "active",
      "role": "admin"
    },
    "finalized_for_signing_by": {
      "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
      "user_type": "person",
      "name": "John Doe",
      "email": "string",
      "state": "active",
      "role": "admin"
    },
    "device_signing_request": {
      "created_by": {
        "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
        "user_type": "person",
        "name": "John Doe",
        "email": "string",
        "state": "active",
        "role": "admin"
      },
      "signers": [
        {
          "user": {
            "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
            "user_type": "person",
            "name": "John Doe",
            "email": "string",
            "state": "active",
            "role": "admin"
          },
          "modified_at": "2019-08-24T14:15:22Z",
          "has_signed": true
        }
      ]
    },
    "approval_request": {
      "state": "created",
      "required_groups": 0,
      "approval_groups": [
        {
          "quorum_size": 0,
          "approvers": [
            {
              "user": {},
              "modified_at": "2019-08-24T14:15:22Z",
              "decision": "string",
              "state": "pending"
            }
          ]
        }
      ],
      "error_message": "string"
    },
    "aml_policy_match": {
      "is_default": true,
      "rule_id": "728c1541-d6d1-4290-9a53-cdf01dd32d60",
      "rule_name": "string",
      "action_type": "allow"
    },
    "policy_match": {
      "is_default": true,
      "rule_id": "728c1541-d6d1-4290-9a53-cdf01dd32d60",
      "rule_name": "string",
      "action_type": "allow"
    },
    "signer_type": "initiator",
    "risks": [
      {
        "type": "transfer_to_erc20_contract",
        "severity": "low",
        "title": "string",
        "description": "string"
      }
    ],
    "error_pushing_to_blockchain_message": "string",
    "original_error_pushing_to_blockchain_message": "string",
    "vault": {
      "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
      "vault_group_id": "948d8050-0dde-409f-985b-6d7b133fc9e8",
      "vault_group_ids": [
        "497f6eca-6276-4993-bfeb-53cbbbba6f08"
      ],
      "name": "string",
      "address": "string",
      "state": "active",
      "type": "aptos",
      "logo_url": "http://example.com",
      "end_user": {
        "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
        "user_type": "end_user",
        "external_id": "user|1234",
        "state": "active"
      },
      "is_external_signer": false
    },
    "idempotence_id": "20a3c79f-f547-44b3-bdfc-d8aea82ad496",
    "has_current_user_vault_permissions": true,
    "batch_data": {
      "batch_id": "4da22c97-b7d5-4e31-8c3a-03870ebc7b20",
      "index_in_batch": 0,
      "batch_size": 0,
      "matched_policies": [
        {
          "is_default": true,
          "rule_id": "728c1541-d6d1-4290-9a53-cdf01dd32d60",
          "rule_name": "string",
          "action_type": "allow"
        }
      ]
    },
    "push_mode": "auto",
    "last_pushed_at": "2019-08-24T14:15:22Z",
    "sign_mode": "auto",
    "fee_paid_by": {
      "type": "vault",
      "vault": {
        "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
        "vault_group_id": "948d8050-0dde-409f-985b-6d7b133fc9e8",
        "vault_group_ids": [
          "497f6eca-6276-4993-bfeb-53cbbbba6f08"
        ],
        "name": "string",
        "address": "string",
        "state": "active",
        "type": "aptos",
        "logo_url": "http://example.com",
        "end_user": {
          "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
          "user_type": "end_user",
          "external_id": "user|1234",
          "state": "active"
        },
        "is_external_signer": false
      }
    },
    "attested_payload_for_signing": "string",
    "tx_policy_explanation_id": "1a8ad71c-266a-4642-bb49-fea1ea66fcc2"
  },
  "signatures": [
    {
      "data": "SGVsbG8=",
      "signed_by": {
        "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
        "user_type": "person",
        "name": "John Doe",
        "email": "string",
        "state": "active",
        "role": "admin"
      }
    },
    {
      "data": "SGVsbG8=",
      "signed_by": {
        "id": "597f6eca-6276-4993-bfeb-53cbbbba6f08",
        "user_type": "person",
        "name": "Jane Doe",
        "email": "string",
        "state": "active",
        "role": "admin"
      }
    },
    {
      "data": "SGVsbG8=",
      "signed_by": {
        "id": "697f6eca-6276-4993-bfeb-53cbbbba6f08",
        "user_type": "person",
        "name": "Jimmy Doe",
        "email": "string",
        "state": "active",
        "role": "admin"
      }
    }
  ],
  "note": "string",
  "spam_state": "unset",
  "direction": "outgoing",
  "signed_externally": false,
  "interacted_vaults": [
    {
      "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
      "vault_group_id": "948d8050-0dde-409f-985b-6d7b133fc9e8",
      "vault_group_ids": [
        "497f6eca-6276-4993-bfeb-53cbbbba6f08"
      ],
      "name": "string",
      "address": "string",
      "state": "active",
      "type": "aptos",
      "logo_url": "http://example.com",
      "end_user": {
        "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
        "user_type": "end_user",
        "external_id": "user|1234",
        "state": "active"
      },
      "is_external_signer": false
    }
  ],
  "related_transactions": [
    {
      "type": "swap_fulfilled_by",
      "hash": "string",
      "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
      "chain": {
        "chain_type": "aptos",
        "unique_id": "aptos_mainnet",
        "name": "string",
        "native_currency_symbol": "ETH",
        "native_currency_name": "Ether",
        "blockchain_explorer": {
          "transaction_url": "https://etherscan.io/tx/",
          "address_url": "https://etherscan.io/address/",
          "root_url": "https://etherscan.io/",
          "transaction_format_url": "https://etherscan.io/tx/%s",
          "address_format_url": "https://etherscan.io/address/%s",
          "asset_format_url": "https://etherscan.io/address/%s"
        },
        "logo_url": "http://example.com",
        "is_testnet": true,
        "is_enabled": true
      },
      "explorer_url": "http://example.com"
    }
  ],
  "organization_id": "7c60d51f-b44e-4682-87d6-449835ea4de6",
  "state": "waiting_for_approval",
  "state_changes": [
    {
      "changed_at": "2019-08-24T14:15:22Z",
      "reason": "failed_to_verify_signature",
      "previous_state": "waiting_for_approval",
      "new_state": "waiting_for_approval"
    }
  ],
  "type": "aptos_message",
  "aptos_message_type": "personal_message_type",
  "raw_original_message_to_sign": "SGVsbG8=",
  "string_original_message_to_sign": "string",
  "raw_full_message_to_sign": "SGVsbG8=",
  "string_full_message_to_sign": "string",
  "chain": {
    "chain_type": "aptos",
    "unique_id": "aptos_mainnet",
    "name": "string",
    "native_currency_symbol": "ETH",
    "native_currency_name": "Ether",
    "blockchain_explorer": {
      "transaction_url": "https://etherscan.io/tx/",
      "address_url": "https://etherscan.io/address/",
      "root_url": "https://etherscan.io/",
      "transaction_format_url": "https://etherscan.io/tx/%s",
      "address_format_url": "https://etherscan.io/address/%s",
      "asset_format_url": "https://etherscan.io/address/%s"
    },
    "logo_url": "http://example.com",
    "is_testnet": true,
    "is_enabled": true
  },
  "sender": {
    "vault": {
      "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
      "vault_group_id": "948d8050-0dde-409f-985b-6d7b133fc9e8",
      "vault_group_ids": [
        "497f6eca-6276-4993-bfeb-53cbbbba6f08"
      ],
      "name": "string",
      "address": "string",
      "state": "active",
      "type": "aptos",
      "logo_url": "http://example.com",
      "end_user": {
        "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
        "user_type": "end_user",
        "external_id": "user|1234",
        "state": "active"
      },
      "is_external_signer": false
    },
    "explorer_url": "http://example.com",
    "contact": {
      "id": "497f6eca-6276-4993-bfeb-53cbbbba6f08",
      "name": "string",
      "address_ref": {
        "chain_type": "aptos",
        "address": "0x3300c18e7b931bdfc73dccf3e2d043ad1c9d120c777fff5aeeb9956224e5247a",
        "chains": [
          {
            "chain_type": "aptos",
            "unique_id": "aptos_mainnet"
          }
        ]
      }
    },
    "type": "aptos",
    "address": "0x3300c18e7b931bdfc73dccf3e2d043ad1c9d120c777fff5aeeb9956224e5247a"
  }
}

wrap(inner) := {"fordefi": inner}

test_allow_when_all_clean if {
    d := wrap(passing_tx)
    fordefi_transaction_safety.allow with data.params as default_params with data.wasm as d
    count(fordefi_transaction_safety.deny) == 0 with data.params as default_params with data.wasm as d
}

test_fail_when_below_threshold if {
    d := wrap(insufficient_signatures)
    not fordefi_transaction_safety.allow with data.params as default_params with data.wasm as d
    count(fordefi_transaction_safety.deny) == 1 with data.params as default_params with data.wasm as d
}

test_fail_when_has_risks if {
    d := wrap(has_risks)
    not fordefi_transaction_safety.allow with data.params as default_params with data.wasm as d
    count(fordefi_transaction_safety.deny) == 1 with data.params as default_params with data.wasm as d
}

test_fail_when_aml_failed if {
    d := wrap(aml_failed)
    not fordefi_transaction_safety.allow with data.params as default_params with data.wasm as d
    count(fordefi_transaction_safety.deny) == 1 with data.params as default_params with data.wasm as d
}

test_fail_when_externally_signed if {
    d := wrap(externally_signed)
    not fordefi_transaction_safety.allow with data.params as default_params with data.wasm as d
    count(fordefi_transaction_safety.deny) == 1 with data.params as default_params with data.wasm as d
}
