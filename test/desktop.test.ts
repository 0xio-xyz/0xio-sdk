import { ZeroXIOWallet } from '../src/wallet';
import { ExtensionCommunicator } from '../src/communication';
import {
  DesktopTransport,
  canUseDesktopTransport,
  desktopErrorCode,
  desktopSiteEvent,
  DESKTOP_REVIEW_TIMEOUT_MS,
  DESKTOP_RETRY_BASE_MS,
} from '../src/desktop';
import { ErrorCode, ZeroXIOWalletError } from '../src/types';
import { createLogger } from '../src/utils';

const ORIGIN = 'https://site.example';
const ADDRESS = 'oct' + 'A'.repeat(44);
const NETWORK = {
  id: 'mainnet',
  name: 'Octra Mainnet',
  rpcUrl: 'https://octra.network',
  supportsPrivacy: true,
  color: '#000000',
  isTestnet: false,
};
const DEVNET = { ...NETWORK, id: 'devnet', name: 'Octra Devnet', isTestnet: true };

type Reply = Record<string, unknown> | undefined;
type Handler = (msg: any, sock: FakeSocket) => Reply | Promise<Reply>;

/** An in-memory 0xio Desktop: accepts sockets, answers frames like the desktop server. */
class MockDesktop {
  up = true;
  /** Accepts the socket but never opens it (a prompt or a hung port). */
  hang = false;
  sockets: FakeSocket[] = [];
  frames: any[] = [];
  connected = false;
  network = 'mainnet';
  onRequest: Handler = (msg) => defaultAnswer(msg, this);

  accept(sock: FakeSocket): void {
    this.sockets.push(sock);
    if (this.hang) return;
    setTimeout(() => {
      if (this.up) {
        sock.readyState = 1;
        sock.onopen?.({});
      } else {
        sock.readyState = 3;
        sock.onerror?.({});
        sock.onclose?.({});
      }
    }, 0);
  }

  async receive(sock: FakeSocket, msg: any): Promise<void> {
    this.frames.push(msg);
    let reply: Reply;
    if (msg.method === 'site_hello') {
      reply = this.connected
        ? { v: 1, wallet: '0xio-desktop', version: '0.6.0', network: this.network }
        : { v: 1, wallet: '0xio-desktop' };
    } else if (msg.method === 'sites_subscribe') {
      reply = { ok: true };
    } else if (msg.method === 'site_cancel') {
      reply = { ok: true };
    } else {
      reply = await this.onRequest(msg, sock);
    }
    if (reply === undefined) return;
    setTimeout(() => sock.push({ _id: msg._id, ...(msg.id ? { id: msg.id } : {}), ...reply }), 0);
  }

  requests(): any[] {
    return this.frames.filter((f) => f.method === 'site_request');
  }

  last(): FakeSocket {
    return this.sockets[this.sockets.length - 1];
  }
}

function defaultAnswer(msg: any, d: MockDesktop): Reply {
  const { method, params } = msg.request;
  switch (method) {
    case 'register_dapp':
      return { result: { registered: true } };
    case 'connect':
      d.connected = true;
      return {
        result: {
          address: ADDRESS,
          canSign: true,
          wallet: '0xio-desktop',
          networkInfo: msg.network === 'devnet' ? DEVNET : NETWORK,
          permissions: ['accounts'],
        },
      };
    case 'getBalance':
      return { result: { balance: '12.5', privateBalance: '0', nonce: 3 } };
    case 'switch_network':
      return { result: { network: params.networkId, switched: true } };
    default:
      return { result: { method } };
  }
}

class FakeSocket {
  static server: MockDesktop;
  static made = 0;
  readyState = 0;
  onopen: ((e: any) => void) | null = null;
  onmessage: ((e: any) => void) | null = null;
  onclose: ((e: any) => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  constructor(public url: string) {
    FakeSocket.made += 1;
    FakeSocket.server.accept(this);
  }
  send(data: string): void {
    if (this.readyState !== 1) throw new Error('not open');
    void FakeSocket.server.receive(this, JSON.parse(data));
  }
  close(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    const cb = this.onclose;
    setTimeout(() => cb?.({}), 0);
  }
  /** Server to page. */
  push(obj: unknown): void {
    if (this.readyState !== 1) return;
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
  /** The desktop quits: the socket drops. */
  drop(): void {
    this.readyState = 3;
    this.onclose?.({});
  }
}

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

let pageListeners: Record<string, Set<(e: any) => void>>;

function fakeWindow(location: { protocol: string; hostname: string; origin: string }, isSecureContext = true) {
  pageListeners = {};
  const win: any = {
    location,
    isSecureContext,
    postMessage: () => {},
    addEventListener: (t: string, fn: any) => {
      (pageListeners[t] ??= new Set()).add(fn);
    },
    removeEventListener: (t: string, fn: any) => {
      pageListeners[t]?.delete(fn);
    },
  };
  win.parent = win;
  return win;
}

const SECURE = { protocol: 'https:', hostname: 'site.example', origin: ORIGIN };

let desktop: MockDesktop;

beforeEach(() => {
  desktop = new MockDesktop();
  FakeSocket.server = desktop;
  FakeSocket.made = 0;
  (globalThis as any).WebSocket = FakeSocket;
  (globalThis as any).window = fakeWindow(SECURE);
  (globalThis as any).document = { querySelector: () => null };
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
  delete (globalThis as any).WebSocket;
  delete (globalThis as any).window;
  delete (globalThis as any).document;
});

function noExtension() {
  jest.spyOn(ExtensionCommunicator.prototype, 'initialize').mockResolvedValue(false);
}

async function desktopWallet(config: Record<string, unknown> = {}) {
  noExtension();
  const w = new ZeroXIOWallet({ appName: 'Test', ...config });
  await w.initialize();
  return w;
}

describe('transport selection', () => {
  it('prefers the extension and never opens the desktop socket', async () => {
    jest.spyOn(ExtensionCommunicator.prototype, 'initialize').mockResolvedValue(true);
    const ext = jest.spyOn(ExtensionCommunicator.prototype, 'sendRequest').mockResolvedValue({});
    const w = new ZeroXIOWallet({ appName: 'Test' });
    await w.initialize();
    expect(w.transport).toBe('extension');
    expect(ext).toHaveBeenCalledWith('register_dapp', expect.any(Object));
    expect(FakeSocket.made).toBe(0);
    w.cleanup();
  });

  it('falls back to 0xio Desktop when no extension answers', async () => {
    const cleanup = jest.spyOn(ExtensionCommunicator.prototype, 'cleanup');
    const w = await desktopWallet();
    expect(w.transport).toBe('desktop');
    expect(w.isReady()).toBe(true);
    expect(cleanup).toHaveBeenCalled();
    expect(desktop.last().url).toBe('ws://127.0.0.1:19345');
    expect(desktop.frames.map((f) => f.method)).toEqual(['site_hello', 'sites_subscribe', 'site_request']);
    expect(desktop.requests()[0].request.method).toBe('register_dapp');
    w.cleanup();
    expect(w.transport).toBeNull();
  });

  it('reports no wallet when neither answers', async () => {
    noExtension();
    desktop.up = false;
    const w = new ZeroXIOWallet({ appName: 'Test' });
    await expect(w.initialize()).rejects.toMatchObject({ code: ErrorCode.EXTENSION_NOT_FOUND });
    expect(w.transport).toBeNull();
    expect(FakeSocket.made).toBe(1);
    w.cleanup();
  });

  it('gives up on a socket that does not open in time', async () => {
    desktop.hang = true;
    const t = new DesktopTransport({ connectTimeoutMs: 20 });
    expect(await t.initialize()).toBe(false);
    t.cleanup();
  });

  it('refuses a socket that is not 0xio Desktop', async () => {
    desktop.receive = async (sock, msg) => {
      setTimeout(() => sock.push({ _id: msg._id, v: 1, wallet: 'other' }), 0);
    };
    const t = new DesktopTransport();
    expect(await t.initialize()).toBe(false);
    t.cleanup();
  });

  it('does not try the desktop when the site opts out', async () => {
    noExtension();
    const w = new ZeroXIOWallet({ appName: 'Test', desktop: false });
    await expect(w.initialize()).rejects.toMatchObject({ code: ErrorCode.EXTENSION_NOT_FOUND });
    expect(FakeSocket.made).toBe(0);
    w.cleanup();
  });

  it('does not try the desktop for an adapter of another wallet', async () => {
    noExtension();
    const adapter = { name: 'other', displayName: 'Other', detect: () => false, postRequest: () => {}, listen: () => () => {} };
    const w = new ZeroXIOWallet({ appName: 'Test', adapter });
    await expect(w.initialize()).rejects.toMatchObject({ code: ErrorCode.EXTENSION_NOT_FOUND });
    expect(FakeSocket.made).toBe(0);
    w.cleanup();
  });

  it('does not try the desktop on a plain http page that is not localhost', async () => {
    (globalThis as any).window = fakeWindow({ protocol: 'http:', hostname: 'site.example', origin: 'http://site.example' }, false);
    noExtension();
    const w = new ZeroXIOWallet({ appName: 'Test' });
    await expect(w.initialize()).rejects.toMatchObject({ code: ErrorCode.EXTENSION_NOT_FOUND });
    expect(FakeSocket.made).toBe(0);
    w.cleanup();
  });

  it('skips the socket when local network access is denied', async () => {
    const nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { permissions: { query: async ({ name }: { name: string }) => {
        if (name !== 'local-network-access') throw new TypeError('unknown');
        return { state: 'denied' };
      } } },
    });
    try {
      const t = new DesktopTransport();
      expect(await t.initialize()).toBe(false);
      expect(FakeSocket.made).toBe(0);
      t.cleanup();
    } finally {
      if (nav) Object.defineProperty(globalThis, 'navigator', nav);
      else delete (globalThis as any).navigator;
    }
  });
});

/** Runs `run` with the browser reporting this local network permission state. */
async function withPermission(state: 'granted' | 'denied' | 'prompt' | 'throws', run: () => Promise<void>) {
  const nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { permissions: { query: async () => {
      if (state === 'throws') throw new TypeError('unknown permission');
      return { state };
    } } },
  });
  try {
    await run();
  } finally {
    if (nav) Object.defineProperty(globalThis, 'navigator', nav);
    else delete (globalThis as any).navigator;
  }
}

describe('local network permission', () => {
  it('granted: initialize() opens the desktop at once', () =>
    withPermission('granted', async () => {
      const w = await desktopWallet();
      expect(w.transport).toBe('desktop');
      expect(w.desktopAvailableOnConnect).toBe(false);
      w.cleanup();
    }));

  it('not reported by the browser: initialize() opens the desktop at once', () =>
    withPermission('throws', async () => {
      const w = await desktopWallet();
      expect(w.transport).toBe('desktop');
      w.cleanup();
    }));

  it('denied: no socket, and no wallet', () =>
    withPermission('denied', async () => {
      noExtension();
      const w = new ZeroXIOWallet({ appName: 'Test' });
      await expect(w.initialize()).rejects.toMatchObject({ code: ErrorCode.EXTENSION_NOT_FOUND });
      expect(FakeSocket.made).toBe(0);
      expect(w.desktopAvailableOnConnect).toBe(false);
      w.cleanup();
    }));

  it('prompt: initialize() resolves without a socket and connect() opens the desktop', () =>
    withPermission('prompt', async () => {
      noExtension();
      const w = new ZeroXIOWallet({ appName: 'Test' });
      await expect(w.initialize()).resolves.toBe(true);
      expect(w.transport).toBeNull();
      expect(w.desktopAvailableOnConnect).toBe(true);
      expect(w.isReady()).toBe(false);
      expect(FakeSocket.made).toBe(0);

      const res = await w.connect();
      expect(res.address).toBe(ADDRESS);
      expect(w.transport).toBe('desktop');
      expect(w.desktopAvailableOnConnect).toBe(false);
      expect(FakeSocket.made).toBe(1);
      expect(desktop.requests().map((f) => f.request.method)).toEqual(['register_dapp', 'connect']);
      w.cleanup();
    }));

  it('prompt: connect() fails as no wallet when the desktop does not answer, and tries again next time', () =>
    withPermission('prompt', async () => {
      noExtension();
      desktop.up = false;
      const w = new ZeroXIOWallet({ appName: 'Test' });
      await w.initialize();
      await expect(w.connect()).rejects.toMatchObject({ code: ErrorCode.EXTENSION_NOT_FOUND });
      expect(w.transport).toBeNull();
      expect(w.desktopAvailableOnConnect).toBe(true);

      desktop.up = true;
      await w.connect();
      expect(w.transport).toBe('desktop');
      expect(FakeSocket.made).toBe(2);
      w.cleanup();
    }));

  it('prompt: connect() uses the extension if it appeared after initialize()', () =>
    withPermission('prompt', async () => {
      const init = jest.spyOn(ExtensionCommunicator.prototype, 'initialize').mockResolvedValueOnce(false).mockResolvedValue(true);
      const w = new ZeroXIOWallet({ appName: 'Test' });
      await w.initialize();
      jest.spyOn(ExtensionCommunicator.prototype, 'isExtensionAvailable').mockReturnValue(true);
      const ext = jest.spyOn(ExtensionCommunicator.prototype, 'sendRequest').mockImplementation(async (method: string) =>
        method === 'connect' ? { address: ADDRESS, networkInfo: NETWORK } : {}
      );
      await w.connect();
      expect(init).toHaveBeenCalledTimes(2);
      expect(ext.mock.calls.map((c) => c[0])).toEqual(['register_dapp', 'connect']);
      expect(w.transport).toBe('extension');
      expect(FakeSocket.made).toBe(0);
      w.cleanup();
    }));

  it('prompt: two connect() calls at once open one socket', () =>
    withPermission('prompt', async () => {
      noExtension();
      const w = new ZeroXIOWallet({ appName: 'Test' });
      await w.initialize();
      const a = w.connect();
      const b = w.connect().catch((e) => e);
      await a;
      await b;
      expect(FakeSocket.made).toBe(1);
      expect(desktop.requests().filter((f) => f.request.method === 'register_dapp')).toHaveLength(1);
      w.cleanup();
    }));
});

describe('secure context rule', () => {
  const win = (protocol: string, hostname: string, secure: boolean) =>
    fakeWindow({ protocol, hostname, origin: `${protocol}//${hostname}` }, secure);

  it.each([
    ['https secure', win('https:', 'site.example', true), true],
    ['https not secure (insecure frame)', win('https:', 'site.example', false), false],
    ['http localhost', win('http:', 'localhost', true), true],
    ['http 127.0.0.1', win('http:', '127.0.0.1', true), true],
    ['http [::1]', win('http:', '[::1]', true), true],
    ['http public host', win('http:', 'site.example', false), false],
    ['file page', win('file:', '', true), false],
    ['extension page', win('chrome-extension:', 'abc', true), false],
  ])('%s', (_name, w, allowed) => {
    expect(canUseDesktopTransport(w)).toBe(allowed);
  });

  it('is never allowed outside a browser', () => {
    delete (globalThis as any).window;
    expect(canUseDesktopTransport()).toBe(false);
    delete (globalThis as any).WebSocket;
    expect(canUseDesktopTransport(win('https:', 'site.example', true))).toBe(false);
  });
});

describe('requests', () => {
  it('sends site_request frames with no site or origin field, and maps results', async () => {
    const w = await desktopWallet();
    const res = await w.connect();
    expect(res).toMatchObject({ address: ADDRESS, canSign: true, networkInfo: { id: 'mainnet' } });

    const frame = desktop.requests().find((f) => f.request.method === 'connect');
    expect(frame).toMatchObject({ v: 1, method: 'site_request', network: 'mainnet' });
    expect(typeof frame._id).toBe('number');
    expect(frame.id).toMatch(/^[0-9a-f]{32}$/);
    expect(frame.request.params.permissions).toEqual(expect.any(Array));
    for (const f of desktop.frames) {
      expect(f).not.toHaveProperty('site');
      expect(f).not.toHaveProperty('origin');
    }

    const balance = await w.getBalance();
    expect(balance).toEqual({ public: 12.5, private: 0, total: 12.5, currency: 'OCT' });
    w.cleanup();
  });

  it('connects on the network the site asks for, then follows the answer', async () => {
    const w = await desktopWallet({ networkId: 'devnet' });
    await w.connect();
    expect(desktop.requests().find((f) => f.request.method === 'connect').network).toBe('devnet');
    await w.getBalance();
    expect(desktop.requests().pop().network).toBe('devnet');
    w.cleanup();
  });

  it('carries switch_network and sends later requests on the new network', async () => {
    const w = await desktopWallet();
    await w.connect();
    expect(await w.switchNetwork('devnet')).toEqual({ network: 'devnet', switched: true });
    await w.getBalance();
    expect(desktop.requests().pop().network).toBe('devnet');
    w.cleanup();
  });

  it('keeps one review open at a time, like the extension', async () => {
    const w = await desktopWallet();
    await w.connect();
    let answer: () => void = () => {};
    desktop.onRequest = (msg) =>
      msg.request.method === 'signMessage'
        ? new Promise((r) => { answer = () => r({ result: { signature: 'sig' } }); })
        : defaultAnswer(msg, desktop);
    const first = w.signMessage('one');
    await tick();
    await expect(w.signMessage('two')).rejects.toMatchObject({ code: ErrorCode.RATE_LIMIT_EXCEEDED });
    answer();
    await expect(first).resolves.toBe('sig');
    w.cleanup();
  });

  it('does not time out a review the user is still reading', async () => {
    const w = await desktopWallet();
    await w.connect();
    jest.useFakeTimers();
    desktop.onRequest = (msg) => (msg.request.method === 'signMessage' ? undefined : defaultAnswer(msg, desktop));
    const p = w.signMessage('slow');
    const settled = jest.fn();
    p.then(settled, settled);
    await jest.advanceTimersByTimeAsync(5 * 60_000);
    expect(settled).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(DESKTOP_REVIEW_TIMEOUT_MS);
    await expect(p).rejects.toMatchObject({ code: ErrorCode.NETWORK_ERROR });
    w.cleanup();
  });
});

describe('error codes', () => {
  it.each([
    ['USER_REJECTED', ErrorCode.USER_REJECTED],
    ['RATE_LIMIT_EXCEEDED', ErrorCode.RATE_LIMIT_EXCEEDED],
    ['NOT_CONNECTED', ErrorCode.NOT_CONNECTED],
    ['NETWORK_ERROR', ErrorCode.NETWORK_ERROR],
    ['WALLET_LOCKED', ErrorCode.WALLET_LOCKED],
    ['METHOD_NOT_ALLOWED', ErrorCode.METHOD_NOT_ALLOWED],
    ['INVALID_PARAMS', ErrorCode.INVALID_PARAMS],
    ['UNSUPPORTED_METHOD', ErrorCode.UNSUPPORTED_METHOD],
    ['NOT_AVAILABLE', ErrorCode.NOT_AVAILABLE],
    ['NETWORK_CHANGED', ErrorCode.NETWORK_CHANGED],
    ['WALLET_CHANGED', ErrorCode.WALLET_CHANGED],
    ['RATE_LIMITED', ErrorCode.RATE_LIMIT_EXCEEDED],
    ['AUTH_REQUIRED', ErrorCode.NETWORK_ERROR],
    ['PAIRING_REQUIRED', ErrorCode.NETWORK_ERROR],
    ['AUTH_FAILED', ErrorCode.NETWORK_ERROR],
    ['lower-case', ErrorCode.UNKNOWN_ERROR],
    [42, ErrorCode.UNKNOWN_ERROR],
  ])('%s -> %s', (code, expected) => {
    expect(desktopErrorCode(code)).toBe(expected);
  });

  it('rejects a call with the desktop code and message', async () => {
    const w = await desktopWallet();
    await w.connect();
    desktop.onRequest = (msg) =>
      msg.request.method === 'signMessage'
        ? { error: { code: 'USER_REJECTED', message: 'Rejected in the menu bar' } }
        : defaultAnswer(msg, desktop);
    const err = await w.signMessage('hi').catch((e) => e);
    expect(err).toBeInstanceOf(ZeroXIOWalletError);
    expect(err).toMatchObject({ code: ErrorCode.USER_REJECTED, message: 'Rejected in the menu bar' });
    w.cleanup();
  });

  it.each([
    ['getPendingPrivateTransfers', 'get_pending_private_transfers', 'UNSUPPORTED_METHOD', (w: ZeroXIOWallet) => w.getPendingPrivateTransfers()],
    ['sendPrivateTransfer', 'send_private_transfer', 'NOT_AVAILABLE', (w: ZeroXIOWallet) => w.sendPrivateTransfer({ to: ADDRESS, amount: '1' })],
    ['claimPrivateTransfer', 'claim_private_transfer', 'WALLET_CHANGED', (w: ZeroXIOWallet) => w.claimPrivateTransfer('t1')],
    ['getPrivateBalanceInfo', 'get_private_balance_info', 'NETWORK_CHANGED', (w: ZeroXIOWallet) => w.getPrivateBalanceInfo()],
  ])('%s keeps the desktop refusal code', async (_n, method, code, run) => {
    const w = await desktopWallet();
    await w.connect();
    desktop.onRequest = (msg) =>
      msg.request.method === method ? { error: { code, message: 'Switch first' } } : defaultAnswer(msg, desktop);
    await expect(run(w)).rejects.toMatchObject({ code });
    w.cleanup();
  });
});

describe('events', () => {
  it('maps desktop site events to the extension shapes', () => {
    expect(desktopSiteEvent('accountsChanged', { accounts: [ADDRESS], publicKey: 'pk', canSign: false })).toEqual({
      type: 'accountChanged',
      data: { address: ADDRESS, publicKey: 'pk', canSign: false },
    });
    expect(desktopSiteEvent('accountsChanged', { accounts: [] })).toEqual({ type: 'disconnect', data: { reason: 'user_action' } });
    expect(desktopSiteEvent('networkChanged', DEVNET)).toEqual({ type: 'networkChanged', data: { networkInfo: DEVNET } });
    expect(desktopSiteEvent('networkChanged', { networkInfo: DEVNET })).toEqual({ type: 'networkChanged', data: { networkInfo: DEVNET } });
    expect(desktopSiteEvent('tx', { hash: 'h1', status: 'confirmed' })).toMatchObject({ type: 'transactionConfirmed', data: { txHash: 'h1' } });
    expect(desktopSiteEvent('tx', { hash: 'h2', status: 'rejected' })).toMatchObject({ type: 'transactionFailed', data: { txHash: 'h2' } });
    expect(desktopSiteEvent('lock', {})).toEqual({ type: 'extensionLocked', data: {} });
    expect(desktopSiteEvent('other', {})).toBeNull();
  });

  it('delivers pushed events through the wallet', async () => {
    const w = await desktopWallet();
    await w.connect();
    const seen: Record<string, any[]> = { accountChanged: [], networkChanged: [], disconnect: [], extensionLocked: [] };
    for (const t of Object.keys(seen)) w.on(t as any, (e) => seen[t].push(e.data));
    const sock = desktop.last();
    const B = 'oct' + 'B'.repeat(44);

    sock.push({ event: 'site_event', v: 1, origin: ORIGIN, kind: 'accountsChanged', data: { accounts: [B], canSign: true } });
    expect(seen.accountChanged[0]).toMatchObject({ previousAddress: ADDRESS, newAddress: B, canSign: true });

    sock.push({ event: 'site_event', v: 1, origin: ORIGIN, kind: 'networkChanged', data: DEVNET });
    expect(seen.networkChanged[0]).toMatchObject({ newNetwork: { id: 'devnet' } });
    expect(w.getNetworkId()).toBe('devnet');

    sock.push({ event: 'site_event', v: 1, origin: 'https://other.example', kind: 'lock', data: {} });
    expect(seen.extensionLocked).toHaveLength(0);

    sock.push({ event: 'site_event', v: 1, origin: ORIGIN, kind: 'accountsChanged', data: { accounts: [] } });
    expect(seen.disconnect).toEqual([{ reason: 'user_action' }]);
    expect(w.isConnected()).toBe(false);
    w.cleanup();
  });

  it('turns a desktop lock into extensionLocked and disconnect', async () => {
    const w = await desktopWallet();
    await w.connect();
    const seen: string[] = [];
    w.on('extensionLocked', () => seen.push('locked'));
    w.on('disconnect', (e) => seen.push(e.data.reason));
    desktop.last().push({ event: 'site_event', v: 1, origin: ORIGIN, kind: 'lock', data: {} });
    expect(seen).toEqual(['locked', 'extension_locked']);
    expect(w.isConnected()).toBe(false);
    w.cleanup();
  });
});

describe('cancel', () => {
  it('sends site_cancel for a request that times out', async () => {
    const t = new DesktopTransport();
    expect(await t.initialize()).toBe(true);
    jest.useFakeTimers();
    desktop.onRequest = () => undefined;
    const p = t.sendRequest('getBalance', {});
    const result = p.catch((e) => e);
    await jest.advanceTimersByTimeAsync(61_000);
    expect(await result).toMatchObject({ code: ErrorCode.NETWORK_ERROR });
    const req = desktop.requests()[0];
    expect(desktop.frames.find((f) => f.method === 'site_cancel')).toMatchObject({ v: 1, id: req.id });
    t.cleanup();
  });

  it('cancels waiting requests and closes the socket on cleanup', async () => {
    const t = new DesktopTransport();
    await t.initialize();
    desktop.onRequest = () => undefined;
    const p = t.sendRequest('signMessage', { message: 'hi' }).catch((e) => e);
    await tick();
    const req = desktop.requests()[0];
    t.cleanup();
    expect(await p).toMatchObject({ code: ErrorCode.NETWORK_ERROR });
    expect(desktop.frames.find((f) => f.method === 'site_cancel')).toMatchObject({ id: req.id });
    expect(desktop.last().readyState).toBe(3);
    await expect(t.sendRequest('getBalance')).rejects.toMatchObject({ code: ErrorCode.NETWORK_ERROR });
  });

  it('cancels waiting requests when the page is hidden', async () => {
    const t = new DesktopTransport();
    await t.initialize();
    desktop.onRequest = () => undefined;
    const p = t.sendRequest('send_transaction', { to: ADDRESS, amount: '1' }).catch((e) => e);
    await tick();
    pageListeners.pagehide.forEach((fn) => fn({}));
    expect(await p).toMatchObject({ code: ErrorCode.NETWORK_ERROR });
    expect(desktop.frames.filter((f) => f.method === 'site_cancel')).toHaveLength(1);
    t.cleanup();
  });
});

describe('socket drop and lazy reconnect', () => {
  it('fails waiting requests, emits disconnect, and reopens on the next call', async () => {
    const w = await desktopWallet();
    await w.connect();
    const reasons: string[] = [];
    w.on('disconnect', (e) => reasons.push(e.data.reason));
    desktop.onRequest = (msg) => (msg.request.method === 'signMessage' ? undefined : defaultAnswer(msg, desktop));
    const p = w.signMessage('hi').catch((e) => e);
    await tick();
    desktop.last().drop();
    expect(await p).toMatchObject({ code: ErrorCode.NETWORK_ERROR });
    expect(reasons).toEqual(['network_error']);
    expect(w.isConnected()).toBe(false);
    expect(FakeSocket.made).toBe(1);

    desktop.onRequest = (msg) => defaultAnswer(msg, desktop);
    await w.connect();
    expect(FakeSocket.made).toBe(2);
    expect(desktop.frames.filter((f) => f.method === 'site_hello')).toHaveLength(2);
    expect(desktop.frames.filter((f) => f.method === 'sites_subscribe')).toHaveLength(2);
    expect(w.isConnected()).toBe(true);
    w.cleanup();
  });

  it('waits a growing pause after failed reopen attempts', async () => {
    const t = new DesktopTransport();
    await t.initialize();
    desktop.up = false;
    desktop.last().drop();
    await expect(t.sendRequest('getBalance')).rejects.toMatchObject({ code: ErrorCode.NETWORK_ERROR });
    expect(FakeSocket.made).toBe(2);
    await expect(t.sendRequest('getBalance')).rejects.toMatchObject({ code: ErrorCode.NETWORK_ERROR });
    expect(FakeSocket.made).toBe(2);

    desktop.up = true;
    await tick(DESKTOP_RETRY_BASE_MS + 20);
    await expect(t.sendRequest('getBalance')).resolves.toEqual({ balance: '12.5', privateBalance: '0', nonce: 3 });
    expect(FakeSocket.made).toBe(3);
    t.cleanup();
  });

  it('learns the network from the hello of a desktop that already knows the site', async () => {
    desktop.connected = true;
    desktop.network = 'devnet';
    const t = new DesktopTransport();
    await t.initialize();
    expect(t.networkId).toBe('devnet');
    expect(t.desktopVersion).toBe('0.6.0');
    t.cleanup();
  });
});

describe('fixes on the extension path', () => {
  it('switch_network is interactive: no retry, long wait, one at a time', async () => {
    const c = Object.create(ExtensionCommunicator.prototype) as ExtensionCommunicator;
    const inner = jest.spyOn(c, 'sendRequestWithRetry').mockResolvedValue({ switched: true });
    await c.sendRequest('switch_network', { networkId: 'devnet' });
    expect(inner).toHaveBeenCalledWith('switch_network', { networkId: 'devnet' }, 0, 180000);
    expect((ExtensionCommunicator as any).INTERACTIVE_METHODS.has('switch_network')).toBe(true);
  });

  it('a disconnect event from the extension reaches the page', () => {
    const w = Object.create(ZeroXIOWallet.prototype) as ZeroXIOWallet;
    const comm: any = new (require('../src/events').EventEmitter)();
    Object.assign(w as any, {
      communicator: comm,
      connectionInfo: { isConnected: true, address: ADDRESS },
      listeners: new Map(),
      _sessionVersion: 0,
      logger: createLogger('test', false),
    });
    (w as any).setupExtensionEventListeners();
    const seen: any[] = [];
    w.on('disconnect', (e) => seen.push(e.data));
    comm.emit('disconnect', { origin: ORIGIN });
    expect(seen).toEqual([{ reason: 'user_action' }]);
    expect(w.isConnected()).toBe(false);
    comm.emit('disconnect', { origin: ORIGIN });
    expect(seen).toHaveLength(1);
  });
});
