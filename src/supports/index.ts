/**
 * 0xio SDK — Wallet Adapter Registry
 *
 * Add new wallet adapters here. Detection order determines which wallet takes
 * priority when multiple wallets are installed at the same time.
 */

export { ZeroXIOAdapter, createZeroXIOAdapter } from './0xio';
export { OctraProviderAdapter, createOctraProviderAdapter } from './octra-provider';

import type { WalletTransportAdapter } from '../adapter';
import { ZeroXIOAdapter } from './0xio';
import { OctraProviderAdapter } from './octra-provider';

const REGISTERED_ADAPTERS: WalletTransportAdapter[] = [
  ZeroXIOAdapter,       // 0xio extension (postMessage protocol) — highest priority
  OctraProviderAdapter, // any RFC-O-1 compliant wallet (window.octra)
  // Add new wallet adapters here — detection runs in order, first match wins
];

/**
 * Auto-detects the first available wallet in the current page.
 * Returns null if no supported wallet is found.
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

/** Returns all registered adapter instances. */
export function getAllAdapters(): WalletTransportAdapter[] {
  return [...REGISTERED_ADAPTERS];
}
