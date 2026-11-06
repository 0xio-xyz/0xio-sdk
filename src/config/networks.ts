
import { NetworkInfo, ErrorCode, ZeroXIOWalletError } from '../types';

const _NETWORKS: Record<string, NetworkInfo> = {
  'mainnet': {
    id: 'mainnet',
    name: 'Octra Mainnet',
    rpcUrl: 'https://octra.network',
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
    rpcUrl: 'https://devnet.octrascan.io',
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

export const NETWORKS: Readonly<Record<string, Readonly<NetworkInfo>>> = Object.freeze(
  Object.fromEntries(Object.entries(_NETWORKS).map(([k, v]) => [k, Object.freeze({ ...v })]))
);

export const DEFAULT_NETWORK_ID = 'mainnet';

/** A frozen copy; callers cannot change the SDK's table. */
export function getNetworkConfig(networkId: string = DEFAULT_NETWORK_ID): NetworkInfo {
  if (!Object.prototype.hasOwnProperty.call(_NETWORKS, networkId)) {
    throw new ZeroXIOWalletError(ErrorCode.NETWORK_ERROR, `Unknown network ID: ${networkId}`);
  }
  return Object.freeze({ ..._NETWORKS[networkId] });
}

/** Frozen copies; callers cannot change the SDK's table. */
export function getAllNetworks(): NetworkInfo[] {
  return Object.values(_NETWORKS).map(n => Object.freeze({ ...n }));
}

/** Own property check, so `__proto__` and friends are not network ids. */
export function isValidNetworkId(networkId: string): boolean {
  return typeof networkId === 'string' && Object.prototype.hasOwnProperty.call(_NETWORKS, networkId);
}

/** A frozen copy of untrusted bridge data, or null when it is not a NetworkInfo. */
export function validateNetworkInfo(raw: any): NetworkInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.id !== 'string' || !raw.id) return null;
  if (typeof raw.name !== 'string') return null;
  if (typeof raw.rpcUrl !== 'string' || (!raw.rpcUrl && raw.id !== 'custom')) return null;
  if (raw.rpcUrl) {
    const isHttps = raw.rpcUrl.startsWith('https://');
    const isLocal = raw.rpcUrl.startsWith('http://localhost') || raw.rpcUrl.startsWith('http://127.0.0.1');
    const isTestnet = raw.isTestnet === true;
    // Plain http only for a testnet or a local node
    if (!isHttps && !isLocal && !isTestnet) return null;
  }
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
