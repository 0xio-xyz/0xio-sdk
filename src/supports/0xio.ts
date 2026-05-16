/**
 * 0xio Wallet transport adapter.
 *
 * Implements the postMessage protocol used by the 0xio browser extension (>= v2.4.0).
 *
 * Outbound wire format:
 *   window.postMessage({ source: '0xio-sdk-request', request: { id, method, params, timestamp } }, origin)
 *
 * Inbound wire format:
 *   window.postMessage({ source: '0xio-sdk-bridge', response: { id, success, data, error }, sessionNonce })
 *   window.postMessage({ source: '0xio-sdk-bridge', event: { type, data } })
 *
 * H-2: Session nonce validation — injected.ts broadcasts the nonce received from the
 * isolated content script. Once set, any '0xio-sdk-bridge' response with a missing or
 * mismatched nonce is rejected, preventing response injection by malicious page scripts.
 */

import type { WalletTransportAdapter, AdapterRequest, AdapterIncomingMessage } from '../adapter';

/**
 * Creates a 0xio adapter. The factory accepts optional extra trusted parent origins
 * so the communicator can forward its own trustedOrigins setting to origin validation.
 */
export function createZeroXIOAdapter(extraTrustedOrigins: string[] = []): WalletTransportAdapter {
  return {
    name: '0xio',
    displayName: '0xio Wallet',

    detect(): boolean {
      if (typeof window === 'undefined') return false;
      const win = window as any;
      return !!(
        win.wallet0xio ||
        win.ZeroXIOWallet ||
        win.chrome?.runtime?.id ||
        document.querySelector('meta[name="0xio-dapp"]') ||
        document.querySelector('[data-0xio-sdk-bridge]')
      );
    },

    postRequest(request: AdapterRequest): void {
      window.postMessage(
        { source: '0xio-sdk-request', request },
        window.location.origin
      );
    },

    postRequestToParent(request: AdapterRequest, parentOrigin: string): void {
      try {
        window.parent.postMessage(
          { source: '0xio-sdk-request', request },
          parentOrigin
        );
      } catch {
        // Do not fall back to '*' — silent failure is safer
      }
    },

    listen(
      handler: (msg: AdapterIncomingMessage) => void,
      options?: { trustedParentOrigins?: string[] }
    ): () => void {
      const allowedOrigin = window.location.origin;

      const trustedParentOrigins = new Set([
        allowedOrigin,
        'tauri://localhost',
        'https://tauri.localhost',
        'http://localhost',
        'https://localhost',
        ...(extraTrustedOrigins),
        ...(options?.trustedParentOrigins ?? []),
      ]);

      let _sessionNonce: string | null = null;

      // H-2: receive session nonce from injected.ts (MAIN world content script)
      const nonceListener = (e: MessageEvent) => {
        if (e.origin !== allowedOrigin) return;
        if (e.data?.source === '0xio-sdk-nonce-init' && typeof e.data.nonce === 'string') {
          _sessionNonce = e.data.nonce;
          window.removeEventListener('message', nonceListener);
        }
      };
      window.addEventListener('message', nonceListener);

      const msgListener = (e: MessageEvent) => {
        const isFromSameOrigin = e.origin === allowedOrigin;
        const isLocalhost =
          e.origin.startsWith('http://localhost:') ||
          e.origin.startsWith('http://127.0.0.1:');
        const isFromTrustedParent =
          e.source === window.parent &&
          window.parent !== window &&
          (trustedParentOrigins.has(e.origin) || isLocalhost);

        if (!isFromSameOrigin && !isFromTrustedParent) return;
        if (e.source !== window && e.source !== window.parent) return;
        if (!e.data || e.data.source !== '0xio-sdk-bridge') return;

        // H-2: session nonce validation.
        // Preferred path: nonce set via 0xio-sdk-nonce-init from injected.ts.
        // Fallback path: if the init broadcast was missed (race between document_start
        // content script and page script load), capture nonce from the first same-origin
        // response so that all subsequent responses are validated.
        if (!_sessionNonce && isFromSameOrigin && typeof e.data.sessionNonce === 'string') {
          _sessionNonce = e.data.sessionNonce;
        }
        if (_sessionNonce && e.data.sessionNonce !== _sessionNonce) return;

        if (e.data.response) {
          const r = e.data.response;
          handler({
            requestId: r.id,
            success: r.success,
            data: r.data,
            error: r.error,
          });
        } else if (e.data.event) {
          handler({
            eventType: e.data.event.type,
            eventData: e.data.event.data ?? e.data.event,
          });
        }
      };
      window.addEventListener('message', msgListener);

      return () => {
        window.removeEventListener('message', nonceListener);
        window.removeEventListener('message', msgListener);
      };
    },

    listenForReady(onReady: () => void): () => void {
      const handler = () => onReady();
      window.addEventListener('0xioWalletReady', handler);
      window.addEventListener('wallet0xioReady', handler);
      return () => {
        window.removeEventListener('0xioWalletReady', handler);
        window.removeEventListener('wallet0xioReady', handler);
      };
    },
  };
}

/** Default 0xio adapter instance (no extra trusted origins). */
export const ZeroXIOAdapter = createZeroXIOAdapter();
