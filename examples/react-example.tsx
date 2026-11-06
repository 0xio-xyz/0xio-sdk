import { useEffect, useRef, useState } from 'react';
import { ErrorCode, ZeroXIOWallet, ZeroXIOWalletError } from '@0xio/sdk';
import type { RequestStatus } from '@0xio/sdk';

const POOL = 'oct1pool...';
const DEPOSIT_KEY = 'pool:deposit-request';

export function PoolDeposit() {
  const walletRef = useRef<ZeroXIOWallet | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [status, setStatus] = useState<RequestStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const wallet = new ZeroXIOWallet({ appName: 'Pool', requiredPermissions: ['accounts', 'contract_calls'] });
    walletRef.current = wallet;
    wallet.on('requestUpdate', (event) => setStatus(event.data));
    wallet.on('disconnect', () => setAddress(null));

    wallet
      .initialize()
      .then(async () => {
        const stored = localStorage.getItem(DEPOSIT_KEY);
        if (stored) setStatus(await wallet.requestStatus(stored));
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));

    return () => wallet.cleanup();
  }, []);

  const connect = async () => {
    const wallet = walletRef.current;
    if (!wallet) return;
    const found = await wallet.detect();
    if (found.next === 'open-in-app' && found.openInAppUrl) {
      window.location.href = found.openInAppUrl;
      return;
    }
    const connection = await wallet.connect();
    setAddress(connection.address);
  };

  const deposit = async () => {
    const wallet = walletRef.current;
    if (!wallet) return;
    setError(null);
    const requestId = wallet.newRequestId();
    localStorage.setItem(DEPOSIT_KEY, requestId);
    try {
      const result = await wallet.callContract(
        { contract: POOL, method: 'deposit', params: [], amountOct: '10' },
        { requestId, wait: 'confirmed', onStatus: setStatus }
      );
      const minted = result.receipt?.events.find((e) => e.event === 'SharesMinted');
      setError(minted ? null : 'Confirmed without a SharesMinted event');
    } catch (e) {
      if (e instanceof ZeroXIOWalletError && e.code === ErrorCode.STATUS_UNKNOWN) {
        setError('Still waiting on the wallet; this page follows the request.');
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
  };

  return (
    <div>
      {address ? <p>{address}</p> : <button onClick={connect}>Connect</button>}
      <button onClick={deposit} disabled={!address}>
        Deposit 10 OCT
      </button>
      {status && <p>{status.status}</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
