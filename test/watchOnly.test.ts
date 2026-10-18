import { ZeroXIOWallet } from '../src/wallet';
import { ExtensionCommunicator } from '../src/communication';
import { ErrorCode, ZeroXIOWalletError } from '../src/types';
import type { AccountChangedEvent, ConnectEvent, ConnectionInfo } from '../src/types';
import { createErrorMessage, createLogger } from '../src/utils';
import { createOctraProviderAdapter } from '../src/supports/octra-provider';

const NETWORK = {
  id: 'mainnet',
  name: 'Mainnet',
  rpcUrl: 'https://octra.network',
  supportsPrivacy: true,
  color: '#000000',
  isTestnet: false,
};

const WATCH_ONLY = { code: 'WATCH_ONLY', message: 'This wallet is watch-only and cannot sign.' };

function wallet(answer: (method: string) => unknown, connected = false) {
  const w = Object.create(ZeroXIOWallet.prototype) as ZeroXIOWallet;
  const sendRequest = jest.fn(async (method: string) => {
    const a = answer(method);
    if (a instanceof Error) throw a;
    return a;
  });
  Object.assign(w as any, {
    communicator: { sendRequest },
    config: { appName: 'Test', requiredPermissions: ['read_balance'] },
    connectionInfo: connected ? { isConnected: true, address: 'octW' } : { isConnected: false },
    isInitialized: true,
    listeners: new Map(),
    _sessionVersion: 0,
    logger: createLogger('test', false),
  });
  return { w, sendRequest };
}

const events = (w: ZeroXIOWallet, type: 'connect' | 'accountChanged') => {
  const seen: any[] = [];
  w.on(type, (e) => seen.push(e.data));
  return seen;
};

describe('canSign', () => {
  it('reads false for a watch-only wallet on connect and on the connect event', async () => {
    const { w } = wallet(() => ({
      address: 'octW',
      canSign: false,
      networkInfo: NETWORK,
      permissions: ['accounts'],
    }));
    const seen = events(w, 'connect');
    const res: ConnectEvent = await w.connect();
    expect(res.canSign).toBe(false);
    expect(seen[0].canSign).toBe(false);
    expect(w.canSign()).toBe(false);
    const info: ConnectionInfo = w.getConnectionInfo();
    expect(info.canSign).toBe(false);
  });

  it('reads true for a wallet with a key', async () => {
    const { w } = wallet(() => ({ address: 'octA', canSign: true, networkInfo: NETWORK }));
    await w.connect();
    expect(w.canSign()).toBe(true);
  });

  it('reads undefined from an older extension that does not send it', async () => {
    const { w } = wallet(() => ({ address: 'octA', networkInfo: NETWORK }));
    const res = await w.connect();
    expect(res.canSign).toBeUndefined();
    expect(w.canSign()).toBeUndefined();
    expect(w.getConnectionInfo().publicKey).toBeUndefined();
  });

  it('ignores a value that is not a boolean', async () => {
    const { w } = wallet(() => ({ address: 'octA', canSign: 'no', networkInfo: NETWORK }));
    await w.connect();
    expect(w.canSign()).toBeUndefined();
  });

  it('is undefined while not connected', () => {
    const { w } = wallet(() => null);
    expect(w.canSign()).toBeUndefined();
  });

  it('comes from getConnectionStatus on a restored session', async () => {
    const { w } = wallet(() => ({
      isConnected: true,
      address: 'octW',
      canSign: false,
      networkInfo: NETWORK,
    }));
    const seen = events(w, 'connect');
    const info = await w.getConnectionStatus();
    expect(info.canSign).toBe(false);
    expect(seen[0].canSign).toBe(false);
    expect(w.canSign()).toBe(false);
  });

  it('follows accountChanged, and reads undefined from an older payload', () => {
    const { w } = wallet(() => null, true);
    (w as any).connectionInfo.canSign = true;
    const seen = events(w, 'accountChanged');
    (w as any).handleAccountChanged({ address: 'octW', publicKey: undefined, canSign: false });
    const first: AccountChangedEvent = seen[0];
    expect(first).toMatchObject({ previousAddress: 'octW', newAddress: 'octW', canSign: false });
    expect(w.canSign()).toBe(false);

    (w as any).handleAccountChanged({ address: 'octB', publicKey: 'pkB' });
    expect(seen[1].canSign).toBeUndefined();
    expect(w.canSign()).toBeUndefined();
  });
});

describe('WATCH_ONLY', () => {
  it('has its own code and message', () => {
    expect(ErrorCode.WATCH_ONLY).toBe('WATCH_ONLY');
    expect(createErrorMessage(ErrorCode.WATCH_ONLY)).toBe('This wallet is watch-only and cannot sign');
  });

  it('maps the bridge refusal into a ZeroXIOWalletError with that code', () => {
    const c = Object.create(ExtensionCommunicator.prototype) as ExtensionCommunicator;
    const reject = jest.fn();
    Object.assign(c as any, {
      logger: createLogger('test', false),
      pendingRequests: new Map([
        ['r1', { resolve: jest.fn(), reject, timeout: setTimeout(() => {}, 0), retryCount: 0 }],
      ]),
    });
    (c as any).handleExtensionResponse({ id: 'r1', success: false, error: WATCH_ONLY, timestamp: 0 });
    const err = reject.mock.calls[0][0];
    expect(err).toBeInstanceOf(ZeroXIOWalletError);
    expect(err.code).toBe(ErrorCode.WATCH_ONLY);
    expect(err.message).toBe(WATCH_ONLY.message);
  });

  const refused = () => new ZeroXIOWalletError(ErrorCode.WATCH_ONLY, WATCH_ONLY.message);

  it.each([
    ['signMessage', (w: ZeroXIOWallet) => w.signMessage('hello')],
    ['sendTransaction', (w: ZeroXIOWallet) => w.sendTransaction({ to: 'oct' + 'A'.repeat(44), amount: '1' })],
    ['sendPrivateTransfer', (w: ZeroXIOWallet) => w.sendPrivateTransfer({ to: 'oct' + 'A'.repeat(44), amount: '1' })],
    ['claimPrivateTransfer', (w: ZeroXIOWallet) => w.claimPrivateTransfer('t1')],
    ['getPendingPrivateTransfers', (w: ZeroXIOWallet) => w.getPendingPrivateTransfers()],
    ['getPublicKey', (w: ZeroXIOWallet) => w.getPublicKey()],
  ])('%s keeps the WATCH_ONLY code', async (_name, run) => {
    const { w } = wallet(() => refused(), true);
    await expect(run(w)).rejects.toMatchObject({ code: ErrorCode.WATCH_ONLY });
  });

  it('other failures keep their old wrapping', async () => {
    const { w } = wallet(() => new ZeroXIOWalletError(ErrorCode.NETWORK_ERROR, 'down'), true);
    await expect(w.claimPrivateTransfer('t1')).rejects.toMatchObject({
      code: ErrorCode.TRANSACTION_FAILED,
    });
  });
});

describe('RFC-O-1 adapter', () => {
  const withProvider = async (provider: Record<string, unknown>, run: () => Promise<void>) => {
    (globalThis as any).window = {
      octra: { isOctra: true, on: jest.fn(), removeListener: jest.fn(), ...provider },
    };
    try {
      await run();
    } finally {
      delete (globalThis as any).window;
    }
  };

  it('keeps WATCH_ONLY when the provider names it in the error data', () =>
    withProvider(
      {
        request: jest.fn(async () => {
          throw Object.assign(new Error(WATCH_ONLY.message), { code: 4100, data: WATCH_ONLY });
        }),
      },
      async () => {
        const adapter = createOctraProviderAdapter();
        const reply = new Promise<any>((resolve) => adapter.listen(resolve));
        adapter.postRequest({ id: 'r1', method: 'signMessage', params: { message: 'hi' } } as any);
        expect(await reply).toMatchObject({ success: false, error: { code: 'WATCH_ONLY' } });
      }
    ));

  it('reads a plain 4100 as PERMISSION_DENIED', () =>
    withProvider(
      {
        request: jest.fn(async () => {
          throw Object.assign(new Error('Unauthorized'), { code: 4100 });
        }),
      },
      async () => {
        const adapter = createOctraProviderAdapter();
        const reply = new Promise<any>((resolve) => adapter.listen(resolve));
        adapter.postRequest({ id: 'r1', method: 'signMessage', params: {} } as any);
        expect(await reply).toMatchObject({ error: { code: 'PERMISSION_DENIED' } });
      }
    ));

  it('passes the provider canSign on connect, and undefined when it has none', async () => {
    const request = jest.fn(async ({ method }: { method: string }) =>
      method === 'octra_requestAccounts' ? ['octW'] : method === 'octra_networkInfo' ? NETWORK : []
    );
    await withProvider({ request, canSign: false }, async () => {
      const adapter = createOctraProviderAdapter();
      const reply = new Promise<any>((resolve) => adapter.listen(resolve));
      adapter.postRequest({ id: 'r1', method: 'connect', params: {} } as any);
      expect((await reply).data).toMatchObject({ address: 'octW', canSign: false });
    });
    await withProvider({ request }, async () => {
      const adapter = createOctraProviderAdapter();
      const reply = new Promise<any>((resolve) => adapter.listen(resolve));
      adapter.postRequest({ id: 'r2', method: 'connect', params: {} } as any);
      expect((await reply).data.canSign).toBeUndefined();
    });
  });
});
