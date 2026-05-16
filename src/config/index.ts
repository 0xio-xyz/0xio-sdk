/**
 * SDK Configuration
 */

import { getNetworkConfig, DEFAULT_NETWORK_ID } from './networks';
import { Balance } from '../types';

export * from './networks';

/**
 * Default balance structure.
 * Accepts a numeric total or undefined — never pass a Balance object here.
 */
export function createDefaultBalance(total: number = 0): Balance {
  const safeTotal = typeof total === 'number' && Number.isFinite(total) && total >= 0 ? total : 0;
  return {
    total: safeTotal,
    public: safeTotal,
    private: 0,
    currency: 'OCT'
  };
}

/**
 * Validate and normalise a Balance from an untrusted source (bridge response).
 * Returns null if the payload cannot be coerced into a valid Balance.
 */
export function validateBalance(raw: any): Balance | null {
  if (raw === null || raw === undefined) return null;
  // If it's already a Balance-shaped object, extract numeric fields
  // Use Number() not parseFloat() — parseFloat('10abc') silently returns 10
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

/**
 * SDK Configuration constants
 */
export const SDK_CONFIG = {
  version: '2.7.0',
  defaultNetworkId: DEFAULT_NETWORK_ID,
  communicationTimeout: 30000, // 30 seconds
  retryAttempts: 3,
  retryDelay: 1000, // 1 second
} as const;

/**
 * Get default network configuration
 */
export function getDefaultNetwork() {
  return getNetworkConfig(SDK_CONFIG.defaultNetworkId);
}