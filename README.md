# 0xio Wallet SDK

**Version 2.8.0**

The official TypeScript SDK for building dapps on the 0xio Wallet and the Octra Network. It works with the browser extension, inside the 0xio Desktop browser and inside the 0xio App, and picks the right transport on its own.

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

Connection: `initialize()`, `connect(options?)`, `disconnect()`, `isConnected()`, `getConnectionStatus()`, `getAddress()`, `getPublicKey()`.

Balance and network: `getBalance(forceRefresh?)`, `getNetworkInfo()`, `getNetworkId()`, `switchNetwork(id)` (connected dapps only; the wallet asks the user first).

Transactions: `sendTransaction(data)`, `signTransaction(data)` then `submitTransaction(signedTx)`, `getTransactionHistory(page?, limit?)`.

Contracts: `callContract(data)` (signed, approval shown), `contractCallView(data)` (read-only, no approval), `getContractStorage(contract, key)`, `sendContractTransactionSequence(data)` (several calls under one approval; every step is listed in it).

Messages: `signMessage(message)`, `signAuthMessage(service, nonce)`, and the verifiers `verifyMessage`, `getSignedMessageBytes`, `buildAuthMessage`.

Private: `sendPrivateTransfer(data)`, `getPendingPrivateTransfers()`, `claimPrivateTransfer(id)` (approval shown), `getPrivateBalanceInfo()`, `registerPrivateViewKey({ address })`.

Private primitives (2.8.0): `getPrivateCapabilities()`, `encryptValue()`, `decryptValue()`, `makeZeroProof()`, `makeRangeProof()`, `getPrivateBalance()`. Keys never leave the wallet; the dapp receives ciphertexts, proofs and hashes.

Passthrough: `request(method, params)` sends any wallet method; `rpcCall(method, params)` reaches the wallet's read-only node RPC allow-list, such as `octra_balance`.

`encryptBalance` and `decryptBalance` remain for other wallets; the 0xio extension answers `NOT_AVAILABLE`, and users encrypt from its Privacy screen.

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
```

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
      case ErrorCode.INVALID_AMOUNT:  // bad unit or precision
      case ErrorCode.NONCE_TOO_FAR:   // node rejected the transaction
        console.log(error.code, error.message);
    }
  }
}
```

The wallet refuses anything that signs, submits or changes state until the page has connected, and opens its unlock screen at most once a minute for a page that is not connected.

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

No code changes are needed; the SDK detects the environment.

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

The 0xio bridge carries every SDK method. The RFC-O-1 provider carries what the RFC names, so `getBalance`, `getPublicKey`, `getTransactionHistory`, `getContractStorage`, `getPendingPrivateTransfers` and `rpcCall` have no equivalent there. The table in DOCUMENTATION.md lists coverage per method.

To add a wallet, copy `src/supports/template.ts`, fill in its constants and message mapping, register it in `src/supports/index.ts`, and export it from `src/index.ts` if it belongs in the public API.

## Timeouts

Approvals wait up to three minutes. A private transfer waits up to ten, because the wallet builds proofs after the approval. Interactive methods are never retried, so a slow approval never produces a second popup.

## Requirements

- 0xio Wallet Extension 2.5.5 or newer for the 2.8.0 private primitives and framed message signing; 2.4.0 or newer for private transfers and claims
- 0xio Desktop 1.0 or newer for the iframe bridge, 0xio App 1.0 or newer for the WebView bridge
- A current Chromium-based browser (Chrome, Edge, Brave) or Firefox

## License

MIT License. Copyright 2026 0xio Labs.
