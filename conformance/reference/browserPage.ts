import { ANNOUNCE_EVENT, ANNOUNCE_REQUEST_EVENT } from '../../src/lifecycle';
import type { WireRequest } from '../harness';
import { ReferencePage, ReferenceWallet } from './referenceWallet';

export interface BrowserPage {
  readonly window: any;
  readonly page: ReferencePage;
  close(): Promise<void>;
  uninstall(): void;
}

const NONCE = 'reference-session-nonce';

export function installBrowserPage(
  wallet: ReferenceWallet,
  options: { origin?: string; injected?: boolean } = {}
): BrowserPage {
  const origin = options.origin ?? 'https://site.example';
  const url = new URL(origin);
  const win: any = new EventTarget();
  win.location = { origin, href: `${origin}/`, protocol: url.protocol, hostname: url.hostname };
  win.isSecureContext = true;
  win.parent = win;
  const store = new Map<string, string>();
  win.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  };
  const page = wallet.openPage(origin);

  const toPage = (data: unknown) => {
    setTimeout(() => {
      const ev = Object.assign(new Event('message'), { data, origin, source: win });
      win.dispatchEvent(ev);
    }, 0);
  };

  win.postMessage = (data: any) => {
    if (data?.source === '0xio-sdk-request' && data.request) {
      const request = data.request as WireRequest;
      page.send(request).then(
        (reply) => {
          const { rid: _rid, ...response } = reply;
          toPage({ source: '0xio-sdk-bridge', sessionNonce: NONCE, response });
        },
        () => {}
      );
      return;
    }
    toPage(data);
  };
  page.onEvent((event) => toPage({ source: '0xio-sdk-bridge', sessionNonce: NONCE, event }));

  const previous = { window: (globalThis as any).window, document: (globalThis as any).document };
  (globalThis as any).window = win;
  (globalThis as any).document = { querySelector: () => null };

  if (options.injected !== false) {
    win.wallet0xio = {};
    const announce = wallet.announceDetail();
    if (announce) {
      win.addEventListener(ANNOUNCE_REQUEST_EVENT, () => {
        win.dispatchEvent(new CustomEvent(ANNOUNCE_EVENT, { detail: Object.freeze({ ...announce }) }));
      });
      win.dispatchEvent(new CustomEvent(ANNOUNCE_EVENT, { detail: Object.freeze({ ...announce }) }));
    }
    win.dispatchEvent(new CustomEvent('0xioWalletReady', { detail: { version: wallet.version } }));
  }

  return {
    window: win,
    page,
    close: () => page.close(),
    uninstall() {
      (globalThis as any).window = previous.window;
      (globalThis as any).document = previous.document;
      if (previous.window === undefined) delete (globalThis as any).window;
      if (previous.document === undefined) delete (globalThis as any).document;
    },
  };
}
