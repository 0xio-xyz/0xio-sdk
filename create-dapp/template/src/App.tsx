import { useState } from 'react';
import type { FormEvent } from 'react';
import { isValidAddress } from '@0xio/sdk';
import type { RequestStatusValue } from '@0xio/sdk';
import { useWallet } from './useWallet';

const INSTALL_URL = 'https://chromewebstore.google.com/detail/0xio-wallet/anknhjilldkeelailocijnfibefmepcc';
const NETWORKS = [
  { id: 'mainnet', label: 'Mainnet' },
  { id: 'devnet', label: 'Devnet' },
];
const AMOUNT = /^\d+(\.\d{1,6})?$/;

const STATUS_TEXT: Record<RequestStatusValue, string> = {
  pending: 'Waiting for the wallet',
  locked: 'Unlock the wallet',
  review_open: 'Review in the wallet',
  signing: 'Signing',
  submitted: 'Submitted',
  confirmed: 'Sent',
  completed: 'Sent',
  failed: 'Failed',
  rejected: 'Rejected',
  expired: 'Review expired',
  unknown: "Unknown. Check the wallet's activity",
};

function shortAddress(address: string): string {
  return address.length > 20 ? `${address.slice(0, 10)}...${address.slice(-8)}` : address;
}

function formatBalance(value: number | undefined): string {
  return value === undefined ? '0' : value.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

export function App() {
  const wallet = useWallet();
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const { account, request } = wallet;

  const canSend = isValidAddress(to.trim()) && AMOUNT.test(amount.trim()) && Number(amount) > 0 && !wallet.busy;

  const onSend = (event: FormEvent) => {
    event.preventDefault();
    if (canSend) void wallet.send(to.trim(), amount.trim());
  };

  return (
    <main className="app">
      <h1>__TITLE__</h1>

      {wallet.phase === 'install' && (
        <a className="button" href={INSTALL_URL} target="_blank" rel="noreferrer">
          Install 0xio Wallet
        </a>
      )}

      {wallet.phase === 'open-in-app' && wallet.openInAppUrl && (
        <a className="button" href={wallet.openInAppUrl}>
          Open in 0xio
        </a>
      )}

      {(wallet.phase === 'detecting' || wallet.phase === 'disconnected' || wallet.phase === 'connecting') && (
        <button className="button" onClick={wallet.connect} disabled={wallet.phase !== 'disconnected'}>
          Connect
        </button>
      )}

      {account && (
        <>
          <section className="card">
            <div className="row">
              <span className="label">Address</span>
              <span className="mono" title={account.address}>{shortAddress(account.address)}</span>
            </div>
            <div className="row">
              <span className="label">Balance</span>
              <span className={wallet.balanceLoading ? 'value dim' : 'value'}>
                {formatBalance(wallet.balance)} OCT
              </span>
            </div>
            <div className="row">
              <span className="label">Network</span>
              <div className="segmented">
                {NETWORKS.map((n) => (
                  <button
                    key={n.id}
                    className={account.network.id === n.id ? 'selected' : ''}
                    onClick={() => wallet.switchNetwork(n.id)}
                    disabled={wallet.busy}
                  >
                    {n.label}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {account.canSign ? (
            <form className="card" onSubmit={onSend}>
              <input
                className="field mono"
                placeholder="Recipient"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                spellCheck={false}
                autoComplete="off"
              />
              <input
                className="field"
                placeholder="Amount in OCT"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                autoComplete="off"
              />
              <button className="button" type="submit" disabled={!canSend}>
                Send
              </button>
            </form>
          ) : (
            <section className="card">
              <span className="label">Watch-only</span>
            </section>
          )}

          <p className="line">
            {request && STATUS_TEXT[request.status]}
            {request?.hash && account.network.explorerUrl && (
              <a href={`${account.network.explorerUrl}${request.hash}`} target="_blank" rel="noreferrer">
                View
              </a>
            )}
          </p>
        </>
      )}

      <p className="line error">{wallet.error}</p>

      {account && (
        <button className="button quiet" onClick={wallet.disconnect}>
          Disconnect
        </button>
      )}
    </main>
  );
}
