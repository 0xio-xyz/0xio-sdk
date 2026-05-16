/**
 * Template: External wallet transport adapter.
 *
 * Copy this file and fill in the three constants + message shape mapping
 * to add support for another wallet.
 *
 * Once done:
 *   1. Export your adapter from this file
 *   2. Import and register it in supports/index.ts REGISTERED_ADAPTERS
 *   3. Export it from src/index.ts if you want it in the public API
 *
 * @example
 * import { ZeroXIOWallet } from '@0xio/sdk';
 * import { MyWalletAdapter } from '@0xio/sdk/supports/my-wallet';
 *
 * const wallet = new ZeroXIOWallet({ appName: 'My DApp', adapter: MyWalletAdapter });
 */

// import type { WalletTransportAdapter, AdapterRequest, AdapterIncomingMessage } from '../adapter';
//
// const REQUEST_SOURCE  = 'wallet-sdk-request';   // outbound message source string
// const RESPONSE_SOURCE = 'wallet-sdk-bridge';    // inbound message source string
// const WINDOW_KEY      = 'myWallet';             // window property the wallet injects
// const READY_EVENT     = 'myWalletReady';        // CustomEvent fired when wallet is ready
//
// export const MyWalletAdapter: WalletTransportAdapter = {
//   name: 'mywallet',
//   displayName: 'My Wallet',
//
//   detect(): boolean {
//     if (typeof window === 'undefined') return false;
//     return !!(window as any)[WINDOW_KEY];
//   },
//
//   postRequest(request: AdapterRequest): void {
//     window.postMessage({ source: REQUEST_SOURCE, request }, window.location.origin);
//   },
//
//   listen(handler: (msg: AdapterIncomingMessage) => void): () => void {
//     const allowedOrigin = window.location.origin;
//     const fn = (e: MessageEvent) => {
//       if (e.origin !== allowedOrigin) return;
//       // Reject messages from any window other than this page or its parent
//       if (e.source !== window && e.source !== window.parent) return;
//       if (!e.data || e.data.source !== RESPONSE_SOURCE) return;
//       if (e.data.response) {
//         const r = e.data.response;
//         handler({ requestId: r.id, success: r.success, data: r.data, error: r.error });
//       } else if (e.data.event) {
//         handler({ eventType: e.data.event.type, eventData: e.data.event.data });
//       }
//     };
//     window.addEventListener('message', fn);
//     return () => window.removeEventListener('message', fn);
//   },
//
//   listenForReady(onReady: () => void): () => void {
//     const fn = () => onReady();
//     window.addEventListener(READY_EVENT, fn);
//     return () => window.removeEventListener(READY_EVENT, fn);
//   },
// };
