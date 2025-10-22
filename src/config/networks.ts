/**
 * Network configuration for 0xio SDK
 */

import { NetworkInfo } from '../types';

export const NETWORKS: Record<string, NetworkInfo> = {
  'octra-testnet': {
    id: 'octra-testnet',
    name: 'Octra Testnet',
    rpcUrl: 'https://octra.network',
    explorerUrl: 'https://octrascan.io/',
    color: '#6366f1',
    isTestnet: true
  },
  'custom': {
    id: 'custom',
    name: 'Custom Network',
    rpcUrl: '',
    explorerUrl: '',
    color: '#64748b',
    isTestnet: false // User configurable - can be mainnet or testnet
  }
};

export const DEFAULT_NETWORK_ID = 'octra-testnet';

/**
 * Get network configuration by ID
 */
export function getNetworkConfig(networkId: string = DEFAULT_NETWORK_ID): NetworkInfo {
  const network = NETWORKS[networkId];
  if (!network) {
    throw new Error(`Unknown network ID: ${networkId}`);
  }
  return network;
}

/**
 * Get all available networks
 */
export function getAllNetworks(): NetworkInfo[] {
  return Object.values(NETWORKS);
}

/**
 * Check if network ID is valid
 */
export function isValidNetworkId(networkId: string): boolean {
  return networkId in NETWORKS;
}