export const NEWTON_POLICY_FACTORY_ABI = [
  {
    inputs: [
      { name: '_entrypoint', type: 'string' },
      { name: '_policyCid', type: 'string' },
      { name: '_schemaCid', type: 'string' },
      { name: '_policyData', type: 'address[]' },
      { name: '_metadataCid', type: 'string' },
      { name: '_owner', type: 'address' },
      { name: '_policyCodeHash', type: 'bytes32' },
    ],
    name: 'deployPolicy',
    outputs: [{ name: 'policyAddr', type: 'address' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: false, name: 'policy', type: 'address' },
      {
        components: [
          { name: 'policyAddress', type: 'address' },
          { name: 'owner', type: 'address' },
          { name: 'metadataCid', type: 'string' },
          { name: 'policyCid', type: 'string' },
          { name: 'schemaCid', type: 'string' },
          { name: 'entrypoint', type: 'string' },
          { name: 'policyData', type: 'address[]' },
          { name: 'policyCodeHash', type: 'bytes32' },
        ],
        indexed: false,
        name: 'policyInfo',
        type: 'tuple',
      },
      { indexed: false, name: 'implementationVersion', type: 'string' },
    ],
    name: 'PolicyDeployed',
    type: 'event',
  },
] as const;
