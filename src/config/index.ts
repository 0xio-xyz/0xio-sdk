import { getNetworkConfig, DEFAULT_NETWORK_ID } from './networks';
import { Balance } from '../types';

export * from './networks';

/** Takes a numeric total, never a Balance. */
export function createDefaultBalance(total: number = 0): Balance {
  const safeTotal = typeof total === 'number' && Number.isFinite(total) && total >= 0 ? total : 0;
  return {
    total: safeTotal,
    public: safeTotal,
    private: 0,
    currency: 'OCT'
  };
}

/** Null when untrusted bridge data is not a valid Balance. */
export function validateBalance(raw: any): Balance | null {
  if (raw === null || raw === undefined) return null;
  // Number(), not parseFloat(): parseFloat('10abc') is 10
  const pub = typeof raw === 'object' ? Number(raw.public ?? raw.total ?? 0) : Number(raw);
  const priv = typeof raw === 'object' ? Number(raw.private ?? 0) : 0;
  if (!Number.isFinite(pub) || pub < 0) return null;
  if (!Number.isFinite(priv) || priv < 0) return null;
  return {
    public: pub,
    private: priv,
    total: pub + priv,
    currency: 'OCT'
  };
}

export const SDK_CONFIG = {
  version: '2.8.0',
  defaultNetworkId: DEFAULT_NETWORK_ID,
  communicationTimeout: 30000,
  retryAttempts: 3,
  retryDelay: 1000,
} as const;

export function getDefaultNetwork() {
  return getNetworkConfig(SDK_CONFIG.defaultNetworkId);
}