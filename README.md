# 0xio Wallet SDK

**Version:** 2.3.0

Official TypeScript SDK for integrating DApps with 0xio Wallet on Octra Network.

## What's New in v2.3.0

- **Smart Contract Calls**: New `callContract()` for state-changing contract interaction (signed, with approval popup)
- **Contract View Calls**: New `contractCallView()` for read-only queries (no signing, no popup)
- **Contract Storage**: New `getContractStorage()` to read on-chain contract storage by key
- **Type Safety**: New `ContractParams` type (`ReadonlyArray<string | number | boolean>`) replaces `any` in contract interfaces; typed event handlers
- **Error Consistency**: `getNetworkConfig()` now throws `ZeroXIOWalletError` instead of generic `Error`
- **Security Fixes**: Fixed wildcard origin in dev utils, added signMessage length limit, narrowed dev detection
- **Message Limit**: Raised `isValidMessage()` from 280 to 100K chars to support contract call parameters

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

### Smart Contracts

#### `wallet.callContract(data: ContractCallData): Promise<TransactionResult>`
Execute a state-changing contract call. The extension signs and submits via `octra_submit`.

```typescript
const result = await wallet.callContract({
  contract: 'oct26Lia...',  // Contract address
  method: 'swap',           // AML method name
  params: [100, true, 90],  // Method arguments (flat, not array-wrapped)
  amount: '0',              // Native OCT to send (optional, default '0')
  ou: '10000',              // Operational units (optional, default '10000')
});
console.log('TX Hash:', result.txHash);
```

#### `wallet.contractCallView(data: ContractViewCallData): Promise<any>`
Read-only contract query. No signing, no approval popup, no wallet unlock required.

```typescript
const price = await wallet.contractCallView({
  contract: 'oct26Lia...',
  method: 'get_active_price',
  params: [],
});
console.log('Price:', price);
```

#### `wallet.getContractStorage(contract: string, key: string): Promise<string | null>`
Read contract storage by key.

```typescript
const value = await wallet.getContractStorage('oct26Lia...', 'total_supply');
console.log('Total supply:', value);
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

## Networks

The SDK ships with built-in configurations for Octra networks:

```typescript
import { NETWORKS, getNetworkConfig } from '@0xio/sdk';

// Get devnet config
const devnet = getNetworkConfig('devnet');
console.log(devnet.rpcUrl);           // http://165.227.225.79:8080
console.log(devnet.supportsPrivacy);  // true
console.log(devnet.isTestnet);        // true

// Get mainnet config
const mainnet = getNetworkConfig('mainnet');
console.log(mainnet.rpcUrl);          // https://octra.network
console.log(mainnet.supportsPrivacy); // false
```

| Network | Privacy (FHE) | Explorer |
|---------|:---:|---|
| Mainnet Alpha | No | [octrascan.io](https://octrascan.io) |
| Devnet | Yes | [devnet.octrascan.io](https://devnet.octrascan.io) |

### NetworkInfo Type

```typescript
interface NetworkInfo {
  id: string;
  name: string;
  rpcUrl: string;
  explorerUrl?: string;         // Transaction explorer base URL
  explorerAddressUrl?: string;  // Address explorer base URL
  indexerUrl?: string;          // Indexer/API base URL
  supportsPrivacy: boolean;     // FHE encrypted balance support
  color: string;                // Brand color hex
  isTestnet: boolean;
}
```

## Requirements

- 0xio Wallet Extension v2.0.1 or higher (Mainnet Alpha)
- 0xio Wallet Extension v2.2.1 or higher (Devnet — required for contract calls and privacy features)
- Modern browser (Chrome, Firefox, Edge, Brave)

## Documentation

See [DOCUMENTATION.md](DOCUMENTATION.md) for complete API reference.

## License

MIT License. Copyright 2026 0xio Labs.