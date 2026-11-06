import { ZeroXIOWallet } from '../src/wallet';
import { ErrorCode } from '../src/types';
import { detectWallet, isMobileBrowser } from '../src/detect';
import {
  FINAL_REQUEST_STATUSES,
  LIFECYCLE_LIMITS,
  LIFECYCLE_METHODS,
  REQUEST_STATUS_TRANSITIONS,
  TRANSACTION_METHODS,
  WALLET_CAPABILITIES,
  isRequestId,
  newRequestId,
  openInAppUrl,
  requestDigest,
  requestDigestInput,
} from '../src/lifecycle';
import { ReferenceWallet } from '../conformance/reference/referenceWallet';
import { createLegacyWallet } from '../conformance/reference/legacyWallet';
import { BrowserPage, installBrowserPage } from '../conformance/reference/browserPage';

const vectors = require('../conformance/vectors.json');

let page: BrowserPage | null = null;
const navDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

function setNavigator(value: unknown): void {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value });
}

afterEach(() => {
  page?.uninstall();
  page = null;
  delete (globalThis as any).WebSocket;
  if (navDescriptor) Object.defineProperty(globalThis, 'navigator', navDescriptor);
  else delete (globalThis as any).navigator;
});

function fakeDesktop(running: boolean) {
  const made: string[] = [];
  (globalThis as any).WebSocket = class {
    onopen: any = null;
    onmessage: any = null;
    onerror: any = null;
    onclose: any = null;
    constructor(url: string) {
      made.push(url);
      setTimeout(() => (running ? this.onopen?.({}) : this.onerror?.({})), 0);
    }
    send(data: string) {
      const msg = JSON.parse(data);
      setTimeout(() => this.onmessage?.({ data: JSON.stringify({ _id: msg._id, v: 1, wallet: '0xio-desktop', version: '0.6.2', protocol: 2 }) }), 0);
    }
    close() {}
  };
  return made;
}

describe('detectWallet', () => {
  it('reads a protocol 2 wallet from its repeated announce', async () => {
    page = installBrowserPage(new ReferenceWallet());
    const res = await detectWallet({ desktop: false });
    expect(res).toEqual({
      injected: { kind: 'extension', version: '3.0.6', protocol: 2 },
      desktop: 'not-allowed',
      mobile: false,
      openInAppUrl: null,
      next: 'connect',
    });
  });

  it('reads a protocol 1 wallet that injects late, with the version from 0xioWalletReady', async () => {
    page = installBrowserPage(createLegacyWallet(), { injected: false });
    const win = page.window;
    setTimeout(() => {
      win.wallet0xio = {};
      win.dispatchEvent(new CustomEvent('0xioWalletReady', { detail: { version: '3.0.5' } }));
    }, 50);
    const res = await detectWallet({ desktop: false });
    expect(res.injected).toEqual({ kind: 'extension', version: '3.0.5', protocol: 1 });
  });

  it('reads an old 0xio app build from the WebView marker', async () => {
    page = installBrowserPage(createLegacyWallet(), { injected: false });
    page.window.ReactNativeWebView = {};
    const res = await detectWallet({ desktop: false, detectTimeoutMs: 20 });
    expect(res.injected).toEqual({ kind: 'app-expo', protocol: 1 });
  });

  it('on a phone with nothing injected offers the app link', async () => {
    page = installBrowserPage(createLegacyWallet(), { injected: false });
    setNavigator({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' });
    const res = await detectWallet({ detectTimeoutMs: 20 });
    expect(res).toMatchObject({
      injected: null,
      desktop: 'not-allowed',
      mobile: true,
      openInAppUrl: 'https://0xio.xyz/open?url=' + encodeURIComponent('https://site.example/'),
      next: 'open-in-app',
    });
  });

  it('on a computer with nothing at all says install, after the short window', async () => {
    page = installBrowserPage(createLegacyWallet(), { injected: false });
    const started = Date.now();
    const res = await detectWallet({ desktop: false });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(res).toMatchObject({ injected: null, next: 'install' });
  });

  it.each([
    ['granted', true, 'available', 1],
    ['granted', false, 'not-running', 1],
    ['prompt', true, 'unknown-until-connect', 0],
    ['denied', true, 'blocked', 0],
  ] as const)('desktop with permission %s (running %s) is %s, %d sockets', async (state, running, expected, sockets) => {
    page = installBrowserPage(createLegacyWallet(), { injected: false });
    const made = fakeDesktop(running);
    setNavigator({ userAgent: 'Mozilla/5.0 (Macintosh)', permissions: { query: async () => ({ state }) } });
    const res = await detectWallet({ detectTimeoutMs: 20 });
    expect(res.desktop).toBe(expected);
    expect(made).toHaveLength(sockets);
    expect(res.next).toBe(expected === 'available' || expected === 'unknown-until-connect' ? 'connect' : 'install');
  });

  it('wallet.detect() needs no initialize()', async () => {
    page = installBrowserPage(new ReferenceWallet({ kind: 'app-expo' }));
    const w = new ZeroXIOWallet({ appName: 'Test', desktop: false });
    expect((await w.detect()).injected).toMatchObject({ kind: 'app-expo', protocol: 2 });
    w.cleanup();
  });
});

describe('initialize() detection window', () => {
  it('fails in about 300 ms, not 10 s, when nothing is injected', async () => {
    page = installBrowserPage(createLegacyWallet(), { injected: false });
    const w = new ZeroXIOWallet({ appName: 'Test', desktop: false });
    const started = Date.now();
    await expect(w.initialize()).rejects.toMatchObject({ code: ErrorCode.EXTENSION_NOT_FOUND, details: { desktop: 'not-allowed' } });
    expect(Date.now() - started).toBeLessThan(1_500);
    w.cleanup();
  });

  it('finds a protocol 2 wallet by its announce alone', async () => {
    page = installBrowserPage(new ReferenceWallet());
    delete page.window.wallet0xio;
    const w = new ZeroXIOWallet({ appName: 'Test', desktop: false });
    await expect(w.initialize()).resolves.toBe(true);
    expect(w.walletInfo?.protocol).toBe(2);
    w.cleanup();
  });
});

describe('openInAppUrl', () => {
  it('builds the universal link, or the scheme link on request', () => {
    expect(openInAppUrl('https://pool.example/a?b=1')).toBe('https://0xio.xyz/open?url=https%3A%2F%2Fpool.example%2Fa%3Fb%3D1');
    expect(openInAppUrl('https://pool.example/', { scheme: true })).toBe('oxio://open?url=https%3A%2F%2Fpool.example%2F');
  });

  it.each(['http://pool.example/', 'https://u:p@pool.example/', 'javascript:alert(1)', 'not a url', 'https://pool.example/' + 'a'.repeat(2048)])(
    'refuses %s',
    (url) => {
      expect(openInAppUrl(url)).toBeNull();
    }
  );

  it('defaults to this page', () => {
    page = installBrowserPage(createLegacyWallet(), { injected: false });
    const w = new ZeroXIOWallet({ appName: 'Test', desktop: false });
    expect(w.openInAppUrl()).toBe('https://0xio.xyz/open?url=' + encodeURIComponent('https://site.example/'));
    w.cleanup();
  });

  it('isMobileBrowser counts an iPad that reports a Mac', () => {
    setNavigator({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 });
    expect(isMobileBrowser()).toBe(true);
    setNavigator({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 0 });
    expect(isMobileBrowser()).toBe(false);
  });
});

describe('request ids and shared vectors', () => {
  it('newRequestId gives 32 lowercase hex characters, never twice', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newRequestId()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(isRequestId(id)).toBe(true);
    for (const id of vectors.requestId.valid) expect(isRequestId(id)).toBe(true);
    for (const id of vectors.requestId.invalid) expect(isRequestId(id)).toBe(false);
  });

  it('vectors.json matches the implementation', async () => {
    expect(vectors.capabilities).toEqual([...WALLET_CAPABILITIES]);
    expect(vectors.lifecycleMethods).toEqual([...LIFECYCLE_METHODS]);
    expect(vectors.transactionMethods).toEqual([...TRANSACTION_METHODS]);
    expect(vectors.transitions).toEqual(REQUEST_STATUS_TRANSITIONS);
    expect(vectors.finalStatuses).toEqual([...FINAL_REQUEST_STATUSES]);
    expect(vectors.limits).toEqual(LIFECYCLE_LIMITS);
    for (const v of vectors.digest) {
      expect(requestDigestInput(v.method, v.params, v.network)).toBe(v.canonical);
      expect(await requestDigest(v.method, v.params, v.network)).toBe(v.sha256);
    }
    for (const v of vectors.openInApp) {
      expect(openInAppUrl(v.url)).toBe(v.link);
      expect(openInAppUrl(v.url, { scheme: true })).toBe(v.scheme);
    }
  });
});
