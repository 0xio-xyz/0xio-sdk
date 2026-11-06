import { ZeroXIOWallet } from '../src/wallet';
import { ExtensionCommunicator } from '../src/communication';
import {
  DesktopTransport,
  canUseDesktopTransport,
  desktopErrorCode,
  desktopSiteEvent,
  DESKTOP_REVIEW_TIMEOUT_MS,
  DESKTOP_RETRY_BASE_MS,
  DESKTOP_SITE_TOKEN_KEY,
  readSiteToken,
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

class MockDesktop {
  up = true;
  /** Never opens the socket, like an unanswered prompt or a hung port. */
  hang = false;
  sockets: FakeSocket[] = [];
  frames: any[] = [];
  connected = false;
  network = 'mainnet';
  token: string | null = null;
  issued = 0;
  onRequest: Handler = (msg) => defaultAnswer(msg, this);

  issueToken(): string {
    this.issued += 1;
    this.token = String(this.issued).padStart(43, 'T');
    return this.token;
  }

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
      const sent = msg.site_token;
      const valid = this.connected && sent !== undefined && sent === this.token;
      reply = valid
        ? { v: 1, wallet: '0xio-desktop', version: '0.6.0', network: this.network }
        : { v: 1, wallet: '0xio-desktop' };
      if (sent !== undefined) reply.token_status = valid ? 'valid' : 'invalid';
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
          siteToken: d.issueToken(),
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
  push(obj: unknown): void {
    if (this.readyState !== 1) return;
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
  drop(): void {
    this.readyState = 3;
    this.onclose?.({});
  }
}

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

let pageListeners: Record<string, Set<(e: any) => void>>;

let stored: Map<string, string>;

function memoryStorage() {
  stored = new Map();
  return {
    getItem: (k: string) => stored.get(k) ?? null,
    setItem: (k: string, v: string) => void stored.set(k, String(v)),
    removeItem: (k: string) => void stored.delete(k),
  };
}

function fakeWindow(location: { protocol: string; hostname: string; origin: string }, isSecureContext = true) {
  pageListeners = {};
  const win: any = {
    location,
    isSecureContext,
    localStorage: memoryStorage(),
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
      expect(ext.mock.calls.map((c) => c[0])).toEqual(['register_dapp', 'wallet_hello', 'connect']);
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
    await expect(p).rejects.toMatchObject({ code: ErrorCode.STATUS_UNKNOWN });
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
    stored.set(DESKTOP_SITE_TOKEN_KEY, desktop.issueToken());
    const t = new DesktopTransport();
    await t.initialize();
    expect(t.networkId).toBe('devnet');
    expect(t.desktopVersion).toBe('0.6.0');
    t.cleanup();
  });
});

describe('site token', () => {
  const hellos = () => desktop.frames.filter((f) => f.method === 'site_hello');

  it('keeps the token of an approved connect out of the result and shows it in the next hello', async () => {
    const w = await desktopWallet();
    expect(hellos()[0]).not.toHaveProperty('site_token');
    const res = await w.connect();
    expect(res).not.toHaveProperty('siteToken');
    expect((res as any).siteToken).toBeUndefined();
    expect(stored.get(DESKTOP_SITE_TOKEN_KEY)).toBe(desktop.token);
    for (const f of desktop.requests()) expect(JSON.stringify(f)).not.toContain(desktop.token!);

    const first = desktop.token;
    desktop.last().drop();
    await w.connect();
    expect(hellos()).toHaveLength(2);
    expect(hellos()[1].site_token).toBe(first);
    expect(stored.get(DESKTOP_SITE_TOKEN_KEY)).toBe(desktop.token);
    w.cleanup();
  });

  it('restores the connected site on a new page load without a connect review', async () => {
    desktop.connected = true;
    stored.set(DESKTOP_SITE_TOKEN_KEY, desktop.issueToken());
    const t = new DesktopTransport();
    expect(await t.initialize()).toBe(true);
    expect(hellos()[0].site_token).toBe(desktop.token);
    expect(t.desktopVersion).toBe('0.6.0');
    expect(readSiteToken()).toBe(desktop.token);
    t.cleanup();
  });

  it('forgets a token the desktop calls invalid', async () => {
    desktop.connected = true;
    desktop.issueToken();
    stored.set(DESKTOP_SITE_TOKEN_KEY, 'F'.repeat(43));
    const t = new DesktopTransport();
    await t.initialize();
    expect(hellos()[0].site_token).toBe('F'.repeat(43));
    expect(t.desktopVersion).toBeUndefined();
    expect(stored.has(DESKTOP_SITE_TOKEN_KEY)).toBe(false);
    t.cleanup();
  });

  it('forgets the token on disconnect(), even when the desktop does not answer', async () => {
    const w = await desktopWallet();
    await w.connect();
    expect(stored.has(DESKTOP_SITE_TOKEN_KEY)).toBe(true);
    desktop.onRequest = (msg) =>
      msg.request.method === 'disconnect' ? { error: { code: 'NOT_CONNECTED', message: 'x' } } : defaultAnswer(msg, desktop);
    await w.disconnect().catch(() => undefined);
    expect(stored.has(DESKTOP_SITE_TOKEN_KEY)).toBe(false);
    w.cleanup();
  });

  it('forgets the token when the desktop disconnects the site, but not when the socket drops', async () => {
    const w = await desktopWallet();
    await w.connect();
    desktop.last().drop();
    expect(stored.has(DESKTOP_SITE_TOKEN_KEY)).toBe(true);
    await w.connect();
    desktop.last().push({ event: 'site_event', v: 1, origin: ORIGIN, kind: 'accountsChanged', data: { accounts: [] } });
    expect(stored.has(DESKTOP_SITE_TOKEN_KEY)).toBe(false);
    w.cleanup();
  });

  it('ignores a malformed token and works when storage throws', async () => {
    stored.set(DESKTOP_SITE_TOKEN_KEY, 'short');
    expect(readSiteToken()).toBeNull();
    desktop.onRequest = (msg) => {
      const r: any = defaultAnswer(msg, desktop);
      if (msg.request.method === 'connect') r.result.siteToken = 'not a token';
      return r;
    };
    const t = new DesktopTransport();
    await t.initialize();
    expect(hellos()[0]).not.toHaveProperty('site_token');
    const res = await t.sendRequest('connect', {});
    expect(res).not.toHaveProperty('siteToken');
    expect(stored.get(DESKTOP_SITE_TOKEN_KEY)).toBe('short');
    t.cleanup();

    const boom = () => {
      throw new Error('SecurityError');
    };
    (globalThis as any).window.localStorage = { getItem: boom, setItem: boom, removeItem: boom };
    desktop.onRequest = (msg) => defaultAnswer(msg, desktop);
    const w = await desktopWallet();
    await expect(w.connect()).resolves.toMatchObject({ address: ADDRESS });
    await w.disconnect();
    w.cleanup();

    Object.defineProperty((globalThis as any).window, 'localStorage', { get: boom });
    expect(readSiteToken()).toBeNull();
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

const CAPS = ['request_id', 'request_status', 'request_events', 'idempotent', 'wait_confirmed', 'receipt', 'can_sign', 'kind'];

function protocol2(d: MockDesktop, statuses = new Map<string, unknown>()): Map<string, unknown> {
  const original = d.receive.bind(d);
  d.receive = async (sock, msg) => {
    if (msg.method === 'site_hello') {
      d.frames.push(msg);
      setTimeout(() => sock.push({ _id: msg._id, v: 1, wallet: '0xio-desktop', version: '0.6.2', network: d.network, protocol: 2, capabilities: CAPS }), 0);
      return;
    }
    if (msg.method === 'site_status') {
      d.frames.push(msg);
      const result = statuses.get(msg.rid) ?? { requestId: msg.rid, status: 'unknown', seq: 0 };
      setTimeout(() => sock.push({ _id: msg._id, result }), 0);
      return;
    }
    return original(sock, msg);
  };
  return statuses;
}

describe('protocol 2 desktop', () => {
  it('reads protocol and capabilities from site_hello and puts rid at the top of site_request', async () => {
    protocol2(desktop);
    const w = await desktopWallet();
    expect(w.walletInfo).toEqual({ kind: 'desktop', version: '0.6.2', protocol: 2, capabilities: CAPS });
    await w.connect();
    const frame = desktop.requests().find((f) => f.request.method === 'connect');
    expect(frame.rid).toMatch(/^[0-9a-f]{32}$/);
    expect(frame.request).not.toHaveProperty('rid');
    expect(desktop.requests().find((f) => f.request.method === 'register_dapp')).not.toHaveProperty('rid');
    expect(desktop.frames.filter((f) => f.method === 'wallet_hello')).toHaveLength(0);
    w.cleanup();
  });

  it('a protocol 1 desktop reads as protocol 1 with no capabilities', async () => {
    const w = await desktopWallet();
    expect(w.walletInfo).toEqual({ kind: 'desktop', protocol: 1, capabilities: [] });
    w.cleanup();
  });

  it('on timeout keeps the review open (no site_cancel) and rejects STATUS_UNKNOWN with the id', async () => {
    protocol2(desktop);
    const w = await desktopWallet();
    await w.connect();
    desktop.onRequest = (msg) => (msg.request.method === 'signMessage' ? undefined : defaultAnswer(msg, desktop));
    jest.useFakeTimers();
    const p = w.signMessage('slow', { timeoutMs: 1_000 }).catch((e) => e);
    await jest.advanceTimersByTimeAsync(1_100);
    const err = await p;
    expect(err).toMatchObject({ code: ErrorCode.STATUS_UNKNOWN, details: { requestId: expect.stringMatching(/^[0-9a-f]{32}$/) } });
    expect(desktop.frames.filter((f) => f.method === 'site_cancel')).toHaveLength(0);
    w.cleanup();
  });

  it('a protocol 1 desktop still gets site_cancel on timeout, and the call reads STATUS_UNKNOWN', async () => {
    const w = await desktopWallet();
    await w.connect();
    desktop.onRequest = (msg) => (msg.request.method === 'signMessage' ? undefined : defaultAnswer(msg, desktop));
    jest.useFakeTimers();
    const p = w.signMessage('slow', { timeoutMs: 1_000 }).catch((e) => e);
    await jest.advanceTimersByTimeAsync(1_100);
    expect(await p).toMatchObject({ code: ErrorCode.STATUS_UNKNOWN });
    expect(desktop.frames.filter((f) => f.method === 'site_cancel')).toHaveLength(1);
    w.cleanup();
  });

  it('maps site_event kind request to requestUpdate, and each one restarts the wait', async () => {
    protocol2(desktop);
    const w = await desktopWallet();
    await w.connect();
    desktop.onRequest = (msg) => (msg.request.method === 'signMessage' ? undefined : defaultAnswer(msg, desktop));
    const seen: any[] = [];
    w.on('requestUpdate', (e) => seen.push(e.data));
    jest.useFakeTimers();
    const p = w.signMessage('slow', { timeoutMs: 1_000 });
    const settled = jest.fn();
    p.then(settled, settled);
    await jest.advanceTimersByTimeAsync(10);
    const rid = desktop.requests().find((f) => f.request.method === 'signMessage').rid;
    await jest.advanceTimersByTimeAsync(790);
    desktop.last().push({ event: 'site_event', v: 1, origin: ORIGIN, kind: 'request', data: { requestId: rid, status: 'review_open', seq: 2 } });
    await jest.advanceTimersByTimeAsync(700);
    expect(settled).not.toHaveBeenCalled();
    expect(seen.map((s) => s.status)).toEqual(['pending', 'review_open']);
    desktop.last().push({ event: 'site_event', v: 1, origin: 'https://other.example', kind: 'request', data: { requestId: rid, status: 'signing', seq: 3 } });
    await jest.advanceTimersByTimeAsync(400);
    expect(await p.catch((e) => e)).toMatchObject({ code: ErrorCode.STATUS_UNKNOWN, details: { requestId: rid, lastStatus: 'review_open' } });
    w.cleanup();
  });

  it('asks site_status for requestStatus', async () => {
    const statuses = protocol2(desktop);
    const w = await desktopWallet();
    const rid = '0123456789abcdef0123456789abcdef';
    statuses.set(rid, { requestId: rid, status: 'submitted', seq: 4, hash: 'b'.repeat(64) });
    expect(await w.requestStatus(rid)).toMatchObject({ requestId: rid, status: 'submitted', hash: 'b'.repeat(64) });
    expect(desktop.frames.find((f) => f.method === 'site_status')).toMatchObject({ v: 1, rid });
    w.cleanup();
  });

  it('on page close cancels an unanswered review but not an approved one', async () => {
    protocol2(desktop);
    const w = await desktopWallet();
    await w.connect();
    desktop.onRequest = (msg) => (msg.request.method === 'send_transaction' ? undefined : defaultAnswer(msg, desktop));
    const p = w.sendTransaction({ to: ADDRESS, amount: '1' }).catch((e) => e);
    await tick();
    const frame = desktop.requests().find((f) => f.request.method === 'send_transaction');
    desktop.last().push({ event: 'site_event', v: 1, origin: ORIGIN, kind: 'request', data: { requestId: frame.rid, status: 'signing', seq: 3 } });
    pageListeners.pagehide.forEach((fn) => fn({}));
    expect(await p).toMatchObject({ code: ErrorCode.NETWORK_ERROR, details: { requestId: frame.rid, status: 'unknown' } });
    expect(desktop.frames.filter((f) => f.method === 'site_cancel')).toHaveLength(0);
    w.cleanup();
  });
});

function changingPermission(initial: 'prompt' | 'granted' | 'denied') {
  const listeners = new Set<() => void>();
  const status = {
    state: initial as string,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  };
  const nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { permissions: { query: async () => status } },
  });
  return {
    set(state: 'granted' | 'denied') {
      status.state = state;
      listeners.forEach((fn) => fn());
    },
    restore() {
      if (nav) Object.defineProperty(globalThis, 'navigator', nav);
      else delete (globalThis as any).navigator;
    },
  };
}

describe('connect-time desktop attempt', () => {
  it('reports the prompt with connectProgress and ends at once when the visitor denies it', async () => {
    const perm = changingPermission('prompt');
    try {
      noExtension();
      desktop.hang = true;
      const w = new ZeroXIOWallet({ appName: 'Test' });
      await w.initialize();
      const progress: any[] = [];
      w.on('connectProgress', (e) => progress.push(e.data));
      const started = Date.now();
      const p = w.connect().catch((e) => e);
      await tick(20);
      expect(progress).toEqual([{ phase: 'local-network-prompt' }]);
      perm.set('denied');
      const err = await p;
      expect(Date.now() - started).toBeLessThan(2_000);
      expect(err).toMatchObject({ code: ErrorCode.EXTENSION_NOT_FOUND, details: { desktop: 'blocked' } });
      w.cleanup();
    } finally {
      perm.restore();
    }
  });

  it('ends at once with not-running when the socket is refused', async () => {
    const perm = changingPermission('prompt');
    try {
      noExtension();
      desktop.up = false;
      const w = new ZeroXIOWallet({ appName: 'Test' });
      await w.initialize();
      expect(await w.connect().catch((e) => e)).toMatchObject({ code: ErrorCode.EXTENSION_NOT_FOUND, details: { desktop: 'not-running' } });
      w.cleanup();
    } finally {
      perm.restore();
    }
  });

  it('initialize() says blocked when access is denied', async () => {
    const perm = changingPermission('denied');
    try {
      noExtension();
      const w = new ZeroXIOWallet({ appName: 'Test' });
      await expect(w.initialize()).rejects.toMatchObject({ details: { desktop: 'blocked' } });
      w.cleanup();
    } finally {
      perm.restore();
    }
  });
});
