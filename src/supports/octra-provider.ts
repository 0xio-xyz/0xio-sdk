/**
 * RFC-O-1 OctraProvider transport adapter.
 *
 * Targets any wallet that exposes `window.octra` per the RFC-O-1 specification:
 *   window.octra.isOctra === true
 *   window.octra.request({ method, params }) → Promise<unknown>
 *   window.octra.on(event, listener) / removeListener(event, listener)
 *
 * This adapter translates the SDK's internal method names into RFC-O-1 method
 * names and maps events back to the SDK event vocabulary.
 *
 * Non-standard SDK methods (ping, register_dapp, getTransactionHistory, etc.)
 * are passed through as-is; the wallet's request() handles or rejects them.
 */

import type { WalletTransportAdapter, AdapterRequest, AdapterIncomingMessage } from '../adapter';

/** SDK method → RFC-O-1 method name */
const SDK_TO_RFC: Record<string, string> = {
  get_network_info: 'octra_networkInfo',
  switch_network: 'octra_switchNetwork',
  signMessage: 'octra_signMessage',
  send_transaction: 'octra_sendTransaction',
  call_contract: 'octra_callContract',
  contract_call_view: 'octra_callContract',
  get_private_balance_info: 'octra_getEncryptedBalance',
  encrypt_balance: 'octra_encryptBalance',
  decrypt_balance: 'octra_decryptBalance',
  send_private_transfer: 'octra_sendPrivateTransfer',
  claim_private_transfer: 'octra_claimStealth',
};

/** RFC-O-1 error code → SDK ErrorCode string */
const RFC_TO_SDK_ERROR: Record<number, string> = {
  4001: 'USER_REJECTED',
  4100: 'PERMISSION_DENIED',
  4200: 'NETWORK_ERROR',
  4900: 'CONNECTION_REFUSED',
  4901: 'NETWORK_ERROR',
};

function getProvider(): any {
  return typeof window !== 'undefined' ? (window as any).octra : null;
}

function mapError(err: any): { code: string; message: string } {
  const code = RFC_TO_SDK_ERROR[err?.code] ?? 'UNKNOWN_ERROR';
  return { code, message: err?.message ?? 'Request failed' };
}

/**
 * Build a connect response compatible with what the SDK expects
 * ({ address, networkInfo, permissions, balance }) by making
 * three RFC-O-1 calls: octra_requestAccounts, octra_networkInfo, octra_permissions.
 */
async function rfcConnect(provider: any, params: unknown): Promise<unknown> {
  const requestPerms = (params as any)?.requestPermissions ?? [];
  const accounts = (await provider.request({
    method: 'octra_requestAccounts',
    params: [{ permissions: requestPerms }],
  })) as string[];

  const address = accounts?.[0] ?? null;

  const [networkInfo, permissions] = await Promise.all([
    provider.request({ method: 'octra_networkInfo' }),
    provider.request({ method: 'octra_permissions' }),
  ]);

  return { address, networkInfo, permissions, balance: null };
}

/**
 * Build a getConnectionStatus response by checking octra_accounts.
 */
async function rfcConnectionStatus(provider: any): Promise<unknown> {
  const accounts = (await provider.request({ method: 'octra_accounts' })) as string[];
  const address = accounts?.[0] ?? null;

  if (!address) return { isConnected: false };

  const [networkInfo, permissions] = await Promise.all([
    provider.request({ method: 'octra_networkInfo' }),
    provider.request({ method: 'octra_permissions' }),
  ]);

  return { isConnected: true, address, networkInfo, permissions };
}

export function createOctraProviderAdapter(): WalletTransportAdapter {
  let _handler: ((msg: AdapterIncomingMessage) => void) | null = null;
  const _eventCleanups: Array<() => void> = [];

  return {
    name: 'octra-provider',
    displayName: 'Octra Wallet (RFC-O-1)',

    detect(): boolean {
      const p = getProvider();
      return p?.isOctra === true;
    },

    postRequest(request: AdapterRequest): void {
      const { id, method, params } = request;
      const provider = getProvider();

      if (!provider) {
        _handler?.({
          requestId: id,
          success: false,
          error: { code: 'EXTENSION_NOT_FOUND', message: 'No RFC-O-1 provider found on window.octra' },
        });
        return;
      }

      (async () => {
        try {
          let data: unknown;

          if (method === 'ping') {
            data = { available: true };
          } else if (method === 'register_dapp') {
            data = { success: true };
          } else if (method === 'connect') {
            data = await rfcConnect(provider, params);
          } else if (method === 'disconnect') {
            await provider.request({ method: 'disconnect' }).catch(() => {});
            data = { success: true };
          } else if (method === 'getConnectionStatus') {
            data = await rfcConnectionStatus(provider);
          } else {
            const rfcMethod = SDK_TO_RFC[method] ?? method;
            data = await provider.request({ method: rfcMethod, params });
          }

          _handler?.({ requestId: id, success: true, data });
        } catch (err: any) {
          _handler?.({ requestId: id, success: false, error: mapError(err) });
        }
      })();
    },

    listen(
      handler: (msg: AdapterIncomingMessage) => void,
    ): () => void {
      _handler = handler;
      const provider = getProvider();
      if (!provider) return () => { _handler = null; };

      // RFC-O-1 event → SDK event name + data shape
      const onConnect = (data: any) =>
        handler({ eventType: 'connect', eventData: data });
      const onDisconnect = (data: any) =>
        handler({ eventType: 'disconnect', eventData: { reason: 'network_error', ...data } });
      const onAccountsChanged = (accounts: string[]) =>
        handler({ eventType: 'accountChanged', eventData: { address: accounts?.[0] ?? null } });
      const onNetworkChanged = (data: any) =>
        handler({ eventType: 'networkChanged', eventData: { networkInfo: data } });
      const onBalanceChanged = (data: any) =>
        handler({ eventType: 'balanceChanged', eventData: data });
      const onTransactionChanged = (data: any) =>
        handler({ eventType: 'transactionConfirmed', eventData: data });

      provider.on('connect', onConnect);
      provider.on('disconnect', onDisconnect);
      provider.on('accountsChanged', onAccountsChanged);
      provider.on('networkChanged', onNetworkChanged);
      provider.on('balanceChanged', onBalanceChanged);
      provider.on('transactionChanged', onTransactionChanged);

      const cleanup = () => {
        provider.removeListener('connect', onConnect);
        provider.removeListener('disconnect', onDisconnect);
        provider.removeListener('accountsChanged', onAccountsChanged);
        provider.removeListener('networkChanged', onNetworkChanged);
        provider.removeListener('balanceChanged', onBalanceChanged);
        provider.removeListener('transactionChanged', onTransactionChanged);
        _handler = null;
      };

      _eventCleanups.push(cleanup);
      return cleanup;
    },

    listenForReady(onReady: () => void): () => void {
      const handler = () => onReady();
      window.addEventListener('octraWalletReady', handler);
      return () => window.removeEventListener('octraWalletReady', handler);
    },
  };
}

/** Default RFC-O-1 adapter instance. */
export const OctraProviderAdapter = createOctraProviderAdapter();
