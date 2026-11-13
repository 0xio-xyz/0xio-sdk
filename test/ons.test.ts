import { ZeroXIOWallet } from '../src/wallet';
import { ErrorCode } from '../src/types';
import { createLogger } from '../src/utils';
import {
  ONS_LIST_URL,
  forgetNameList,
  isOnsName,
  normalizeOnsName,
  onsContract,
  parseNameList,
} from '../src/supports/ons';

const ONS = 'oct91H1swTpzRnN91cW5EdMtcBBL4mPQADsKZcNWihowjLN';
const ME = 'oct2qyupyPfAof4kJ8LcTdN7fyQkLxiKhfemLCz94NNoxio';
const CIRCLE = 'octnKTk3f1wRkC8Q4qa8gzouwcPkd3gW8DQAMbGobpyEu6n';
const envelope = (method: string, result: unknown) => ({ contract: ONS, method, result, stale: false });
const INFO = `Octra Name System|ONS|2|${CIRCLE}|6`;
const entry = (over: Record<string, unknown> = {}) => ({
  network: 'devnet',
  address: ONS,
  name: 'Octra Name System',
  symbol: 'ONS',
  suffix: '.oct',
  ...over,
});
const list = { services: [entry()] };

function serve(body: unknown, ok = true) {
  const fetched = jest.fn(async (_url: string, _init?: unknown) => ({ ok, json: async () => body }));
  (globalThis as any).fetch = fetched;
  return fetched;
}

beforeEach(() => {
  forgetNameList();
  serve(list);
});
afterEach(() => jest.useRealTimers());

const info = { reply: INFO as unknown };

function wallet(answer: (params: any) => unknown, networkId: string | null = 'devnet') {
  info.reply = INFO;
  const w = Object.create(ZeroXIOWallet.prototype) as ZeroXIOWallet;
  const sendRequest = jest.fn(async (_method: string, params: any) =>
    params.method === 'get_contract_info' ? envelope('get_contract_info', info.reply) : answer(params),
  );
  Object.assign(w as any, {
    communicator: { sendRequest },
    config: { appName: 'Test', requiredPermissions: ['read_balance'] },
    connectionInfo: networkId
      ? { isConnected: true, address: ME, networkInfo: { id: networkId } }
      : { isConnected: false },
    isInitialized: true,
    listeners: new Map(),
    _sessionVersion: 0,
    logger: createLogger('test', false),
  });
  return { w, sendRequest };
}

describe('name rules', () => {
  it('reads the bare name from a name with or without the ending', () => {
    expect(normalizeOnsName('0xio.oct')).toBe('0xio');
    expect(normalizeOnsName('  0XIO.OCT ')).toBe('0xio');
    expect(normalizeOnsName('a')).toBe('a');
    expect(normalizeOnsName('a-b')).toBe('a-b');
    expect(normalizeOnsName('a'.repeat(32))).toBe('a'.repeat(32));
  });

  it('refuses anything outside the rules', () => {
    for (const bad of ['', '.oct', '-a', 'a-', 'a'.repeat(33), 'a b', 'a_b', 'ａ', 'K', 'a.b.oct']) {
      expect(normalizeOnsName(bad)).toBeNull();
    }
  });

  it('treats text as a name only when it ends in .oct', () => {
    expect(isOnsName('0xio.oct')).toBe(true);
    expect(isOnsName('0xio')).toBe(false);
    expect(isOnsName(ME)).toBe(false);
  });

});

describe('lookupAddress', () => {
  it('gives the primary name of the connected address', async () => {
    const { w, sendRequest } = wallet(() => envelope('primary_of', '0xio'));
    expect(await w.lookupAddress()).toBe('0xio.oct');
    expect(sendRequest).toHaveBeenLastCalledWith('contract_call_view', {
      contract: ONS,
      method: 'primary_of',
      params: [ME],
      caller: ME,
    });
  });

  it('reads the node shape and a bare text as well as the wallet envelope', async () => {
    expect(await wallet(() => envelope('primary_of', { result: '0xio' })).w.lookupAddress()).toBe('0xio.oct');
    expect(await wallet(() => '0xio').w.lookupAddress()).toBe('0xio.oct');
  });

  it('gives null when the address has no primary name', async () => {
    expect(await wallet(() => envelope('primary_of', '')).w.lookupAddress()).toBeNull();
  });

  it('gives null and asks nothing on a network with no name service', async () => {
    const { w, sendRequest } = wallet(() => envelope('primary_of', '0xio'), 'mainnet');
    expect(await w.lookupAddress()).toBeNull();
    expect(sendRequest).not.toHaveBeenCalled();
  });

  it('looks up another address on a named network without a connection', async () => {
    const { w, sendRequest } = wallet(() => envelope('primary_of', 'ons'), null);
    expect(await w.lookupAddress(CIRCLE, 'devnet')).toBe('ons.oct');
    expect(sendRequest.mock.calls[1][1].params).toEqual([CIRCLE]);
  });

  it('refuses a reply that is not a name', async () => {
    for (const bad of ['0xio.oct', 'Not A Name', '<b>x</b>', { result: 7 }, null]) {
      await expect(wallet(() => envelope('primary_of', bad)).w.lookupAddress()).rejects.toMatchObject({
        code: ErrorCode.NETWORK_ERROR,
      });
    }
  });

  it('refuses a bad address before asking', async () => {
    const { w, sendRequest } = wallet(() => envelope('primary_of', '0xio'));
    await expect(w.lookupAddress('oct123')).rejects.toMatchObject({ code: ErrorCode.INVALID_ADDRESS });
    await expect(wallet(() => '', null).w.lookupAddress()).rejects.toMatchObject({ code: ErrorCode.INVALID_ADDRESS });
    expect(sendRequest).not.toHaveBeenCalled();
  });
});

describe('resolveName', () => {
  it('resolves a wallet name to its address', async () => {
    const { w, sendRequest } = wallet(() => envelope('resolve', `2|${ME}`));
    expect(await w.resolveName('0xio.oct')).toEqual({ name: '0xio.oct', kind: 'wallet', wallet: ME, circle: null });
    expect(sendRequest.mock.calls[1][1]).toMatchObject({ contract: ONS, method: 'resolve', params: ['0xio'] });
  });

  it('resolves a Circle name and a name that points at nothing', async () => {
    expect(await wallet(() => envelope('resolve', `1|${CIRCLE}`)).w.resolveName('ONS.oct')).toEqual({
      name: 'ons.oct',
      kind: 'circle',
      wallet: null,
      circle: CIRCLE,
    });
    expect(await wallet(() => envelope('resolve', '0|')).w.resolveName('0xio')).toEqual({
      name: '0xio.oct',
      kind: 'none',
      wallet: null,
      circle: null,
    });
  });

  it('gives null on a network with no name service', async () => {
    expect(await wallet(() => envelope('resolve', `2|${ME}`), 'mainnet').w.resolveName('0xio.oct')).toBeNull();
  });

  it('refuses a reply it cannot read, never guessing an address', async () => {
    for (const bad of ['', '2|', '2|oct123', `3|${ME}`, `2|${ME}|x`, ME, `0|${ME}`, { result: null }]) {
      await expect(wallet(() => envelope('resolve', bad)).w.resolveName('0xio.oct')).rejects.toMatchObject({
        code: ErrorCode.NETWORK_ERROR,
      });
    }
  });

  it('refuses text that is not a name before asking', async () => {
    const { w, sendRequest } = wallet(() => envelope('resolve', `2|${ME}`));
    await expect(w.resolveName('not a name')).rejects.toMatchObject({ code: ErrorCode.INVALID_PARAMS });
    expect(sendRequest).not.toHaveBeenCalled();
  });
});

describe('name service list', () => {
  it('reads one contract per network from the list', () => {
    expect(parseNameList(list)).toEqual({ devnet: ONS });
    expect(parseNameList({ services: [entry(), entry({ network: 'mainnet', address: CIRCLE })] })).toEqual({
      devnet: ONS,
      mainnet: CIRCLE,
    });
  });

  it('drops an entry it cannot trust and a network listed twice', () => {
    for (const bad of [
      entry({ address: 'oct123' }),
      entry({ address: 7 }),
      entry({ suffix: '.eth' }),
      entry({ network: '__proto__' }),
      entry({ network: 'Dev Net' }),
      null,
      'devnet',
    ]) {
      expect(parseNameList({ services: [bad] })).toEqual({});
    }
    expect(parseNameList({ services: [entry(), entry({ address: CIRCLE })] })).toEqual({});
    expect(parseNameList({ services: [entry(), entry({ address: CIRCLE }), entry()] })).toEqual({});
    expect(parseNameList({ services: [entry({ address: 'oct123' }), entry()] })).toEqual({});
    expect(() => parseNameList({})).toThrow();
    expect(() => parseNameList(null)).toThrow();
  });

  it('fetches the fixed list once and keeps it for ten minutes', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    const fetched = serve(list);
    expect(await onsContract('devnet')).toBe(ONS);
    expect(await onsContract('mainnet')).toBeNull();
    expect(await onsContract('__proto__')).toBeNull();
    expect(fetched).toHaveBeenCalledTimes(1);
    expect(fetched.mock.calls[0][0]).toBe(ONS_LIST_URL);
    jest.setSystemTime(Date.now() + 10 * 60_000);
    serve({ services: [entry({ address: CIRCLE })] });
    expect(await onsContract('devnet')).toBe(CIRCLE);
  });

  it('keeps the last list when the source cannot be reached, and has nothing without one', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    serve(list, false);
    expect(await onsContract('devnet')).toBeNull();
    serve(list);
    expect(await onsContract('devnet')).toBe(ONS);
    jest.setSystemTime(Date.now() + 11 * 60_000);
    (globalThis as any).fetch = jest.fn(async () => {
      throw new Error('offline');
    });
    expect(await onsContract('devnet')).toBe(ONS);
    serve({ nope: true });
    expect(await onsContract('devnet')).toBe(ONS);
  });
});

describe('name service check on chain', () => {
  it('asks the contract what it is once, before the first read', async () => {
    const { w, sendRequest } = wallet(() => envelope('primary_of', '0xio'));
    await w.lookupAddress();
    await w.lookupAddress();
    expect(sendRequest.mock.calls.map((c) => c[1].method)).toEqual([
      'get_contract_info',
      'primary_of',
      'primary_of',
    ]);
  });

  it('gives nothing for a contract that is not the name service or speaks another version', async () => {
    for (const other of [
      `Octra Name System|ONS|2|${CIRCLE}|7`,
      `Octra Name System|ONS|2|${CIRCLE}`,
      `Other Names|ONS|2|${CIRCLE}|6`,
      `Octra Name System|XNS|2|${CIRCLE}|6`,
      '',
    ]) {
      const { w, sendRequest } = wallet(() => envelope('resolve', `2|${ME}`));
      info.reply = other;
      expect(await w.resolveName('0xio.oct')).toBeNull();
      expect(await w.lookupAddress()).toBeNull();
      expect(sendRequest.mock.calls.map((c) => c[1].method)).toEqual(['get_contract_info']);
    }
  });

  it('rejects, and asks again next time, when the check cannot be read', async () => {
    const { w } = wallet(() => envelope('primary_of', '0xio'));
    info.reply = { result: null };
    await expect(w.lookupAddress()).rejects.toMatchObject({ code: ErrorCode.NETWORK_ERROR });
    info.reply = INFO;
    expect(await w.lookupAddress()).toBe('0xio.oct');
  });
});
