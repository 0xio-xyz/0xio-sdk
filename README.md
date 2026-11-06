# 0xio Wallet SDK

**Version 2.12.0**

The official TypeScript SDK for building dapps on the 0xio Wallet and the Octra Network. It works with the browser extension, with 0xio Desktop alone (no extension), inside the 0xio Desktop browser and inside the 0xio App, and picks the right transport on its own.

What changed in each release is in [CHANGELOG.md](CHANGELOG.md). The full API is in [DOCUMENTATION.md](DOCUMENTATION.md).

## Install

```bash
npm install @0xio/sdk
```

## Quick start

```typescript
import { ZeroXIOWallet } from '@0xio/sdk';

const wallet = new ZeroXIOWallet({
  appName: 'My DApp',
  requiredPermissions: ['accounts', 'public_transactions'],
});

await wallet.initialize();

// Connect. The wallet shows an approval the first time.
const connection = await wallet.connect();
console.log(connection.address);
console.log(connection.publicKey); // base64 Ed25519 key

// Balance, in OCT.
const balance = await wallet.getBalance();
console.log(balance.public, balance.private, balance.total);

// Sign a message. The wallet frames it (see Message signing below).
const signature = await wallet.signMessage('Hello, 0xio!');

// Send 10.5 OCT.
const result = await wallet.sendTransaction({
  to: 'oct1recipient...',
  amountOct: '10.5',
  message: 'Payment',
});
console.log(result.hash);
```

## Amounts and units

The wallet counts in raw micro-OCT: one OCT is 1000000 units. Every raw field is passed to the wallet exactly as you give it, so existing integrations keep working. Where you would rather write OCT, use the OCT field and the SDK converts it with exact decimal arithmetic.

| Method | Raw field (sent as is) | OCT field (converted by the SDK) |
|--------|------------------------|----------------------------------|
| `sendTransaction`, `signTransaction` | `amount` | `amountOct` |
| `callContract` | `amount` | `amountOct` |
| `sendPrivateTransfer` | `amountRaw` | `amount` |
| `getBalance` | | returns OCT |

Pass one field or the other, not both. A number that cannot be written in six decimals (such as `0.1 + 0.2`) is rejected; pass a string.

## Permissions

Ask for what the dapp uses. The wallet enforces these names:

| Scope | Grants |
|-------|--------|
| `accounts` | address, balance, public key |
| `public_transactions` | sends and message signing |
| `contract_calls` | state-changing contract calls |
| `contract_views` | read-only contract calls |
| `private_balance_read` | private balance, decrypting values, pending transfers |
| `private_proofs` | encrypting values, zero and range proofs |
| `private_transfers` | sending private transfers |
| `private_claims` | claiming private transfers |

The private scopes show a warning in the connection dialog. Older names such as `read_balance` or `stealth_claim` still work: the SDK translates them, and they come back in the granted list as aliases.

## API map

Connection: `initialize()`, `connect(options?)`, `disconnect()`, `isConnected()`, `getConnectionStatus()`, `getAddress()`, `getPublicKey()`, `canSign()` (2.10.0).

Balance and network: `getBalance(forceRefresh?)`, `getNetworkInfo()`, `getNetworkId()`, `switchNetwork(id)` (connected dapps only; the wallet asks the user first).

Transactions: `sendTransaction(data)`, `signTransaction(data)` then `submitTransaction(signedTx)`, `getTransactionHistory(page?, limit?)`.

Contracts: `callContract(data)` (signed, approval shown), `deployContract({ bytecode, params?, ou? })` (approval shows the code size, the contract address from the node and the fee; returns `{ txHash, contractAddress }`), `contractCallView(data)` (read-only, no approval), `getContractStorage(contract, key)`, `sendContractTransactionSequence(data)` (several calls under one approval; every step is listed in it).

Request lifecycle (2.12.0): `detect()`, `walletInfo`, `newRequestId()`, `requestStatus(id)`, `waitForRequest(id, options?)`, `cancelRequest(id)`, `pendingRequest()`, `openInAppUrl(url?)`; every review call takes `{ requestId, timeoutMs, onStatus }` and every write also `wait: 'submitted' | 'confirmed'`. See Request lifecycle below.

Messages: `signMessage(message)`, `signAuthMessage(service, nonce)`, and the verifiers `verifyMessage`, `getSignedMessageBytes`, `buildAuthMessage`.

Private: `sendPrivateTransfer(data)`, `getPendingPrivateTransfers()`, `claimPrivateTransfer(id)` (approval shown), `getPrivateBalanceInfo()`, `registerPrivateViewKey({ address })`.

Private primitives (2.8.0): `getPrivateCapabilities()`, `encryptValue()`, `decryptValue()`, `makeZeroProof()`, `makeRangeProof()`, `getPrivateBalance()`. Keys never leave the wallet; the dapp receives ciphertexts, proofs and hashes.

Passthrough: `request(method, params)` sends any wallet method; `rpcCall(method, params)` reaches the wallet's read-only node RPC allow-list, such as `octra_balance`.

`encryptBalance` and `decryptBalance` remain for other wallets; the 0xio extension answers `NOT_AVAILABLE`, and users encrypt from its Privacy screen.

## Watch-only wallets

A watch-only wallet connects and reads, but cannot sign. The connection, the `connect` event and `accountChanged` carry `canSign`, and `wallet.canSign()` returns it:

- `true`: the wallet signs.
- `false`: watch-only. Show a read-only state; every signing call fails with `WATCH_ONLY`.
- `undefined`: unknown (not connected, or an extension older than 3.0.3). A missing `publicKey` then hints at watch-only, and older extensions refuse signing with `PERMISSION_DENIED`.

```typescript
await wallet.connect();
const canSign = wallet.canSign() ?? !!wallet.getConnectionInfo().publicKey;
sendButton.disabled = !canSign;

wallet.on('accountChanged', (event) => {
  sendButton.disabled = event.data.canSign === false;
});
```

## Message signing

The wallet never signs a raw message. It signs a framed payload, so a signed message can never be a transaction (a transaction is JSON and starts with `{`):

```
"Octra Signed Message:\n" + utf8ByteLength(message) + "\n" + message
```

The signature is an Ed25519 detached signature over the UTF-8 bytes of that string. Verify it with the SDK:

```typescript
import { verifyMessage } from '@0xio/sdk';

const publicKey = await wallet.getPublicKey();
const ok = await verifyMessage(message, signature, publicKey);
```

Or with any Ed25519 library, over the exact bytes from `getSignedMessageBytes(message)`. For `signAuthMessage(service, nonce)`, rebuild the signed string with `buildAuthMessage(service, nonce, origin)` first.

## Events

```typescript
wallet.on('connect', (event) => console.log('Connected:', event.data.address));
wallet.on('disconnect', (event) => console.log('Disconnected:', event.data.reason));
wallet.on('accountChanged', (event) => console.log('Account:', event.data.newAddress));
wallet.on('balanceChanged', (event) => console.log('Balance:', event.data.newBalance.total));
wallet.on('networkChanged', (event) => console.log('Network:', event.data.newNetwork.name));
wallet.on('transactionConfirmed', (event) => console.log('Confirmed:', event.data.txHash));
wallet.on('transactionFailed', (event) => console.log('Failed:', event.data.error));
wallet.on('extensionLocked', () => console.log('Locked'));
wallet.on('requestUpdate', (event) => console.log(event.data.requestId, event.data.status));
wallet.on('connectProgress', (event) => console.log(event.data.phase)); // 'local-network-prompt'
```

`transactionConfirmed` keeps its meaning per wallet (accepted by the node in the extension and Desktop, final in the app). `requestUpdate` means the same everywhere.

## Errors

Every failure is a `ZeroXIOWalletError` with a `code`.

```typescript
import { ZeroXIOWalletError, ErrorCode } from '@0xio/sdk';

try {
  await wallet.sendTransaction({ to: 'oct1...', amountOct: '10' });
} catch (error) {
  if (error instanceof ZeroXIOWalletError) {
    switch (error.code) {
      case ErrorCode.NOT_CONNECTED:   // connect() first
      case ErrorCode.WALLET_LOCKED:   // the user has to unlock the wallet
      case ErrorCode.USER_REJECTED:   // the user declined the approval
      case ErrorCode.WATCH_ONLY:      // the wallet is watch-only and cannot sign
      case ErrorCode.INVALID_AMOUNT:  // bad unit or precision
      case ErrorCode.NONCE_TOO_FAR:   // node rejected the transaction
      case ErrorCode.NOT_AVAILABLE:   // 0xio Desktop: switch the desktop to the site's network
      case ErrorCode.WALLET_CHANGED:  // 0xio Desktop: open the wallet this site uses
        console.log(error.code, error.message);
        break;
      case ErrorCode.STATUS_UNKNOWN:  // the SDK stopped waiting; never resend, ask requestStatus(error.requestId)
      case ErrorCode.EXECUTION_FAILED: // wait: 'confirmed' and the chain rejected or dropped it
      case ErrorCode.REQUEST_ID_REUSED: // this id belongs to another request; make a new one
        console.log(error.code, error.requestId);
    }
  }
}
```

`deployContract` adds two codes: `DEPLOY_CHANGED` when another transaction moved the nonce after the review, so the contract address would differ (nothing is sent), and `DEPLOY_FAILED` when the node refuses the deploy.

The wallet refuses anything that signs, submits or changes state until the page has connected, and opens its unlock screen at most once a minute for a page that is not connected. While the wallet is locked, `getBalance` and the private balance reads return `WALLET_LOCKED` (extension 3.0.0 and newer).

Every error of a review call carries the request id in `error.requestId` and `error.details.requestId`. `RATE_LIMIT_EXCEEDED` says why in `details.reason`: `review_pending` (another review of this page is open; `details.requestId` names it), `requests_per_second` (more than 20 a second) or `open_requests` (8 requests of the site already wait in the wallet).

## Request lifecycle

Since 2.12.0 every call that opens a review carries a request id, and the site can follow it, find it again after a reload, and wait for the chain without its own RPC client. Wallets that speak protocol 2 keep the id's status for 24 hours; with older wallets the SDK keeps its own record for the page's lifetime.

```typescript
// Before any click: what is there, and what to show.
const found = await wallet.detect();
// found.next: 'connect' | 'install' | 'open-in-app'; found.openInAppUrl on phones without a wallet

// Store the id first, so a reload can find the request.
const requestId = wallet.newRequestId();
localStorage.setItem('deposit', requestId);

const result = await wallet.callContract(
  { contract: 'oct1pool...', method: 'deposit', params: [] },
  {
    requestId,
    wait: 'confirmed',
    onStatus: (s) => setLabel(s.status), // pending, locked, review_open, signing, submitted, confirmed
  }
);
console.log(result.requestStatus, result.epoch, result.receipt?.events);

// After a reload:
const status = await wallet.requestStatus(localStorage.getItem('deposit')!);
if (status.status === 'submitted') await wallet.waitForRequest(status.requestId);
```

- A timeout ends only the SDK's wait. The review stays open, the call rejects with `STATUS_UNKNOWN` and the id, and nothing is ever sent again. With a protocol 2 wallet the wait restarts on every status change, so a slow reader does not time out.
- Calling again with the same id never opens a second review: it joins the call in flight or returns the stored outcome. Another request under the same id fails with `REQUEST_ID_REUSED`.
- `wait: 'confirmed'` resolves when the chain executed the transaction, with `epoch` and, for contract calls and deploys, the `receipt` (`success`, `events`, `error`; Octra gives no return value, so a contract that needs to report one emits it as an event). `receipt` is `null` with `receiptUnavailable: 'refused'` when the wallet's node refuses receipts. A chain rejection or drop rejects with `EXECUTION_FAILED`. Protocol 2 wallets watch the chain; with older wallets the SDK reads `octra_transaction` through the wallet's `rpc_call` (every 4 s for a minute, then every 10 s, at most 10 minutes).
- Writes resolve with `requestId` and `requestStatus` (`submitted`, `confirmed`, or `completed` for a write that gives no hash). The wallet's own `status` field is left as it sent it.
- `wallet.walletInfo` tells which wallet answered: `kind` (`extension`, `desktop`, `app-expo`, `app-ios`, `app-android`), `version`, `protocol` and `capabilities`. `wallet.transport` stays the channel.
- `openInAppUrl(url?)` gives `https://0xio.xyz/open?url=...` (or `oxio://open?url=...` with `{ scheme: true }`) for an https page; put it on a button, the SDK never navigates.

## Networks

```typescript
import { getNetworkConfig } from '@0xio/sdk';

const devnet = getNetworkConfig('devnet');
console.log(devnet.rpcUrl);          // https://devnet.octrascan.io
console.log(devnet.isTestnet);       // true
```

| Network | RPC | Explorer | Privacy |
|---------|-----|----------|---------|
| Mainnet | `https://octra.network` | [octrascan.io](https://octrascan.io) | yes |
| Devnet | `https://devnet.octrascan.io` | [devnet.octrascan.io](https://devnet.octrascan.io) | yes |

`connect()` returns the wallet's active network in `networkInfo`; the SDK never assumes one.

## Where it runs

- **Browser extension.** The page talks to the extension over a private message channel that page scripts cannot read or forge.
- **0xio Desktop.** The dapp runs in an iframe and the SDK relays requests to the desktop wallet. Set `trustedParentOrigins` in production; localhost is trusted by default for development.
- **0xio App.** The dapp runs in a WebView and the SDK uses the app's bridge.
- **0xio Desktop without the extension.** When no extension answers, the SDK reaches the desktop wallet directly. See below.

No code changes are needed; the SDK detects the environment. `wallet.transport` says which one is in use after `initialize()`: `'extension'` (the extension or an app bridge) or `'desktop'`.

## Using 0xio Desktop without the extension

A visitor who has 0xio Desktop but not the extension can still use your site. `initialize()` first looks for the extension, and the extension always wins when it is there. It waits about 300 ms for one (`detectTimeoutMs`; 10 s inside a frame or the 0xio app). If none answers in that window:

- When the browser already allows this site to reach local apps, or does not have that permission at all (Firefox, Safari), `initialize()` opens `ws://127.0.0.1:19345` (800 ms to connect) and checks that 0xio Desktop answers. If that fails too, it rejects with `EXTENSION_NOT_FOUND` as before.
- When Chrome would have to ask first, `initialize()` opens nothing, so visitors without any wallet never see the prompt. It resolves `true` with `wallet.transport` still `null` and `wallet.desktopAvailableOnConnect` set to `true`. The next `connect()`, which follows a click, uses the extension if it has appeared since, else opens 0xio Desktop and waits for the visitor to answer the prompt. If no wallet answers, `connect()` rejects with `EXTENSION_NOT_FOUND` and the next `connect()` tries again.
- When the visitor has blocked local network access for the site, the SDK never opens the socket.

```typescript
const wallet = new ZeroXIOWallet({ appName: 'My DApp' });
await wallet.initialize();
if (wallet.transport === 'desktop') {
  // approvals happen in the 0xio Desktop menu bar
}
if (!wallet.isReady() && !wallet.desktopAvailableOnConnect) {
  // no wallet: show install links
}
// Keep the Connect button enabled while desktopAvailableOnConnect is true.

// Opt out: never reach for the desktop from this site.
new ZeroXIOWallet({ appName: 'My DApp', desktop: false });
```

What the visitor sees:

- **Chrome asks once, after Connect.** The first time, Chrome shows its local network permission prompt ("access other apps and services on this device") when the visitor clicks Connect, never on page load. The SDK emits `connectProgress` with `phase: 'local-network-prompt'` while it is open. A block ends the attempt at once (`EXTENSION_NOT_FOUND` with `details.desktop: 'blocked'`), so does a desktop that is not running (`'not-running'`); only an ignored prompt waits the full 20 seconds. `detect()` reports `desktop: 'unknown-until-connect'` until then: no page can learn more without the prompt.
- **Approvals in the menu bar.** Connect, signing, sending and network switches are reviewed in the 0xio Desktop menu bar, not in a popup. The SDK waits up to ten minutes for an answer and never retries a review.
- **One console line without the desktop.** Where the socket is opened and nothing listens, the console shows one failed WebSocket line. Set `desktop: false` if you do not want that.

When the SDK tries it:

- Only in a browser page that is a secure context (`https:`), or on plain `http:` for `localhost`, `127.0.0.1` and `[::1]` during development.
- Not with `desktop: false`, and not when you pass an adapter for another wallet.
- The page never sends its own name: the browser's Origin header tells the desktop which site is asking.
- The first approved `connect()` gives the page a site token, kept in the page's `localStorage` under `0xio:desktop-site-token`. On every new link the SDK shows it to the desktop, which restores the session only for that token; without it (cleared storage, a private window, SDK 2.11.0) the visitor approves `connect()` again. `disconnect()` forgets it.

How it differs from the extension:

- `getBalance()` returns `private: 0`; read private balances with `getPrivateBalance()`.
- `connect()` reports `wallet: "0xio-desktop"`.
- Private methods run only for the wallet open in the desktop and only while the desktop is on the site's network; otherwise they fail with `WALLET_CHANGED` or `NOT_AVAILABLE`, with a message that says what to switch.
- `getPendingPrivateTransfers()` fails with `UNSUPPORTED_METHOD`; use `getPrivateBalance({ include_claimable: true })` and `claimPrivateTransfer()`.
- A request can fail with `NETWORK_CHANGED` when the site's network or wallet moved while it waited for review.
- At most 3 requests from a site wait at once, and 60 a minute; beyond that `RATE_LIMIT_EXCEEDED`.

If the desktop quits or restarts, the SDK emits `disconnect` with reason `network_error` and fails requests in flight with `NETWORK_ERROR`. The next call opens the link again (after a short pause that grows when the desktop stays closed); call `getConnectionStatus()` to restore the session without a new review (the site token proves the page), or `connect()`.

## Wallet adapters

Transport is pluggable, so another wallet can be supported without touching the core.

```typescript
import { detectWalletAdapter, ZeroXIOWallet, OctraProviderAdapter } from '@0xio/sdk';

// Detect: the 0xio bridge first, then any RFC-O-1 provider on window.octra.
const adapter = detectWalletAdapter();
const wallet = new ZeroXIOWallet({ appName: 'My DApp', adapter });

// Or choose one explicitly.
const rfc = new ZeroXIOWallet({ appName: 'My DApp', adapter: OctraProviderAdapter });
```

The 0xio bridge carries every SDK method. The RFC-O-1 provider carries what the RFC names (`deployContract` maps to `octra_deployContract`), so `getBalance`, `getPublicKey`, `getTransactionHistory`, `getContractStorage`, `getPendingPrivateTransfers` and `rpcCall` have no equivalent there. The table in DOCUMENTATION.md lists coverage per method.

To add a wallet, copy `src/supports/template.ts`, fill in its constants and message mapping, register it in `src/supports/index.ts`, and export it from `src/index.ts` if it belongs in the public API.

## Timeouts

Approvals wait up to three minutes, `deployContract` and `switchNetwork` included. A private transfer waits up to ten, because the wallet builds proofs after the approval. Interactive methods are never retried, so a slow approval never produces a second popup. With 0xio Desktop directly, reviews and proofs wait up to ten minutes and reads one minute. `timeoutMs` on a call changes its wait. When a review call's wait ends it rejects with `STATUS_UNKNOWN`, not `NETWORK_ERROR`; `NETWORK_ERROR` means the link to the wallet failed, and then `details.status` is `'unknown'`.

## Requirements

- A protocol 2 wallet (extension 3.0.6, 0xio Desktop 0.6.2, 0xio App 1.3.5) for request status after a reload, status events, cross tab idempotency and wallet side confirmation; older wallets get the fallbacks above
- 0xio Wallet Extension 3.0.3 or newer for `canSign` and `WATCH_ONLY`
- 0xio Wallet Extension 3.0.0 or newer for `deployContract`
- 0xio Wallet Extension 2.5.5 or newer for the 2.8.0 private primitives and framed message signing; 2.4.0 or newer for private transfers and claims
- 0xio Desktop 1.0 or newer for the iframe bridge, 0xio App 1.0 or newer for the WebView bridge
- A 0xio Desktop release with direct site support for use without the extension (older desktops are simply not found)
- A current Chromium-based browser (Chrome, Edge, Brave) or Firefox

## License

MIT License. Copyright 2026 0xio Labs.
