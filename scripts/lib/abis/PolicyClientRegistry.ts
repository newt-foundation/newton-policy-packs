import { parseAbi } from 'viem';

export const POLICY_CLIENT_REGISTRY_ABI = parseAbi([
  'function registerClient(address client) external',
  'function deactivateClient(address client) external',
  'function activateClient(address client) external',
  'function setClientOwner(address client, address newOwner) external',
  'function getClientRecord(address client) external view returns ((address owner, bool active, uint64 registeredAt))',
  'function getClientsByOwner(address owner) external view returns (address[])',
  'function isRegisteredClient(address client) external view returns (bool)',
  'function getClientCount(address owner) external view returns (uint256)',
  'event ClientRegistered(address indexed client, address indexed owner)',
  'event ClientDeactivated(address indexed client, address indexed owner)',
  'event ClientActivated(address indexed client, address indexed owner)',
  'event ClientOwnerChanged(address indexed client, address indexed oldOwner, address indexed newOwner)',
  'error NotPolicyClient(address client)',
  'error ClientAlreadyRegistered(address client)',
  'error ClientNotRegistered(address client)',
  'error NotClientOwner(address client, address caller)',
  'error InvalidOwnerAddress()',
]);
