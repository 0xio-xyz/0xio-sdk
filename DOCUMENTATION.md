# 0xio SDK - Complete Documentation

> Official TypeScript SDK for integrating DApps with 0xio Wallet on Octra Network

## Table of Contents

- [Overview](#overview)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
- [API Reference](#api-reference)
- [Advanced Usage](#advanced-usage)
- [Framework Integration](#framework-integration)
- [Error Handling](#error-handling)
- [Security](#security)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)

## Overview

The 0xio SDK provides a comprehensive toolkit for building decentralized applications on the Octra Network. It handles all the complexity of wallet communication, transaction management, and event handling, allowing you to focus on building great user experiences.

### What's Included

- **Wallet Connection** - Seamless integration with 0xio Wallet browser extension
- **Transaction Management** - Send public and private transactions
- **Balance Queries** - Read public and encrypted private balances
- **Event System** - Real-time updates for all wallet events
- **Network Management** - Support for testnet and custom networks
- **Type Safety** - Full TypeScript definitions
- **Framework Agnostic** - Works with React, Vue, Svelte, or vanilla JS

### Architecture

```
DApp (Your Application)
    ↓
0xio SDK (@0xgery/0xio-sdk)
    ↓
0xio Wallet Extension
    ↓
Octra Network
```

## Installation

### NPM

```bash
npm install @0xgery/0xio-sdk
```

### Yarn

```bash
yarn add @0xgery/0xio-sdk
```

### CDN (UMD)

```html
<script src="https://unpkg.com/@0xgery/0xio-sdk@1.0.5/dist/index.umd.js"></script>
<script>
  // SDK available as global: ZeroXIOWalletSDK
  const wallet = new ZeroXIOWalletSDK.ZeroXIOWallet({
    appName: 'My DApp'
  });
</script>
```

## Quick Start

### Basic Example

```typescript
import { ZeroXIOWallet } from '@0xgery/0xio-sdk';

// 1. Create wallet instance
const wallet = new ZeroXIOWallet({
  appName: 'My DApp',
  appDescription: 'A cool decentralized application',
  requiredPermissions: ['read_balance', 'send_transactions']
});

// 2. Initialize
await wallet.initialize();

// 3. Connect to user's wallet
const connection = await wallet.connect();
console.log('Connected!', connection.address);

// 4. Get balance
const balance = await wallet.getBalance();
console.log('Balance:', balance.total, 'OCT');

// 5. Send transaction
const result = await wallet.sendTransaction({
  to: 'oct1recipient...',
  amount: 10.5,
  message: 'Payment for services'
});
console.log('Transaction hash:', result.txHash);
```

### Helper Function

For even simpler setup:

```typescript
import { createZeroXIOWallet } from '@0xgery/0xio-sdk';

const wallet = await createZeroXIOWallet({
  appName: 'My DApp',
  autoConnect: true,
  debug: true
});

if (wallet.isConnected()) {
  const balance = await wallet.getBalance();
  console.log('Balance:', balance.total);
}
```

## Core Concepts

### 1. Initialization

The SDK must be initialized before any operations:

```typescript
const wallet = new ZeroXIOWallet({
  appName: 'My DApp',  // Required
  debug: true          // Optional: enable logging
});

await wallet.initialize();
```

### 2. Connection Lifecycle

```typescript
// Connect
const connection = await wallet.connect();
// Returns: { address: string, balance: Balance, networkInfo: NetworkInfo }

// Check status
if (wallet.isConnected()) {
  const info = wallet.getConnectionInfo();
  console.log(info.address, info.connectedAt);
}

// Disconnect
await wallet.disconnect();
```

### 3. Event-Driven Updates

Instead of polling, listen for real-time events:

```typescript
wallet.on('balanceChanged', (event) => {
  console.log('New balance:', event.newBalance.total);
});

wallet.on('accountChanged', (event) => {
  console.log('User switched to:', event.newAddress);
});

wallet.on('networkChanged', (event) => {
  console.log('Network changed to:', event.newNetwork.name);
});
```

### 4. Transaction Flow

```typescript
try {
  const result = await wallet.sendTransaction({
    to: 'oct1...',
    amount: 100,
    message: 'Invoice #123'
  });

  console.log('Success!', result.txHash);

} catch (error) {
  if (error.code === 'USER_REJECTED') {
    console.log('User cancelled transaction');
  } else if (error.code === 'INSUFFICIENT_BALANCE') {
    console.log('Not enough balance');
  } else {
    console.error('Transaction failed:', error.message);
  }
}
```

## API Reference

### Constructor

#### `new ZeroXIOWallet(config: SDKConfig)`

Creates a new wallet SDK instance.

**Parameters:**

```typescript
interface SDKConfig {
  // Required
  appName: string;                    // Your DApp name

  // Optional
  appDescription?: string;            // Description shown to users
  appVersion?: string;               // Your app version (default: '1.0.0')
  appUrl?: string;                   // Your app URL (auto-detected)
  appIcon?: string;                  // Icon URL for connection dialog
  requiredPermissions?: Permission[]; // Permissions to request
  networkId?: string;                // Target network ('mainnet' | 'testnet')
  debug?: boolean;                   // Enable debug logging
}

type Permission =
  | 'read_address'
  | 'read_balance'
  | 'send_transactions'
  | 'sign_messages'
  | 'read_private_balance'
  | 'send_private_transactions';
```

**Example:**

```typescript
const wallet = new ZeroXIOWallet({
  appName: 'My DeFi App',
  appDescription: 'Decentralized lending platform',
  appVersion: '2.1.0',
  appIcon: 'https://myapp.com/icon.png',
  requiredPermissions: ['read_balance', 'send_transactions'],
  networkId: 'testnet',
  debug: process.env.NODE_ENV === 'development'
});
```

### Initialization Methods

#### `initialize(): Promise<boolean>`

Initialize the SDK. Must be called before any other methods.

```typescript
const initialized = await wallet.initialize();
if (initialized) {
  console.log('SDK ready');
}
```

**Returns:** `Promise<boolean>` - true if initialization successful

**Throws:** `OctraWalletError` if extension not found or initialization fails

---

### Connection Methods

#### `connect(options?: ConnectOptions): Promise<ConnectEvent>`

Connect to user's wallet. Shows connection dialog if not previously connected.

```typescript
const connection = await wallet.connect({
  requestPrivateAccess: true  // Request private balance permissions
});

console.log('Address:', connection.address);
console.log('Balance:', connection.balance.total);
console.log('Network:', connection.networkInfo.name);
```

**Parameters:**

```typescript
interface ConnectOptions {
  requestPrivateAccess?: boolean;  // Request private balance access
  timeout?: number;                // Connection timeout (ms)
}
```

**Returns:**

```typescript
interface ConnectEvent {
  address: string;
  balance: Balance;
  networkInfo: NetworkInfo;
  permissions: Permission[];
}
```

#### `disconnect(): Promise<void>`

Disconnect from wallet.

```typescript
await wallet.disconnect();
console.log('Disconnected');
```

#### `isConnected(): boolean`

Check if currently connected.

```typescript
if (wallet.isConnected()) {
  console.log('Connected');
}
```

#### `getConnectionInfo(): ConnectionInfo`

Get current connection details.

```typescript
const info = wallet.getConnectionInfo();
console.log('Connected to:', info.address);
console.log('Since:', new Date(info.connectedAt));
console.log('Permissions:', info.permissions);
```

**Returns:**

```typescript
interface ConnectionInfo {
  address: string;
  connectedAt: number;
  permissions: Permission[];
  networkId: string;
}
```

---

### Wallet Information Methods

#### `getAddress(): string | null`

Get connected wallet address.

```typescript
const address = wallet.getAddress();
console.log('Address:', address); // 'oct1...' or null
```

#### `getBalance(forceRefresh?: boolean): Promise<Balance>`

Get wallet balance.

```typescript
// Use cached balance
const balance = await wallet.getBalance();

// Force refresh from network
const freshBalance = await wallet.getBalance(true);

console.log('Public:', balance.public);
console.log('Private:', balance.private);
console.log('Total:', balance.total);
```

**Returns:**

```typescript
interface Balance {
  public: number;    // Public balance
  private: number;   // Private (encrypted) balance
  total: number;     // public + private
}
```

#### `getNetworkInfo(): Promise<NetworkInfo>`

Get current network information.

```typescript
const network = await wallet.getNetworkInfo();
console.log('Network:', network.name);
console.log('RPC:', network.rpcUrl);
console.log('Explorer:', network.explorerUrl);
```

**Returns:**

```typescript
interface NetworkInfo {
  id: string;              // 'mainnet' | 'testnet' | 'custom'
  name: string;            // Display name
  rpcUrl: string;          // RPC endpoint
  explorerUrl?: string;    // Block explorer
  explorerAddressUrl?: string;
  color?: string;          // UI color
}
```

---

### Transaction Methods

#### `sendTransaction(txData: TransactionData): Promise<TransactionResult>`

Send a public transaction.

```typescript
const result = await wallet.sendTransaction({
  to: 'oct1recipient...',
  amount: 100.5,
  message: 'Payment for invoice #123',
  feeLevel: 'medium'
});

console.log('Transaction hash:', result.txHash);
console.log('Fee paid:', result.fee);
```

**Parameters:**

```typescript
interface TransactionData {
  to: string;                    // Recipient address
  amount: number;                // Amount in OCT
  message?: string;              // Optional memo
  feeLevel?: FeeLevel;          // 'low' | 'medium' | 'high'
  customFee?: number;           // Override fee
}
```

**Returns:**

```typescript
interface TransactionResult {
  txHash: string;
  from: string;
  to: string;
  amount: number;
  fee: number;
  timestamp: number;
  status: 'pending' | 'confirmed' | 'failed';
}
```

#### `getTransactionHistory(page?, limit?): Promise<TransactionHistory>`

Get transaction history.

```typescript
const history = await wallet.getTransactionHistory(1, 20);

history.transactions.forEach(tx => {
  console.log(`${tx.type}: ${tx.amount} OCT to ${tx.to}`);
});

console.log('Total:', history.total);
console.log('Page:', history.page, 'of', history.totalPages);
```

**Returns:**

```typescript
interface TransactionHistory {
  transactions: Transaction[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
```

---

### Private Feature Methods

#### `getPrivateBalanceInfo(): Promise<PrivateBalanceInfo>`

Get private balance details.

```typescript
const privateInfo = await wallet.getPrivateBalanceInfo();
console.log('Encrypted balance:', privateInfo.encryptedAmount);
console.log('Status:', privateInfo.status);
```

#### `encryptBalance(amount: number): Promise<boolean>`

Encrypt public balance to private balance.

```typescript
// Encrypt 100 OCT from public to private
const success = await wallet.encryptBalance(100);
if (success) {
  console.log('Balance encrypted');
}
```

#### `decryptBalance(amount: number): Promise<boolean>`

Decrypt private balance to public balance.

```typescript
// Decrypt 50 OCT from private to public
const success = await wallet.decryptBalance(50);
if (success) {
  console.log('Balance decrypted');
}
```

#### `sendPrivateTransfer(data: PrivateTransferData): Promise<TransactionResult>`

Send an encrypted private transfer.

```typescript
const result = await wallet.sendPrivateTransfer({
  to: 'oct1recipient...',
  amount: 50,
  message: 'Private payment'
});

console.log('Private transfer sent:', result.txHash);
```

#### `getPendingPrivateTransfers(): Promise<PendingPrivateTransfer[]>`

Get pending incoming private transfers.

```typescript
const pending = await wallet.getPendingPrivateTransfers();

pending.forEach(transfer => {
  console.log(`From: ${transfer.from}, Amount: ${transfer.amount}`);
});
```

#### `claimPrivateTransfer(transferId: string): Promise<TransactionResult>`

Claim a pending private transfer.

```typescript
const result = await wallet.claimPrivateTransfer('transfer_123');
console.log('Claimed:', result.amount, 'OCT');
```

---

### Event Methods

#### `on(event: WalletEventType, listener: Function): void`

Register event listener.

```typescript
wallet.on('connect', (event) => {
  console.log('Connected:', event.address);
});

wallet.on('balanceChanged', (event) => {
  console.log('Balance changed:', event.newBalance.total);
});
```

**Events:**

| Event | Data | Description |
|-------|------|-------------|
| `connect` | `ConnectEvent` | Wallet connected |
| `disconnect` | `DisconnectEvent` | Wallet disconnected |
| `accountChanged` | `AccountChangedEvent` | User switched account |
| `balanceChanged` | `BalanceChangedEvent` | Balance updated |
| `networkChanged` | `NetworkChangedEvent` | Network switched |
| `transactionConfirmed` | `TransactionEvent` | Transaction confirmed |
| `error` | `ErrorEvent` | Error occurred |
| `extensionLocked` | `LockEvent` | Extension was locked |
| `extensionUnlocked` | `LockEvent` | Extension was unlocked |

#### `off(event: WalletEventType, listener: Function): void`

Remove event listener.

```typescript
const handler = (event) => console.log(event);
wallet.on('connect', handler);
wallet.off('connect', handler);
```

#### `once(event: WalletEventType, listener: Function): void`

Register one-time event listener.

```typescript
wallet.once('connect', (event) => {
  console.log('Connected once:', event.address);
});
```

---

### Utility Functions

The SDK exports useful utility functions:

```typescript
import {
  // Validation
  isValidAddress,
  isValidAmount,
  isValidMessage,
  isValidFeeLevel,
  isValidNetworkId,

  // Formatting
  formatZeroXIO,
  formatAddress,
  formatTimestamp,
  formatTxHash,

  // Conversion
  toMicroZeroXIO,
  fromMicroZeroXIO,

  // Error handling
  createErrorMessage,
  isErrorType,

  // Async utilities
  delay,
  retry,
  withTimeout,

  // Browser utilities
  isBrowser,
  checkBrowserSupport,

  // Development
  generateMockData,
  createLogger
} from '@0xgery/0xio-sdk';
```

**Examples:**

```typescript
// Validation
if (isValidAddress('oct1...')) {
  console.log('Valid address');
}

// Formatting
const formatted = formatZeroXIO(123.456789, 2); // "123.46 OCT"
const shortAddr = formatAddress('oct1abc...xyz', 6, 4); // "oct1ab...xyz"

// Conversion
const micro = toMicroZeroXIO(1.5); // 1500000
const oct = fromMicroZeroXIO(1500000); // 1.5

// Error handling
if (isErrorType(error, ErrorCode.INSUFFICIENT_BALANCE)) {
  console.log('Not enough balance');
}

// Async utilities
await delay(1000); // Wait 1 second

const result = await retry(
  () => wallet.getBalance(),
  { maxAttempts: 3, delay: 1000 }
);

const data = await withTimeout(
  wallet.sendTransaction(txData),
  5000 // 5 second timeout
);
```

---

## Advanced Usage

### Custom Network Configuration

```typescript
const wallet = new ZeroXIOWallet({
  appName: 'My DApp',
  networkId: 'custom'
});

// User can configure custom network in wallet extension
```

### Transaction with Custom Fee

```typescript
const result = await wallet.sendTransaction({
  to: 'oct1...',
  amount: 100,
  customFee: 0.001 // Override default fee
});
```

### Handling Bulk Transactions

```typescript
const recipients = [
  { to: 'oct1...', amount: 10 },
  { to: 'oct2...', amount: 20 },
  { to: 'oct3...', amount: 30 }
];

for (const recipient of recipients) {
  try {
    const result = await wallet.sendTransaction(recipient);
    console.log(`Sent to ${recipient.to}:`, result.txHash);
  } catch (error) {
    console.error(`Failed to send to ${recipient.to}:`, error.message);
  }
}
```

### Private Transfer Workflow

```typescript
// 1. Check private balance
const balance = await wallet.getBalance();
if (balance.private < amount) {
  // 2. Encrypt some public balance
  await wallet.encryptBalance(amount);
}

// 3. Send private transfer
const result = await wallet.sendPrivateTransfer({
  to: 'oct1recipient...',
  amount: amount
});

console.log('Private transfer sent:', result.txHash);

// Recipient side:
// 1. Check pending transfers
const pending = await wallet.getPendingPrivateTransfers();

// 2. Claim each transfer
for (const transfer of pending) {
  await wallet.claimPrivateTransfer(transfer.id);
}
```

### Development Mode Utilities

```typescript
// Enable debug mode
if (process.env.NODE_ENV === 'development') {
  window.__ZEROXIO_SDK_UTILS__.enableDebugMode();

  // Get SDK info
  console.log(window.__ZEROXIO_SDK_UTILS__.getSDKInfo());

  // Simulate events for testing
  window.__ZEROXIO_SDK_UTILS__.simulateExtensionEvent('balanceChanged', {
    newBalance: { public: 100, private: 50, total: 150 }
  });
}
```

---

## Framework Integration

### React

```tsx
import React, { useState, useEffect } from 'react';
import { ZeroXIOWallet, Balance } from '@0xgery/0xio-sdk';

export function useWallet() {
  const [wallet] = useState(() => new ZeroXIOWallet({ appName: 'My DApp' }));
  const [connected, setConnected] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [balance, setBalance] = useState<Balance | null>(null);

  useEffect(() => {
    wallet.initialize().then(() => {
      // Setup listeners
      wallet.on('connect', (event) => {
        setConnected(true);
        setAddress(event.address);
        setBalance(event.balance);
      });

      wallet.on('disconnect', () => {
        setConnected(false);
        setAddress(null);
        setBalance(null);
      });

      wallet.on('balanceChanged', (event) => {
        setBalance(event.newBalance);
      });
    });
  }, [wallet]);

  const connect = async () => {
    await wallet.connect();
  };

  const disconnect = async () => {
    await wallet.disconnect();
  };

  const sendTransaction = async (to: string, amount: number) => {
    return await wallet.sendTransaction({ to, amount });
  };

  return {
    wallet,
    connected,
    address,
    balance,
    connect,
    disconnect,
    sendTransaction
  };
}

// Component usage
function WalletButton() {
  const { connected, address, balance, connect, disconnect } = useWallet();

  if (!connected) {
    return <button onClick={connect}>Connect Wallet</button>;
  }

  return (
    <div>
      <p>Address: {address}</p>
      <p>Balance: {balance?.total} OCT</p>
      <button onClick={disconnect}>Disconnect</button>
    </div>
  );
}
```

### Vue 3

```vue
<template>
  <div>
    <button v-if="!connected" @click="connect">Connect Wallet</button>
    <div v-else>
      <p>Address: {{ address }}</p>
      <p>Balance: {{ balance?.total }} OCT</p>
      <button @click="disconnect">Disconnect</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { ZeroXIOWallet, Balance } from '@0xgery/0xio-sdk';

const wallet = new ZeroXIOWallet({ appName: 'My Vue DApp' });
const connected = ref(false);
const address = ref<string | null>(null);
const balance = ref<Balance | null>(null);

onMounted(async () => {
  await wallet.initialize();

  wallet.on('connect', (event) => {
    connected.value = true;
    address.value = event.address;
    balance.value = event.balance;
  });

  wallet.on('disconnect', () => {
    connected.value = false;
    address.value = null;
    balance.value = null;
  });

  wallet.on('balanceChanged', (event) => {
    balance.value = event.newBalance;
  });
});

const connect = async () => {
  await wallet.connect();
};

const disconnect = async () => {
  await wallet.disconnect();
};
</script>
```

### Svelte

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { ZeroXIOWallet, type Balance } from '@0xgery/0xio-sdk';

  const wallet = new ZeroXIOWallet({ appName: 'My Svelte DApp' });
  let connected = false;
  let address: string | null = null;
  let balance: Balance | null = null;

  onMount(async () => {
    await wallet.initialize();

    wallet.on('connect', (event) => {
      connected = true;
      address = event.address;
      balance = event.balance;
    });

    wallet.on('disconnect', () => {
      connected = false;
      address = null;
      balance = null;
    });

    wallet.on('balanceChanged', (event) => {
      balance = event.newBalance;
    });
  });

  async function connect() {
    await wallet.connect();
  }

  async function disconnect() {
    await wallet.disconnect();
  }
</script>

{#if !connected}
  <button on:click={connect}>Connect Wallet</button>
{:else}
  <div>
    <p>Address: {address}</p>
    <p>Balance: {balance?.total} OCT</p>
    <button on:click={disconnect}>Disconnect</button>
  </div>
{/if}
```

---

## Error Handling

### Error Codes

```typescript
enum ErrorCode {
  EXTENSION_NOT_FOUND = 'EXTENSION_NOT_FOUND',
  CONNECTION_REFUSED = 'CONNECTION_REFUSED',
  USER_REJECTED = 'USER_REJECTED',
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  INVALID_ADDRESS = 'INVALID_ADDRESS',
  INVALID_AMOUNT = 'INVALID_AMOUNT',
  NETWORK_ERROR = 'NETWORK_ERROR',
  TRANSACTION_FAILED = 'TRANSACTION_FAILED',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  WALLET_LOCKED = 'WALLET_LOCKED',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  TIMEOUT = 'TIMEOUT',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}
```

### Error Handling Pattern

```typescript
import { OctraWalletError, ErrorCode, isErrorType } from '@0xgery/0xio-sdk';

try {
  const result = await wallet.sendTransaction(txData);

} catch (error) {
  if (error instanceof OctraWalletError) {
    switch (error.code) {
      case ErrorCode.EXTENSION_NOT_FOUND:
        showError('Please install 0xio Wallet extension');
        break;

      case ErrorCode.USER_REJECTED:
        console.log('User cancelled transaction');
        break;

      case ErrorCode.INSUFFICIENT_BALANCE:
        showError('Not enough balance');
        break;

      case ErrorCode.WALLET_LOCKED:
        showError('Please unlock your wallet');
        break;

      case ErrorCode.RATE_LIMIT_EXCEEDED:
        showError('Too many requests, please slow down');
        break;

      default:
        showError(`Transaction failed: ${error.message}`);
    }

    // Enhanced diagnostics
    console.error('Error details:', error.details);
  } else {
    console.error('Unexpected error:', error);
  }
}
```

### Error Event Handling

```typescript
wallet.on('error', (errorEvent) => {
  console.error('Wallet error:', errorEvent.error);

  // Show user-friendly message
  if (errorEvent.error.code === ErrorCode.NETWORK_ERROR) {
    showNotification('Network connection lost. Retrying...');
  }
});
```

---

## Security

### Best Practices

1. **Always Validate Inputs**

```typescript
import { isValidAddress, isValidAmount } from '@0xgery/0xio-sdk';

function validateTransaction(to: string, amount: number) {
  if (!isValidAddress(to)) {
    throw new Error('Invalid recipient address');
  }

  if (!isValidAmount(amount)) {
    throw new Error('Invalid amount');
  }
}
```

2. **Never Store Private Keys**

The SDK never exposes private keys. All signing happens in the wallet extension.

3. **Verify Network**

```typescript
const network = await wallet.getNetworkInfo();
if (network.id !== 'mainnet') {
  console.warn('Not on mainnet!');
  // Show warning to user
}
```

4. **Handle User Rejections Gracefully**

```typescript
try {
  await wallet.sendTransaction(txData);
} catch (error) {
  if (isErrorType(error, ErrorCode.USER_REJECTED)) {
    // Don't show error - user intentionally rejected
    console.log('Transaction cancelled by user');
  }
}
```

5. **Implement Timeouts**

```typescript
import { withTimeout } from '@0xgery/0xio-sdk';

try {
  const result = await withTimeout(
    wallet.sendTransaction(txData),
    30000 // 30 second timeout
  );
} catch (error) {
  if (isErrorType(error, ErrorCode.TIMEOUT)) {
    console.error('Transaction timed out');
  }
}
```

6. **Rate Limiting**

The SDK enforces rate limits:
- Max 20 requests per second
- Max 50 concurrent requests

Implement your own rate limiting for bulk operations:

```typescript
import { delay } from '@0xgery/0xio-sdk';

async function sendBulkTransactions(transactions) {
  for (const tx of transactions) {
    await wallet.sendTransaction(tx);
    await delay(100); // 100ms between transactions
  }
}
```

---

## Best Practices

### 1. Initialize Once, Reuse Instance

```typescript
// ❌ Bad: Creating multiple instances
function MyComponent() {
  const wallet = new ZeroXIOWallet({ appName: 'App' });
  // ...
}

// ✅ Good: Single instance
const wallet = new ZeroXIOWallet({ appName: 'App' });
export { wallet };
```

### 2. Clean Up Event Listeners

```typescript
// ✅ Good: Remove listeners when component unmounts
useEffect(() => {
  const handleBalance = (event) => {
    setBalance(event.newBalance);
  };

  wallet.on('balanceChanged', handleBalance);

  return () => {
    wallet.off('balanceChanged', handleBalance);
  };
}, []);
```

### 3. Cache Balances

```typescript
// ✅ Good: Use cached balance
const balance = await wallet.getBalance(); // Fast, uses cache

// Only force refresh when necessary
const freshBalance = await wallet.getBalance(true); // Slower, fetches from network
```

### 4. Handle Connection State

```typescript
// ✅ Good: Check connection before operations
async function sendMoney(to: string, amount: number) {
  if (!wallet.isConnected()) {
    await wallet.connect();
  }

  return await wallet.sendTransaction({ to, amount });
}
```

### 5. User Feedback

```typescript
// ✅ Good: Show loading states
async function handleSend() {
  setLoading(true);
  setError(null);

  try {
    const result = await wallet.sendTransaction(txData);
    showSuccess('Transaction sent!');
  } catch (error) {
    setError(error.message);
  } finally {
    setLoading(false);
  }
}
```

---

## Troubleshooting

### Extension Not Found

**Problem:** `EXTENSION_NOT_FOUND` error

**Solutions:**
1. Ensure 0xio Wallet extension is installed
2. Refresh the page
3. Check browser compatibility
4. Check console for detailed error

```typescript
try {
  await wallet.initialize();
} catch (error) {
  if (isErrorType(error, ErrorCode.EXTENSION_NOT_FOUND)) {
    // Show install prompt
    window.open('https://0xio.xyz/install');
  }
}
```

### Connection Timeout

**Problem:** Connection takes too long

**Solution:** Increase timeout

```typescript
await wallet.connect({
  timeout: 60000 // 60 seconds
});
```

### Events Not Firing

**Problem:** Event listeners not receiving events

**Solutions:**
1. Ensure wallet is initialized
2. Check listener is registered before event occurs
3. Verify event name spelling

```typescript
// ✅ Register listener before connecting
wallet.on('connect', handler);
await wallet.connect();
```

### Balance Not Updating

**Problem:** Balance shows old value

**Solutions:**
1. Listen to `balanceChanged` event
2. Force refresh balance

```typescript
// Listen for updates
wallet.on('balanceChanged', (event) => {
  updateUI(event.newBalance);
});

// Or force refresh
const balance = await wallet.getBalance(true);
```

### Transaction Fails Silently

**Problem:** Transaction fails without error

**Solution:** Add proper error handling

```typescript
wallet.on('error', (event) => {
  console.error('Wallet error:', event.error);
});

try {
  await wallet.sendTransaction(txData);
} catch (error) {
  console.error('Transaction error:', error);
}
```

### TypeScript Types Not Working

**Problem:** TypeScript can't find types

**Solution:** Ensure types are included

```typescript
// tsconfig.json
{
  "compilerOptions": {
    "moduleResolution": "node",
    "esModuleInterop": true
  }
}
```

---

## Support

- **Issues**: [GitHub Issues](https://github.com/0xGery/0xio-sdk/issues)
- **Discussions**: [GitHub Discussions](https://github.com/0xGery/0xio-sdk/discussions)
- **Telegram**: [@nullXgery](https://t.me/nullXgery)
- **Email**: 0xgery@proton.me

## License

MIT License - See [LICENSE](LICENSE) file for details

---

**Built by NullxGery (0xGery) for the Octra Network ecosystem**
