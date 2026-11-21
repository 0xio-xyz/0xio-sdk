import { ZeroXIOWallet } from '../src/wallet';
import { createLogger, deriveOctraAddress, isRawMicroAmount, isValidAmount } from '../src/utils';

const NETWORK = {
  id: 'mainnet',
  name: 'Mainnet',
  rpcUrl: 'https://octra.network',
  supportsPrivacy: true,
  color: '#000000',
  isTestnet: false,
};
const A = 'oct' + 'A'.repeat(44);
const PK = Buffer.alloc(32, 7).toString('base64');
const OTHER_PK = Buffer.alloc(32, 9).toString('base64');

function wallet(answer: (method: string) => unknown, connected = false) {
  const w = Object.create(ZeroXIOWallet.prototype) as ZeroXIOWallet;
  const sendRequest = jest.fn(async (method: string) => answer(method));
  Object.assign(w as any, {
    communicator: { sendRequest },
    config: { appName: 'Test', requiredPermissions: ['read_balance'] },
    connectionInfo: connected
      ? { isConnected: true, address: A, permissions: ['read_balance', 'send_transactions'] }
      : { isConnected: false },
    isInitialized: true,
    listeners: new Map(),
    _sessionVersion: 0,
    logger: createLogger('test', false),
  });
  return { w, sendRequest };
}

const settle = async (done: () => boolean) => {
  for (let i = 0; i < 50 && !done(); i++) await new Promise((r) => setTimeout(r, 5));
};

describe('amount formats', () => {
  it('accepts plain decimals only', () => {
    for (const ok of ['1', '10.5', '0.000001']) expect(isValidAmount(ok)).toBe(true);
    for (const bad of ['10abc', '10.5.2', '1e3', '0x10', ' 10', '-1', '', '0', '.5']) {
      expect(isValidAmount(bad)).toBe(false);
    }
  });

  it('takes raw micro-OCT as whole units', () => {
    for (const ok of ['1', '1000000', 5]) expect(isRawMicroAmount(ok)).toBe(true);
    for (const bad of ['10abc', '1.5', '1e3', '0', 0, 1.5, -1, null, undefined]) {
      expect(isRawMicroAmount(bad)).toBe(false);
    }
    expect(isRawMicroAmount('0', true)).toBe(true);
  });

  it.each([
    ['sendTransaction', (w: ZeroXIOWallet) => w.sendTransaction({ to: A, amount: '10abc' })],
    ['sendTransaction', (w: ZeroXIOWallet) => w.sendTransaction({ to: A, amount: '1e3' })],
    ['signTransaction', (w: ZeroXIOWallet) => w.signTransaction({ to: A, amount: '1.5' })],
    [
      'callContract',
      (w: ZeroXIOWallet) => w.callContract({ contract: A, method: 'deposit', params: [], amount: '10.5.2' }),
    ],
    ['encryptBalance', (w: ZeroXIOWallet) => w.encryptBalance('1e3')],
    ['decryptBalance', (w: ZeroXIOWallet) => w.decryptBalance('10abc')],
    ['sendPrivateTransfer', (w: ZeroXIOWallet) => w.sendPrivateTransfer({ to: A, amount: '10abc' })],
  ])('%s refuses a malformed amount before asking the wallet', async (_name, run) => {
    const { w, sendRequest } = wallet(() => ({}), true);
    await expect(run(w)).rejects.toMatchObject({ name: 'ZeroXIOWalletError' });
    expect(sendRequest).not.toHaveBeenCalled();
  });
});

describe('balance from the wallet', () => {
  it('getBalance refuses a malformed balance', async () => {
    const { w } = wallet(() => ({ balance: '10abc', privateBalance: '5xyz' }), true);
    await expect(w.getBalance()).rejects.toMatchObject({ name: 'ZeroXIOWalletError' });
  });

  it('getBalance reads plain numbers', async () => {
    const { w } = wallet(() => ({ balance: '10.5', privateBalance: '2' }), true);
    await expect(w.getBalance()).resolves.toMatchObject({ public: 10.5, private: 2, total: 12.5 });
  });

  it('connect never stores a raw balance', async () => {
    const { w } = wallet(() => ({ address: A, balance: '10abc', networkInfo: NETWORK }));
    const res = await w.connect();
    expect(res.balance).toEqual({ public: 0, private: 0, total: 0, currency: 'OCT' });
  });
});

describe('connected address', () => {
  it('connect refuses an address that is not an Octra address', async () => {
    const { w } = wallet(() => ({ address: 'not-an-octra-address', networkInfo: NETWORK }));
    await expect(w.connect()).rejects.toMatchObject({ code: 'INVALID_ADDRESS' });
    expect(w.isConnected()).toBe(false);
  });

  it('connect refuses a malformed public key and a key that is not the address', async () => {
    const bound = await deriveOctraAddress(PK);
    for (const publicKey of ['!!!not-base64!!!', OTHER_PK, '']) {
      const { w } = wallet(() => ({ address: bound, publicKey, networkInfo: NETWORK }));
      await expect(w.connect()).rejects.toMatchObject({ name: 'ZeroXIOWalletError' });
      expect(w.isConnected()).toBe(false);
    }
    const { w } = wallet(() => ({ address: bound, publicKey: PK, networkInfo: NETWORK }));
    await expect(w.connect()).resolves.toMatchObject({ address: bound });
  });

  it('a restored session with a bad address or key reads as not connected', async () => {
    const bound = await deriveOctraAddress(PK);
    for (const answer of [
      { isConnected: true, address: 'not-an-octra-address', networkInfo: NETWORK },
      { isConnected: true, address: bound, publicKey: '!!!not-base64!!!', networkInfo: NETWORK },
      { isConnected: true, address: bound, publicKey: OTHER_PK, networkInfo: NETWORK },
    ]) {
      const { w } = wallet(() => answer);
      expect((await w.getConnectionStatus()).isConnected).toBe(false);
    }
  });

  it('accountChanged is ignored for a bad address or a key that is not the address', async () => {
    const bound = await deriveOctraAddress(PK);
    const { w } = wallet(() => null, true);
    const seen: unknown[] = [];
    w.on('accountChanged', (e) => seen.push(e.data));

    (w as any).handleAccountChanged({ address: 'not-an-octra-address' });
    (w as any).handleAccountChanged({ address: bound, publicKey: OTHER_PK });
    (w as any).handleAccountChanged({ address: bound, publicKey: '!!!not-base64!!!' });
    await new Promise((r) => setTimeout(r, 60));
    expect(seen).toEqual([]);
    expect(w.getAddress()).toBe(A);

    (w as any).handleAccountChanged({ address: bound, publicKey: PK });
    await settle(() => seen.length === 1);
    expect(w.getAddress()).toBe(bound);
  });
});
