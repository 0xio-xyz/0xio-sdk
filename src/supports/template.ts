/**
 * Copy this file to add a wallet: fill in the constants and the message mapping, register the
 * adapter in `supports/index.ts`, and export it from `src/index.ts` for the public API.
 *
 * @example
 * import { ZeroXIOWallet } from '@0xio/sdk';
 * import { MyWalletAdapter } from '@0xio/sdk/supports/my-wallet';
 *
 * const wallet = new ZeroXIOWallet({ appName: 'My DApp', adapter: MyWalletAdapter });
 */

import type { WalletTransportAdapter, AdapterRequest, AdapterIncomingMessage } from '../adapter';

const REQUEST_SOURCE = 'wallet-sdk-request';
const RESPONSE_SOURCE = 'wallet-sdk-bridge';
const WINDOW_KEY = 'myWallet';
const READY_EVENT = 'myWalletReady';

export const MyWalletAdapter: WalletTransportAdapter = {
  name: 'mywallet',
  displayName: 'My Wallet',

  detect(): boolean {
    if (typeof window === 'undefined') return false;
    return !!(window as any)[WINDOW_KEY];
  },

  postRequest(request: AdapterRequest): void {
    window.postMessage({ source: REQUEST_SOURCE, request }, window.location.origin);
  },

  listen(handler: (msg: AdapterIncomingMessage) => void): () => void {
    const allowedOrigin = window.location.origin;
    const fn = (e: MessageEvent) => {
      if (e.origin !== allowedOrigin) return;
      if (e.source !== window && e.source !== window.parent) return;
      if (!e.data || e.data.source !== RESPONSE_SOURCE) return;
      if (e.data.response) {
        const r = e.data.response;
        handler({ requestId: r.id, success: r.success, data: r.data, error: r.error });
      } else if (e.data.event) {
        handler({ eventType: e.data.event.type, eventData: e.data.event.data });
      }
    };
    window.addEventListener('message', fn);
    return () => window.removeEventListener('message', fn);
  },

  listenForReady(onReady: () => void): () => void {
    const fn = () => onReady();
    window.addEventListener(READY_EVENT, fn);
    return () => window.removeEventListener(READY_EVENT, fn);
  },
};
