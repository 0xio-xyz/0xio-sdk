
import type { WalletTransportAdapter, AdapterRequest, AdapterIncomingMessage } from '../adapter';
import { ANNOUNCE_EVENT, parseAnnounce, requestWalletAnnounce, watchWalletSignals } from '../lifecycle';

/** `extraTrustedOrigins` are allowed as parent iframe bridges besides the built-in ones. */
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
        // The extension also exposes window.octra; matching it here keeps this adapter first
        (win.octra?.isOctra && (win.wallet0xio || win.ZeroXIOWallet)) ||
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
        // Never fall back to '*', which would leak the request to any frame
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

      // A page script cannot forge the session nonce, so responses without it are dropped
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

        // The init broadcast can race the page script; then the first same-origin response sets it
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
            ...(typeof r.rid === 'string' ? { rid: r.rid } : {}),
            ...(typeof r.status === 'string' ? { status: r.status } : {}),
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
      const onAnnounce = (e: Event) => {
        if (parseAnnounce((e as CustomEvent).detail)) onReady();
      };
      watchWalletSignals();
      window.addEventListener('0xioWalletReady', handler);
      window.addEventListener('wallet0xioReady', handler);
      window.addEventListener(ANNOUNCE_EVENT, onAnnounce);
      requestWalletAnnounce();
      return () => {
        window.removeEventListener('0xioWalletReady', handler);
        window.removeEventListener('wallet0xioReady', handler);
        window.removeEventListener(ANNOUNCE_EVENT, onAnnounce);
      };
    },
  };
}

export const ZeroXIOAdapter = createZeroXIOAdapter();
