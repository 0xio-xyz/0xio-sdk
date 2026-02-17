# 0xio Wallet SDK

**Version:** 2.1.8

Official TypeScript SDK for integrating DApps with 0xio Wallet on Octra Network.

## What's New in v2.1.8

- **Transaction Finality**: `TransactionResult` and `Transaction` now include `finality` field (`'pending' | 'confirmed' | 'rejected'`)
- **RPC Error Types**: 7 new error codes from `octra_submit` and `octra_submitBatch` RPC methods: `MALFORMED_TRANSACTION`, `SELF_TRANSFER`, `SENDER_NOT_FOUND`, `INVALID_SIGNATURE`, `DUPLICATE_TRANSACTION`, `NONCE_TOO_FAR`, `INTERNAL_ERROR`
- **Error Messages**: All new error codes have human-readable messages via `createErrorMessage()`

## Installation

```bash
npm install @0xio/sdk
```

## Quick Start

```typescript
import { ZeroXIOWallet } from '@0xio/sdk';

// 1. Initialize
const wallet = new ZeroXIOWallet({
  appName: 'My DApp',
  requiredPermissions: ['read_balance', 'sign_messages']
});

await wallet.initialize();

// 2. Connect
const connection = await wallet.connect();
console.log('Connected:', connection.address);
console.log('Public Key:', connection.publicKey); // Base64 Ed25519 key

// 3. Get Balance
const balance = await wallet.getBalance();
console.log('Total:', balance.total, 'OCT');

// 4. Sign a Message
const signature = await wallet.signMessage('Hello, 0xio!');
console.log('Signature:', signature);

// 5. Send Transaction
const result = await wallet.sendTransaction({
  to: 'oct1recipient...',
  amount: 10.5,
  message: 'Payment'
});
console.log('TX Hash:', result.txHash);
```

## API Reference

### Connection

#### `wallet.initialize(): Promise<boolean>`
Initialize the SDK. Must be called first.

#### `wallet.connect(options?): Promise<ConnectEvent>`
Connect to the user's wallet. Shows approval popup if first time.

#### `wallet.disconnect(): Promise<void>`
Disconnect from the wallet.

#### `wallet.isConnected(): boolean`
Check if currently connected.

### Balance

#### `wallet.getBalance(forceRefresh?: boolean): Promise<Balance>`
Get wallet balance (public + private).

```typescript
interface Balance {
  public: number;   // Visible on-chain balance
  private: number;  // Encrypted (FHE) balance
  total: number;    // public + private
  currency: 'OCT';
}
```

### Transactions

#### `wallet.sendTransaction(txData): Promise<TransactionResult>`
Send a transaction. Returns result with transaction finality status.

```typescript
interface TransactionData {
  to: string;        // Recipient address (oct1...)
  amount: number;    // Amount in OCT
  message?: string;  // Optional memo
}

interface TransactionResult {
  txHash: string;
  success: boolean;
  finality?: 'pending' | 'confirmed' | 'rejected';
  message?: string;
  explorerUrl?: string;
}
```

### Message Signing

#### `wallet.signMessage(message: string): Promise<string>`
Sign an arbitrary message with the wallet's private key. User will be prompted to approve.

```typescript
// Sign a message for authentication
const message = `Login to MyDApp\nTimestamp: ${Date.now()}`;
const signature = await wallet.signMessage(message);

// Signature is base64-encoded Ed25519
console.log('Signature:', signature);
```

**Use cases:**
- Prove wallet ownership for API authentication
- Sign login challenges
- Authorize off-chain actions
- Create verifiable attestations

### Events

```typescript
wallet.on('connect', (event) => console.log('Connected:', event.address));
wallet.on('disconnect', (event) => console.log('Disconnected'));
wallet.on('balanceChanged', (event) => console.log('New balance:', event.newBalance.total));
wallet.on('accountChanged', (event) => console.log('Account changed:', event.newAddress));
wallet.on('networkChanged', (event) => console.log('Network:', event.newNetwork.name));
```

## Error Handling

```typescript
import { ZeroXIOWalletError, ErrorCode } from '@0xio/sdk';

try {
  const result = await wallet.sendTransaction({ to: 'oct1...', amount: 10 });
} catch (error) {
  if (error instanceof ZeroXIOWalletError) {
    switch (error.code) {
      case ErrorCode.USER_REJECTED:
        console.log('User rejected the request');
        break;
      case ErrorCode.INSUFFICIENT_BALANCE:
        console.log('Not enough balance');
        break;
      case ErrorCode.INVALID_SIGNATURE:
        console.log('Invalid transaction signature');
        break;
      case ErrorCode.DUPLICATE_TRANSACTION:
        console.log('Transaction already submitted');
        break;
      case ErrorCode.SELF_TRANSFER:
        console.log('Cannot send to yourself');
        break;
      case ErrorCode.NONCE_TOO_FAR:
        console.log('Transaction nonce too far ahead');
        break;
      case ErrorCode.WALLET_LOCKED:
        console.log('Please unlock your wallet');
        break;
    }
  }
}
```

## Requirements

- 0xio Wallet Extension v2.0.1 or higher
- Modern browser (Chrome, Firefox, Edge, Brave)

## Documentation

See [DOCUMENTATION.md](DOCUMENTATION.md) for complete API reference.

## License

MIT License. Copyright 2026 0xio Labs.