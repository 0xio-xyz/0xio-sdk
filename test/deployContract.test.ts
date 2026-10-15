import { ZeroXIOWallet } from '../src/wallet';
import { ErrorCode, ZeroXIOWalletError } from '../src/types';
import { createLogger } from '../src/utils';
import { createOctraProviderAdapter } from '../src/supports/octra-provider';

const CODE = Buffer.from('contract code bytes').toString('base64');

function connectedWallet(answer: unknown = { txHash: 'h1', contractAddress: 'octC', success: true }) {
  const wallet = Object.create(ZeroXIOWallet.prototype) as ZeroXIOWallet;
  const sendRequest = jest.fn(async () => answer);
  Object.assign(wallet as any, {
    communicator: { sendRequest },
    connectionInfo: { isConnected: true },
    isInitialized: true,
    logger: createLogger('test', false),
  });
  return { wallet, sendRequest };
}

describe('deployContract', () => {
  it('sends deploy_contract with the bytecode, params and fee', async () => {
    const { wallet, sendRequest } = connectedWallet();
    const res = await wallet.deployContract({ bytecode: CODE, params: ['Token', 18], ou: 250000 });
    expect(sendRequest).toHaveBeenCalledWith('deploy_contract', {
      bytecode: CODE,
      params: '["Token",18]',
      ou: '250000',
    });
    expect(res).toEqual({ txHash: 'h1', contractAddress: 'octC' });
  });

  it('leaves params and fee out when not given, so the wallet sets the live fee', async () => {
    const { wallet, sendRequest } = connectedWallet();
    await wallet.deployContract({ bytecode: CODE });
    expect(sendRequest).toHaveBeenCalledWith('deploy_contract', { bytecode: CODE });
  });

  it('passes a JSON string of params through unchanged', async () => {
    const { wallet, sendRequest } = connectedWallet();
    await wallet.deployContract({ bytecode: CODE, params: '["a", 1]' });
    expect(sendRequest).toHaveBeenCalledWith('deploy_contract', { bytecode: CODE, params: '["a", 1]' });
  });

  it.each([[''], ['abc'], ['ab!='], ['AAAA'.repeat(174763)]])('refuses bytecode %#', async (bytecode) => {
    const { wallet, sendRequest } = connectedWallet();
    await expect(wallet.deployContract({ bytecode })).rejects.toMatchObject({
      code: ErrorCode.INVALID_PARAMS,
    });
    expect(sendRequest).not.toHaveBeenCalled();
  });

  it.each([[0], ['-1'], ['1.5'], [50_000_001], ['abc']])('refuses fee %p', async (ou) => {
    const { wallet, sendRequest } = connectedWallet();
    await expect(wallet.deployContract({ bytecode: CODE, ou })).rejects.toBeInstanceOf(
      ZeroXIOWalletError
    );
    expect(sendRequest).not.toHaveBeenCalled();
  });

  it('needs a connected wallet', async () => {
    const { wallet, sendRequest } = connectedWallet();
    (wallet as any).connectionInfo = { isConnected: false };
    await expect(wallet.deployContract({ bytecode: CODE })).rejects.toMatchObject({
      code: ErrorCode.CONNECTION_REFUSED,
    });
    expect(sendRequest).not.toHaveBeenCalled();
  });
});

describe('RFC-O-1 adapter', () => {
  it('maps deploy_contract to octra_deployContract', async () => {
    const request = jest.fn(async () => ({ txHash: 'h1', contractAddress: 'octC' }));
    (globalThis as any).window = {
      octra: { isOctra: true, request, on: jest.fn(), removeListener: jest.fn() },
    };
    try {
      const adapter = createOctraProviderAdapter();
      const reply = new Promise<any>((resolve) => adapter.listen(resolve));
      adapter.postRequest({ id: 'r1', method: 'deploy_contract', params: { bytecode: CODE } } as any);
      expect(await reply).toMatchObject({ requestId: 'r1', success: true });
      expect(request).toHaveBeenCalledWith({
        method: 'octra_deployContract',
        params: { bytecode: CODE },
      });
    } finally {
      delete (globalThis as any).window;
    }
  });
});
