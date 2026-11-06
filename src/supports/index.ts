
export { ZeroXIOAdapter, createZeroXIOAdapter } from './0xio';
export { OctraProviderAdapter, createOctraProviderAdapter } from './octra-provider';

import type { WalletTransportAdapter } from '../adapter';
import { ZeroXIOAdapter } from './0xio';
import { OctraProviderAdapter } from './octra-provider';

const REGISTERED_ADAPTERS: WalletTransportAdapter[] = [
  ZeroXIOAdapter,
  OctraProviderAdapter,
  // detection runs in this order, first match wins
];

/**
 * The first registered wallet present in the page, or null.
 *
 * @example
 * const adapter = detectWalletAdapter();
 * if (!adapter) throw new Error('No supported wallet found');
 * const wallet = new ZeroXIOWallet({ appName: 'My DApp', adapter });
 */
export function detectWalletAdapter(): WalletTransportAdapter | null {
  if (typeof window === 'undefined') return null;
  return REGISTERED_ADAPTERS.find((a) => a.detect()) ?? null;
}

export function getAllAdapters(): WalletTransportAdapter[] {
  return [...REGISTERED_ADAPTERS];
}
