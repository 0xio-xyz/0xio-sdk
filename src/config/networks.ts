/**
 * Network configuration for 0xio SDK
 */

import { NetworkInfo, ErrorCode, ZeroXIOWalletError } from '../types';

export const NETWORKS: Record<string, NetworkInfo> = {
  'mainnet': {
    id: 'mainnet',
    name: 'Octra Mainnet',
    rpcUrl: 'http://46.101.86.250:8080',
    explorerUrl: 'https://lite.octrascan.io/tx.html?hash=',
    explorerAddressUrl: 'https://lite.octrascan.io/address.html?addr=',
    indexerUrl: 'https://lite.octrascan.io',
    supportsPrivacy: true,
    color: '#f59e0b',
    isTestnet: false
  },
  'devnet': {
    id: 'devnet',
    name: 'Octra Devnet',
    rpcUrl: 'http://165.227.225.79:8080',
    explorerUrl: 'https://devnet.octrascan.io/tx.html?hash=',
    explorerAddressUrl: 'https://devnet.octrascan.io/address.html?addr=',
    indexerUrl: 'https://devnet.octrascan.io',
    supportsPrivacy: true,
    color: '#8b5cf6',
    isTestnet: true
  },
  'custom': {
    id: 'custom',
    name: 'Custom Network',
    rpcUrl: '',
    explorerUrl: '',
    explorerAddressUrl: '',
    indexerUrl: '',
    supportsPrivacy: false,
    color: '#64748b',
    isTestnet: false
  }
};

export const DEFAULT_NETWORK_ID = 'mainnet';

/**
 * Get network configuration by ID
 */
export function getNetworkConfig(networkId: string = DEFAULT_NETWORK_ID): NetworkInfo {
  const network = NETWORKS[networkId];
  if (!network) {
    throw new ZeroXIOWalletError(ErrorCode.NETWORK_ERROR, `Unknown network ID: ${networkId}`);
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