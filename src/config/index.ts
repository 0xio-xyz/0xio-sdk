/**
 * SDK Configuration
 */

import { getNetworkConfig, DEFAULT_NETWORK_ID } from './networks';
import { Balance } from '../types';

export * from './networks';

/**
 * Default balance structure
 */
export function createDefaultBalance(total: number = 0): Balance {
  return {
    total,
    public: total,
    private: 0,
    currency: 'OCT'
  };
}

/**
 * SDK Configuration constants
 */
export const SDK_CONFIG = {
  version: '2.1.8',
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