/**
 * Network configuration for 0xio SDK
 */

import { NetworkInfo, ErrorCode, ZeroXIOWalletError } from '../types';

const _NETWORKS: Record<string, NetworkInfo> = {
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

/**
 * Immutable public copy of the built-in network table.
 * Modifications to returned objects do not affect SDK-internal state.
 */
export const NETWORKS: Readonly<Record<string, Readonly<NetworkInfo>>> = Object.freeze(
  Object.fromEntries(Object.entries(_NETWORKS).map(([k, v]) => [k, Object.freeze({ ...v })]))
);

export const DEFAULT_NETWORK_ID = 'mainnet';

/**
 * Get network configuration by ID.
 * Returns a frozen copy — callers cannot mutate SDK-internal state.
 */
export function getNetworkConfig(networkId: string = DEFAULT_NETWORK_ID): NetworkInfo {
  if (!Object.prototype.hasOwnProperty.call(_NETWORKS, networkId)) {
    throw new ZeroXIOWalletError(ErrorCode.NETWORK_ERROR, `Unknown network ID: ${networkId}`);
  }
  return Object.freeze({ ..._NETWORKS[networkId] });
}

/**
 * Get all available networks.
 * Returns frozen copies — callers cannot mutate SDK-internal state.
 */
export function getAllNetworks(): NetworkInfo[] {
  return Object.values(_NETWORKS).map(n => Object.freeze({ ...n }));
}

/**
 * Check if network ID is valid (own property check, prevents prototype pollution).
 */
export function isValidNetworkId(networkId: string): boolean {
  return typeof networkId === 'string' && Object.prototype.hasOwnProperty.call(_NETWORKS, networkId);
}

/**
 * Validate a NetworkInfo shape from an untrusted source (bridge response).
 * Returns a frozen copy if valid, null otherwise.
 */
export function validateNetworkInfo(raw: any): NetworkInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.id !== 'string' || !raw.id) return null;
  if (typeof raw.name !== 'string') return null;
  if (typeof raw.rpcUrl !== 'string' || (!raw.rpcUrl && raw.id !== 'custom')) return null;
  if (typeof raw.supportsPrivacy !== 'boolean') return null;
  return Object.freeze({
    id: raw.id,
    name: raw.name,
    rpcUrl: raw.rpcUrl,
    explorerUrl: typeof raw.explorerUrl === 'string' ? raw.explorerUrl : undefined,
    explorerAddressUrl: typeof raw.explorerAddressUrl === 'string' ? raw.explorerAddressUrl : undefined,
    indexerUrl: typeof raw.indexerUrl === 'string' ? raw.indexerUrl : undefined,
    supportsPrivacy: raw.supportsPrivacy,
    color: typeof raw.color === 'string' ? raw.color : '#64748b',
    isTestnet: typeof raw.isTestnet === 'boolean' ? raw.isTestnet : false,
  } as NetworkInfo);
}
