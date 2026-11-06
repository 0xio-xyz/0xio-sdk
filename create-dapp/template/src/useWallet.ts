import { useCallback, useEffect, useRef, useState } from 'react';
import { ErrorCode, ZeroXIOWallet, ZeroXIOWalletError, isFinalStatus } from '@0xio/sdk';
import type { BalanceChangedEvent, NetworkInfo, Permission, RequestStatus, WalletEvent } from '@0xio/sdk';

const APP_NAME = '__TITLE__';
const PERMISSIONS: Permission[] = ['accounts', 'public_transactions'];
const STORE = '__NAME__';

export type Phase = 'detecting' | 'install' | 'open-in-app' | 'disconnected' | 'connecting' | 'connected';

export interface Account {
  readonly address: string;
  readonly network: NetworkInfo;
  readonly canSign: boolean;
  readonly scope: string;
}

export interface ScopedRequest {
  readonly scope: string;
  readonly status: RequestStatus;
}

const pendingKey = (scope: string) => `${STORE}:send:${scope}`;

function readAccount(wallet: ZeroXIOWallet): Account | null {
  const info = wallet.getConnectionInfo();
  if (!info.isConnected || !info.address || !info.networkInfo) return null;
  return {
    address: info.address,
    network: info.networkInfo,
    canSign: wallet.canSign() ?? !!info.publicKey,
    scope: `${info.networkInfo.id}:${info.address}`,
  };
}

function isCode(error: unknown, ...codes: ErrorCode[]): error is ZeroXIOWalletError {
  return error instanceof ZeroXIOWalletError && codes.includes(error.code);
}

export function errorText(error: unknown): string {
  if (error instanceof ZeroXIOWalletError) {
    switch (error.code) {
      case ErrorCode.EXTENSION_NOT_FOUND:
        return 'No 0xio wallet found';
      case ErrorCode.WALLET_LOCKED:
        return 'Unlock the wallet and try again';
      case ErrorCode.INSUFFICIENT_BALANCE:
        return 'Not enough OCT';
      case ErrorCode.INVALID_ADDRESS:
        return 'Invalid recipient';
      case ErrorCode.INVALID_AMOUNT:
        return 'Invalid amount';
      case ErrorCode.RATE_LIMIT_EXCEEDED:
        return 'Finish the open review in the wallet first';
      case ErrorCode.WATCH_ONLY:
        return 'This wallet is watch-only';
      case ErrorCode.STATUS_UNKNOWN:
        return 'No answer from the wallet yet';
      case ErrorCode.NETWORK_CHANGED:
      case ErrorCode.WALLET_CHANGED:
        return 'The wallet moved to another account or network';
    }
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

export function useWallet() {
  const walletRef = useRef<ZeroXIOWallet | null>(null);
  const [phase, setPhase] = useState<Phase>('detecting');
  const [openInAppUrl, setOpenInAppUrl] = useState<string | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [request, setRequest] = useState<ScopedRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [following, setFollowing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshBalance = useCallback(async (wallet: ZeroXIOWallet, scope: string) => {
    setBalanceLoading(true);
    try {
      const balance = await wallet.getBalance(true);
      if (readAccount(wallet)?.scope !== scope) return;
      setBalances((prev) => ({ ...prev, [scope]: balance.public }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBalanceLoading(false);
    }
  }, []);

  const sync = useCallback(() => {
    const wallet = walletRef.current;
    if (!wallet) return;
    const next = readAccount(wallet);
    setAccount(next);
    setPhase(next ? 'connected' : 'disconnected');
    if (next) void refreshBalance(wallet, next.scope);
  }, [refreshBalance]);

  const follow = useCallback(async (wallet: ZeroXIOWallet, requestId: string, scope: string) => {
    setFollowing(true);
    try {
      const final = await wallet.waitForRequest(requestId, {
        onStatus: (status) => setRequest({ scope, status }),
      });
      setRequest({ scope, status: final });
      localStorage.removeItem(pendingKey(scope));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setFollowing(false);
    }
  }, []);

  const resume = useCallback(async (wallet: ZeroXIOWallet, scope: string) => {
    const stored = localStorage.getItem(pendingKey(scope));
    if (!stored) return;
    const status = await wallet.requestStatus(stored);
    setRequest({ scope, status });
    if (isFinalStatus(status.status) || status.status === 'unknown') {
      localStorage.removeItem(pendingKey(scope));
      return;
    }
    await follow(wallet, stored, scope);
  }, [follow]);

  useEffect(() => {
    const wallet = new ZeroXIOWallet({ appName: APP_NAME, requiredPermissions: PERMISSIONS });
    walletRef.current = wallet;
    let alive = true;

    const onBalance = (event: WalletEvent<BalanceChangedEvent>) => {
      const current = readAccount(wallet);
      if (!current || current.address !== event.data.address) return;
      setBalances((prev) => ({ ...prev, [current.scope]: event.data.newBalance.public }));
    };
    wallet.on('connect', sync);
    wallet.on('accountChanged', sync);
    wallet.on('networkChanged', sync);
    wallet.on('disconnect', sync);
    wallet.on('balanceChanged', onBalance);

    (async () => {
      const found = await wallet.detect();
      if (!alive) return;
      if (found.next !== 'connect') {
        setOpenInAppUrl(found.openInAppUrl);
        setPhase(found.next);
        return;
      }
      await wallet.initialize();
      if (wallet.transport) await wallet.getConnectionStatus();
      if (!alive) return;
      sync();
      const current = readAccount(wallet);
      if (current) await resume(wallet, current.scope);
    })().catch((e: unknown) => {
      if (!alive) return;
      if (isCode(e, ErrorCode.EXTENSION_NOT_FOUND)) {
        setPhase('install');
      } else {
        setPhase('disconnected');
        setError(errorText(e));
      }
    });

    return () => {
      alive = false;
      wallet.off('connect', sync);
      wallet.off('accountChanged', sync);
      wallet.off('networkChanged', sync);
      wallet.off('disconnect', sync);
      wallet.off('balanceChanged', onBalance);
      wallet.cleanup();
      if (walletRef.current === wallet) walletRef.current = null;
    };
  }, [sync, resume]);

  const connect = useCallback(async () => {
    const wallet = walletRef.current;
    if (!wallet) return;
    setError(null);
    setPhase('connecting');
    try {
      await wallet.connect();
    } catch (e) {
      if (isCode(e, ErrorCode.EXTENSION_NOT_FOUND)) {
        setPhase('install');
        return;
      }
      setPhase('disconnected');
      if (!isCode(e, ErrorCode.USER_REJECTED)) setError(errorText(e));
    }
  }, [sync]);

  const disconnect = useCallback(async () => {
    const wallet = walletRef.current;
    if (!wallet) return;
    setError(null);
    try {
      await wallet.disconnect();
    } catch (e) {
      setError(errorText(e));
    }
  }, []);

  const switchNetwork = useCallback(async (networkId: string) => {
    const wallet = walletRef.current;
    if (!wallet || wallet.getNetworkId() === networkId) return;
    setError(null);
    setBusy(true);
    try {
      await wallet.switchNetwork(networkId);
      sync();
    } catch (e) {
      if (!isCode(e, ErrorCode.USER_REJECTED)) setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }, [sync]);

  const send = useCallback(async (to: string, amountOct: string) => {
    const wallet = walletRef.current;
    if (!wallet || !account) return;
    const scope = account.scope;
    const requestId = wallet.newRequestId();
    localStorage.setItem(pendingKey(scope), requestId);
    setError(null);
    setBusy(true);
    try {
      if (readAccount(wallet)?.scope !== scope) {
        throw new Error('The wallet moved to another account or network');
      }
      await wallet.sendTransaction(
        { to, amountOct },
        { requestId, wait: 'confirmed', onStatus: (status) => setRequest({ scope, status }) }
      );
      localStorage.removeItem(pendingKey(scope));
    } catch (e) {
      if (isCode(e, ErrorCode.STATUS_UNKNOWN, ErrorCode.NETWORK_ERROR)) {
        setBusy(false);
        await follow(wallet, requestId, scope);
        return;
      }
      localStorage.removeItem(pendingKey(scope));
      if (isCode(e, ErrorCode.UNSUPPORTED_METHOD) && e.details?.hash) return;
      if (!isCode(e, ErrorCode.USER_REJECTED)) setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }, [account, follow]);

  return {
    phase,
    openInAppUrl,
    account,
    balance: account ? balances[account.scope] : undefined,
    balanceLoading,
    request: request && account && request.scope === account.scope ? request.status : null,
    busy: busy || following,
    error,
    connect,
    disconnect,
    switchNetwork,
    send,
  };
}
