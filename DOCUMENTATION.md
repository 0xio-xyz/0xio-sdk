# 0xio SDK - Complete Documentation

> Official TypeScript SDK for integrating DApps with 0xio Wallet on Octra Network

## Table of Contents

- [Overview](#overview)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
- [API Reference](#api-reference)
- [Request Lifecycle](#request-lifecycle)
- [Advanced Usage](#advanced-usage)
- [Wallet Adapter System](#wallet-adapter-system)
- [Framework Integration](#framework-integration)
- [Error Handling](#error-handling)
- [Security](#security)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)

## Overview

The 0xio SDK provides a comprehensive toolkit for building decentralized applications on the Octra Network. It handles all the complexity of wallet communication, transaction management, and event handling, allowing you to focus on building great user experiences.

### What's Included

- **Wallet Connection** - Seamless integration with 0xio Wallet Extension, Desktop, and Mobile
- **Transaction Management** - Send public and private transactions
- **Smart Contract Interaction** - Call contracts (state-changing and view), read storage
- **Message Signing** - Sign arbitrary messages for authentication and attestation
- **Balance Queries** - Read public and encrypted private balances
- **Event System** - Real-time updates for all wallet events
- **Network Management** - Support for Mainnet Alpha, Devnet, and custom networks
- **Type Safety** - Full TypeScript definitions
- **Framework Agnostic** - Works with React, Vue, Svelte, or vanilla JS

### Architecture

```
DApp (Your Application)
    ↓
0xio SDK (@0xio/sdk)
    ↓
WalletTransportAdapter (pluggable)
  ZeroXIOAdapter (built-in)
    Extension: MessageChannel port
    iframe: postMessage to the parent
  CustomAdapter (src/supports/my-wallet)
    ↓
Octra Network
```

### Supported Platforms

| Platform | Transport | How It Works |
|----------|-----------|--------------|
| **0xio Wallet Extension** | `window.postMessage` | Content script relays messages between DApp and extension background |
| **0xio Desktop** | `window.parent.postMessage` (iframe) | DApp loaded in BrowserScreen iframe; desktop wallet bridges messages |
| **0xio App** | `window.parent.postMessage` (WebView) | DApp loaded in built-in browser WebView; mobile wallet bridges messages |
| **0xio Desktop, no extension** | WebSocket to `ws://127.0.0.1:19345` | Used only when no extension answers; the desktop reviews every request in its menu bar |

The SDK auto-detects the environment. When `window.parent !== window`, it assumes a wallet bridge (desktop or mobile) is available. No code changes are needed for DApp developers. `wallet.transport` reports `'extension'` or `'desktop'` after `initialize()`.

### 0xio Desktop without the extension

`initialize()` looks for the extension first (about 300 ms since 2.12.0, `detectTimeoutMs`), and the extension always wins when present. When no extension answers in that window, and the site has not set `desktop: false`, the SDK reads the page's local network permission:

| Permission | `initialize()` | `connect()` |
|------------|----------------|-------------|
| `granted`, or not reported by the browser | Opens the desktop (800 ms to connect); rejects with `EXTENSION_NOT_FOUND` when it does not answer | Uses the transport found |
| `prompt` | Opens nothing; resolves `true` with `transport` `null` and `desktopAvailableOnConnect` `true` | Uses the extension if it has appeared, else opens the desktop, emits `connectProgress`, and waits up to 20 seconds for an ignored prompt; a block or a desktop that is not running ends it at once (`details.desktop`: `blocked` or `not-running`); rejects with `EXTENSION_NOT_FOUND` when neither answers and tries again on the next call |
| `denied` | Never opens the socket; rejects with `EXTENSION_NOT_FOUND` | |

To open the desktop the SDK connects to `ws://127.0.0.1:19345` and sends `site_hello`. The desktop must answer `{ v: 1, wallet: "0xio-desktop" }`. The SDK then subscribes to the site's events and sends every SDK method as a `site_request`. It never sends a site or origin field: the desktop names the site from the browser's Origin header.

It is tried only in a browser page that is a secure context (`https:`), or on plain `http:` for `localhost`, `127.0.0.1` and `[::1]`, and not with an adapter for another wallet.

| Wire | Shape |
|------|-------|
| Hello | `{"v":1,"_id":1,"method":"site_hello","site_token":"<43 chars>"}` answered `{v:1, wallet:"0xio-desktop"}`, plus `version` and `network` when the token proves the connected site; `token_status` is `"valid"` or `"invalid"` whenever a token was sent |
| Request | `{"v":1,"_id":n,"method":"site_request","id":"<32 hex>","network":"mainnet","request":{"method":"connect","params":{}}}` |
| Reply | `{"_id":n,"id":"<32 hex>","result":...}` or `{"_id":n,"id":"<32 hex>","error":{"code":"USER_REJECTED","message":"..."}}` |
| Cancel | `{"v":1,"_id":n,"method":"site_cancel","id":"<32 hex>"}` on timeout, `cleanup()` and `pagehide` |
| Events | `{"v":1,"_id":n,"method":"sites_subscribe"}`, then `{"event":"site_event","origin":...,"kind":...,"data":...}` |

Any local program can send an Origin header, so the desktop treats a link as the connected site only once its `site_hello` carries the site's token. An approved `connect` result carries `siteToken` (32 random bytes, base64url without padding); the desktop keeps only its SHA-256, compares it in constant time, and replaces it on each approved connect. The SDK takes it out of the result, stores it in `localStorage` under `0xio:desktop-site-token` (storage errors are ignored), sends it in every `site_hello`, and removes it on `disconnect()`, on an `accountsChanged` event with no accounts, and on `token_status: "invalid"`. A link without a valid token gets what an unconnected site gets: no events, an empty `sites_snapshot`, `NOT_CONNECTED` for reads and signing, and a fresh review for `connect`, whose approval proves that link. The desktop revokes the token when the site disconnects or is removed in its Settings.

Events reach the page in the extension's shapes: `accountsChanged` becomes `accountChanged` (or `disconnect` when `accounts` is empty), `networkChanged` becomes `networkChanged`, `tx` becomes `transactionConfirmed` (`transactionFailed` for a failed, rejected or dropped status), and `lock` becomes `extensionLocked` followed by `disconnect`.

Error codes pass through as `ErrorCode` values; the desktop's `RATE_LIMITED` reads as `RATE_LIMIT_EXCEEDED`, and `AUTH_REQUIRED`, `PAIRING_REQUIRED` and `AUTH_FAILED` read as `NETWORK_ERROR`. Codes specific to the desktop: `NOT_AVAILABLE` (a private method while the desktop is on another network), `WALLET_CHANGED` (a private method while another wallet is open), `NETWORK_CHANGED` (the network or wallet moved during the review) and `UNSUPPORTED_METHOD` (`getPendingPrivateTransfers`).

Results match the extension, with these differences: `getBalance()` reports `private: 0`, the `connect` payload carries `wallet: "0xio-desktop"`, and `getPrivateBalanceInfo()` returns `encrypted: null` with a message.

Waits: reviews and proofs up to ten minutes, reads one minute; a review call that runs out rejects with `STATUS_UNKNOWN`. On a timeout the SDK sends `site_cancel` to a protocol 1 desktop only; a protocol 2 desktop keeps the review (see Request Lifecycle). One review waits at a time per page, as with the extension. When the socket drops, requests in flight fail with `NETWORK_ERROR`, the SDK emits `disconnect` with reason `network_error`, and the next call reopens the link, pausing 1 s, then 2 s, up to 30 s after each failed attempt.

## Installation

### NPM

```bash
npm install @0xio/sdk
```

Coding assistants: follow [AGENTS.md](AGENTS.md), shipped at `node_modules/@0xio/sdk/AGENTS.md`. A working starter: `npm create @0xio/dapp`.

### Yarn

```bash
yarn add @0xio/sdk
```

### CDN (UMD)

```html
<script src="https://unpkg.com/@0xio/sdk@2.4.2/dist/index.umd.js"></script>
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
import { ZeroXIOWallet } from '@0xio/sdk';

// 1. Create wallet instance
const wallet = new ZeroXIOWallet({
  appName: 'My DApp',
  appDescription: 'A cool decentralized application',
  requiredPermissions: ['read_balance', 'send_transactions', 'sign_messages']
});

// 2. Initialize
await wallet.initialize();

// 3. Connect to user's wallet
const connection = await wallet.connect();
console.log('Connected!', connection.address);
console.log('Public Key:', connection.publicKey); // Base64 Ed25519 key (32 bytes)

// 4. Get balance
const balance = await wallet.getBalance();
console.log('Balance:', balance.total, 'OCT');

// 5. Sign a message (for authentication)
const signature = await wallet.signMessage('Login to My DApp');
console.log('Signature:', signature);

// 6. Send transaction
const result = await wallet.sendTransaction({
  to: 'oct1recipient...',
  amountOct: '10.5',
  message: 'Payment for services'
});
console.log('Transaction hash:', result.txHash);
```

### Helper Function

For even simpler setup:

```typescript
import { createZeroXIOWallet } from '@0xio/sdk';

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
  console.log('New balance:', event.data.newBalance.total);
});

wallet.on('accountChanged', (event) => {
  console.log('User switched to:', event.data.newAddress);
});

wallet.on('networkChanged', (event) => {
  console.log('Network changed to:', event.data.newNetwork.name);
});
```

### 4. Transaction Flow

```typescript
try {
  const result = await wallet.sendTransaction({
    to: 'oct1...',
    amountOct: '100',
    message: 'Invoice #123'
  });

  console.log('Success!', result.txHash);
  console.log('Finality:', result.finality); // 'pending' | 'confirmed' | 'rejected'

} catch (error) {
  if (error.code === 'USER_REJECTED') {
    console.log('User cancelled transaction');
  } else if (error.code === 'INSUFFICIENT_BALANCE') {
    console.log('Not enough balance');
  } else if (error.code === 'DUPLICATE_TRANSACTION') {
    console.log('Transaction already submitted');
  } else {
    console.error('Transaction failed:', error.message);
  }
}
```

### 5. Amounts and units

The wallet and the RFC-O-1 provider count in raw micro-OCT: one OCT is 1000000 units. The SDK never rescales a raw field, so what a dapp sends today keeps working. Where you would rather write OCT, use the OCT field and the SDK converts it with exact decimal arithmetic.

| Method | Raw field (sent unchanged) | OCT field (converted by the SDK) |
|--------|----------------------------|----------------------------------|
| `sendTransaction`, `signTransaction` | `amount` | `amountOct` |
| `callContract` | `amount` | `amountOct` |
| `sendPrivateTransfer` | `amountRaw` | `amount` (OCT, the original field) |
| `getBalance` | returns OCT | |
| `getTransactionHistory` | rows carry raw micro-OCT amounts, as the node returns them | |

Pass either the raw field or the OCT field, never both. Numbers that cannot be represented exactly in six decimals (such as `0.1 + 0.2`) are rejected; pass a string instead.

```typescript
await wallet.sendTransaction({ to, amountOct: '10.5' });   // 10.5 OCT
await wallet.sendTransaction({ to, amount: '10500000' });  // the same, in raw units
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
  networkId?: string;                // Target network ('mainnet' | 'devnet' | 'custom')
  debug?: boolean;                   // Enable debug logging
  trustedParentOrigins?: string[];   // Exact parent origins for the iframe bridge
  adapter?: WalletTransportAdapter;  // Another wallet's transport
  desktop?: boolean;                 // Try 0xio Desktop when no extension answers (default true)
}

type Permission =
  | 'accounts'              // address, balance, public key
  | 'public_transactions'   // sends and message signing
  | 'contract_calls'
  | 'contract_views'
  | 'private_balance_read'  // private balance, decrypt, pending transfers
  | 'private_proofs'        // encrypt values, zero and range proofs
  | 'private_transfers'
  | 'private_claims';
```

These are the names the wallet enforces. The older SDK names still work: the SDK translates them when it connects, and the names you asked for come back in the granted list as aliases, so a check like `permissions.includes('read_balance')` keeps working.

| Older name | Wallet scope |
|------------|--------------|
| `read_address`, `read_balance`, `read_public_key` | `accounts` |
| `send_transactions`, `sign_messages` | `public_transactions` |
| `contract_calls` | `contract_calls` |
| `view_private_balance`, `view_encrypted_balance`, `stealth_scan`, `decrypt_balance` | `private_balance_read` |
| `encrypt_balance` | `private_proofs` |
| `private_transfers` | `private_transfers` |
| `stealth_claim` | `private_claims` |

The private scopes show a warning in the connection dialog. Ask only for what the dapp uses.

**Example:**

```typescript
const wallet = new ZeroXIOWallet({
  appName: 'My DeFi App',
  appDescription: 'Decentralized lending platform',
  appVersion: '2.1.0',
  appIcon: 'https://myapp.com/icon.png',
  requiredPermissions: ['read_balance', 'send_transactions'],
  networkId: 'devnet',
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

**Throws:** `ZeroXIOWalletError` (`EXTENSION_NOT_FOUND`) when neither the extension nor 0xio Desktop answers, or when initialization fails

#### `transport: 'extension' | 'desktop' | null`

The transport in use after `initialize()`: `'extension'` for the extension or an app bridge, `'desktop'` for 0xio Desktop reached directly, `null` before, and while `desktopAvailableOnConnect` is true.

#### `desktopAvailableOnConnect: boolean`

True when `initialize()` found no extension and left 0xio Desktop for `connect()`, because Chrome would have to ask the visitor first. `initialize()` resolves `true` in this state and `isReady()` is `false`; keep the Connect button enabled. Methods other than `connect()` fail as with no wallet until `connect()` succeeds.

---

### Connection Methods

#### `connect(options?: ConnectOptions): Promise<ConnectEvent>`

Connect to user's wallet. Shows connection dialog if not previously connected.

```typescript
const connection = await wallet.connect();

console.log('Address:', connection.address);
console.log('Balance:', connection.balance.total);
console.log('Network:', connection.networkInfo.name);
```

**Parameters:**

```typescript
interface ConnectOptions {
  requestPermissions?: Permission[];  // Permissions to request
  networkId?: string;                 // Target network ID
}
```

**Returns:**

```typescript
interface ConnectEvent {
  address: string;
  publicKey?: string;  // Base64-encoded Ed25519 public key (32 bytes)
  canSign?: boolean;   // false for a watch-only wallet, undefined when not reported (2.10.0)
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
```

**Returns:**

```typescript
interface ConnectionInfo {
  isConnected: boolean;
  address?: string;
  publicKey?: string;  // Base64-encoded Ed25519 public key
  canSign?: boolean;   // false for a watch-only wallet, undefined when not reported (2.10.0)
  balance?: Balance;
  networkInfo?: NetworkInfo;
  connectedAt?: number;
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

#### `canSign(): boolean | undefined`

Whether the connected wallet can sign (2.10.0). A watch-only wallet connects and reads but has no signing key.

- `true`: the wallet signs.
- `false`: watch-only. Every signing call (`sendTransaction`, `signMessage`, `callContract`, `deployContract`, `signTransaction`, private transfers, claims and proofs) fails with `WATCH_ONLY`, and `getPublicKey()` does too.
- `undefined`: not connected, or the extension does not report it (older than 3.0.3). A missing `publicKey` then hints at watch-only; older extensions refuse signing with `PERMISSION_DENIED`.

The value follows `connect`, `getConnectionStatus` and `accountChanged`.

```typescript
const canSign = wallet.canSign() ?? !!wallet.getConnectionInfo().publicKey;
if (!canSign) showReadOnlyBanner();
```

#### `switchNetwork(networkId: string): Promise<{ network: string; switched: boolean }>`

Ask the wallet to switch its active network. The wallet shows the user a confirmation first (0xio extension 2.5.6 and later, 0xio app 1.3.0 and later, 0xio Desktop 0.4.1 and later); declining rejects with `USER_REJECTED`. The call is also refused while another request from the page is waiting for approval, so a transaction the user is reviewing can never be moved to another network. DApps can still detect a network mismatch and offer the switch.

```typescript
// Check current network
const networkId = wallet.getNetworkId(); // 'mainnet' or 'devnet'

// Switch if wrong network
if (networkId !== 'devnet') {
  try {
    const result = await wallet.switchNetwork('devnet');
    console.log(result.switched); // true once the user confirmed
    // The wallet broadcasts networkChanged automatically
  } catch (e) {
    // USER_REJECTED: the user kept the current network
  }
}
```

**Requires:** Extension v2.3.6+

#### `getNetworkId(): string | null`

Get the extension's current active network.

```typescript
const networkId = wallet.getNetworkId();
// Returns: 'mainnet', 'devnet', or null if not connected
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

Get current network information. As of v2.4.5, this returns the **extension's active network**, not a hardcoded default. If the user switches from mainnet to devnet in the extension, this reflects the change.

```typescript
const network = await wallet.getNetworkInfo();
console.log('Network:', network.name);     // "Octra Mainnet" or "Octra Devnet"
console.log('RPC:', network.rpcUrl);
console.log('Explorer:', network.explorerUrl);
console.log('Privacy:', network.supportsPrivacy); // true on both mainnet and devnet
console.log('Testnet:', network.isTestnet);       // true for devnet
```

**Returns:**

```typescript
interface NetworkInfo {
  id: string;                    // 'mainnet' | 'devnet' | 'custom'
  name: string;                  // Display name
  rpcUrl: string;                // RPC endpoint
  explorerUrl?: string;          // Transaction explorer base URL
  explorerAddressUrl?: string;   // Address explorer base URL
  indexerUrl?: string;           // Indexer/API base URL
  supportsPrivacy: boolean;      // FHE encrypted balance support
  color: string;                 // Brand color hex
  isTestnet: boolean;            // Whether this is a test network
}
```

---

### Transaction Methods

#### `sendTransaction(txData: TransactionData): Promise<TransactionResult>`

Send a public transaction.

```typescript
const result = await wallet.sendTransaction({
  to: 'oct1recipient...',
  amountOct: '100.5',
  message: 'Payment for invoice #123',
  feeLevel: 3 // 1 = standard, 3 = priority
});

console.log('Transaction hash:', result.txHash);
console.log('Finality:', result.finality);
```

**Parameters:**

```typescript
interface TransactionData {
  to: string;                    // Recipient address
  amount?: string | number;      // Raw micro-OCT, passed to the wallet as is (1 OCT = 1000000)
  amountOct?: string | number;   // Amount in OCT; the SDK converts it exactly. One of the two.
  message?: string;              // Optional memo
  feeLevel?: 1 | 3;             // 1 = standard, 3 = priority
  isPrivate?: boolean;           // Private transfer flag
}
```

See [Amounts and units](#5-amounts-and-units) before choosing between `amount` and `amountOct`.

**Returns:**

```typescript
interface TransactionResult {
  txHash: string;
  success: boolean;
  finality?: 'pending' | 'confirmed' | 'rejected';
  message?: string;
  explorerUrl?: string;
}
```

#### `getTransactionHistory(page?, limit?): Promise<TransactionHistory>`

Get transaction history.

```typescript
const history = await wallet.getTransactionHistory(1, 20);

history.transactions.forEach(tx => {
  console.log(`${tx.amount} OCT to ${tx.to}`);
});

console.log('Total:', history.totalCount);
console.log('Page:', history.page);
console.log('Has more:', history.hasMore);
```

**Returns:**

```typescript
interface TransactionHistory {
  transactions: Transaction[];
  totalCount: number;
  page: number;
  hasMore: boolean;
}
```

---

### Smart Contract Methods

#### `callContract(data: ContractCallData): Promise<TransactionResult>`

Execute a state-changing smart contract call. The extension builds, signs, and submits the transaction via `octra_submit`. The user will be shown an approval popup with the contract address and method name.

```typescript
import { ContractCallData } from '@0xio/sdk';

// Swap tokens on a DEX contract
const result = await wallet.callContract({
  contract: 'oct26LiaGUz78Jnby2TWEHcmboKHyupnu1NX1G3Evz28YHm',
  method: 'swap',
  params: [100000, true, 90000],  // AML uses flat args, NOT array-wrapped
  amount: '0',    // Native OCT to send (optional, default '0')
  ou: '10000',    // Operational units (optional, default '10000')
});

console.log('TX Hash:', result.txHash);
```

**Parameters:**

```typescript
import { ContractParams } from '@0xio/sdk';

interface ContractCallData {
  contract: string;             // Contract address (oct-prefixed, 47 chars)
  method: string;               // AML method name
  params: ContractParams;       // Method arguments, flat primitives: [amount, flag]
  amount?: string | number;     // Native OCT to send (default '0')
  ou?: string | number;         // Operational units (default '10000')
}

// ContractParams = ReadonlyArray<string | number | boolean>
```

**Returns:** `Promise<TransactionResult>` with `txHash`, `success`, `finality`

**Notes:**
- AML contract calls use **flat arguments**: `params: [arg1, arg2]` not `params: [[arg1, arg2]]`
- For methods that require sending native OCT (e.g., `wrap`, `deposit`), set the `amount` field
- The extension handles nonce, signing, and broadcasting automatically

---

#### `deployContract(data: ContractDeployData): Promise<ContractDeployResult>`

Deploy a contract from compiled bytecode. The wallet reads the deployer's next nonce, asks the node for the contract address (`octra_computeContractAddress`), and shows a review with the site, the code size, that address, the constructor params, the network and the fee. After approval it signs an `op_type: "deploy"` transaction and submits it with `octra_submit`. Needs the 0xio extension 3.0.0 or later.

```typescript
import { ContractDeployData } from '@0xio/sdk';

const { txHash, contractAddress } = await wallet.deployContract({
  bytecode: compiled.bytecode,   // base64 from octra_compileAml / octra_compileAssembly
  params: ['My Token', 18],      // constructor args (optional): an array or a JSON string
  // ou: '250000',               // fee in OU (optional); omit it to use the live fee
});
```

**Parameters:**

```typescript
interface ContractDeployData {
  bytecode: string;                    // strict base64, max 512 KB decoded
  params?: string | ContractParams;    // constructor args, max 64 KB as JSON
  ou?: string | number;                // 1 to 50,000,000 OU
}
```

**Returns:** `Promise<ContractDeployResult>`: `{ txHash, contractAddress }`.

**Notes:**
- Without `ou` the wallet uses the node's recommended deploy fee, never below the size-based minimum (200,000 OU plus 1,000 OU per started KB of base64 payload). The review shows the fee in OCT (1 OU = 0.000001 OCT).
- The contract address depends on the nonce. If another transaction from the wallet goes out while the review is open and the address changes, nothing is sent and the call rejects with `DEPLOY_CHANGED`.
- A deploy signs with the wallet the review shows; picking another wallet there is refused.

---

#### `contractCallView(data: ContractViewCallData): Promise<any>`

Read-only contract query. Does **not** require wallet unlock, signing, or user approval. Only requires `initialize()` (not `connect()`).

```typescript
// Query contract state
const price = await wallet.contractCallView({
  contract: 'oct26LiaGUz78Jnby2TWEHcmboKHyupnu1NX1G3Evz28YHm',
  method: 'get_active_price',
  params: [],
});
console.log('Active price:', price);

// Query with parameters
const reserves = await wallet.contractCallView({
  contract: 'oct26LiaGUz78Jnby2TWEHcmboKHyupnu1NX1G3Evz28YHm',
  method: 'get_bin_reserves',
  params: [8388608],
  caller: 'oct1youraddress...',  // Optional caller context
});
console.log('Reserves:', reserves);
```

**Parameters:**

```typescript
interface ContractViewCallData {
  contract: string;           // Contract address (oct-prefixed, 47 chars)
  method: string;             // View method name
  params: ContractParams;     // Method arguments, flat primitives: [binId, address]
  caller?: string;            // Optional caller address (defaults to connected address)
}
```

**Returns:** `Promise<any>` - The raw result from the contract method

---

#### `lookupAddress(address?: string, networkId?: string): Promise<string | null>`

The primary name of an address in the Octra Name System, such as `0xio.oct`. Resolves with `null` when the address has no primary name, or when the network has no usable name service (mainnet today, or the name list cannot be read and none was read before). Defaults to the connected address and network. Read only: no review, no fee. The dapp needs the `contract_views` permission.

```typescript
const { address } = await wallet.connect({ permissions: ['read_balance', 'contract_views'] });

const name = await wallet.lookupAddress();
button.textContent = name ?? `${address.slice(0, 6)}...${address.slice(-4)}`;

wallet.on('accountChanged', async () => {
  button.textContent = (await wallet.lookupAddress()) ?? 'Connected';
});
```

**Notes:**
- A name is for display. Keep the address reachable, and never treat the name as proof of who is connected.
- Look it up again when the account or the network changes, and do not keep it longer than about 10 minutes: a name can be transferred or pointed elsewhere.
- The name service already checks that the name is active, is held by that address and points back to it.

---

#### `resolveName(name: string, networkId?: string): Promise<ResolvedName | null>`

What a name points to. `kind` is `wallet` (with `wallet` set to the address), `circle` (with `circle` set to the Circle id) or `none`. Resolves with `null` when the network has no name service. Rejects with `INVALID_PARAMS` for text that is not a valid name.

```typescript
const hit = await wallet.resolveName('0xio.oct');
if (hit?.kind === 'wallet') {
  await wallet.sendTransaction({ to: hit.wallet, amountOct: '1' });
}
```

**Notes:**
- Send to the address, never to the name, and show the address to the user before they confirm.
- Resolve again right before sending. If the address changed since the user typed the name, stop and show the new one.
- The name service contract is not built into the SDK. It is read per network from the name list in the token-lists repo (`ONS_LIST_URL`, `await onsContract(networkId)`), kept for ten minutes, and the contract must then answer `get_contract_info` as the Octra Name System with an interface version this SDK supports. A contract that does not gives `null`, as a network with no name service does. Never take the contract from a page or a link. A page with a Content Security Policy needs `https://raw.githubusercontent.com` in `connect-src`.
- `normalizeOnsName(text)` gives the bare name or `null`, and `isOnsName(text)` is true only for text ending in `.oct` that passes the name rules.

---

#### `getContractStorage(contract: string, key: string): Promise<string | null>`

Read a single key from contract storage. Does **not** require wallet unlock or user approval.

```typescript
const totalSupply = await wallet.getContractStorage(
  'oct7qrpW3T8mXYbZfAZrkLQKGAtD6ZswCf9Px5jPXnfmtiK',
  'total_supply'
);
console.log('Total supply:', totalSupply);

// Returns null if key doesn't exist
const missing = await wallet.getContractStorage(contractAddr, 'nonexistent');
console.log(missing); // null
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `contract` | string | Yes | Contract address |
| `key` | string | Yes | Storage key to read |

**Returns:** `Promise<string | null>` - The storage value, or `null` if not found

---

### Message Signing Methods

#### `signMessage(message: string): Promise<string>`

Sign an arbitrary message with the wallet's private key using Ed25519. The user will be prompted to approve the signature request in the extension popup.

```typescript
// Simple message signing
const signature = await wallet.signMessage("Hello, 0xio!");
console.log("Signature:", signature);

// Authentication challenge
const timestamp = Date.now();
const challenge = `Sign in to MyDApp\nTimestamp: ${timestamp}\nAddress: ${wallet.getAddress()}`;
const authSignature = await wallet.signMessage(challenge);

// API key creation (for 0xio Oracle/Indexer)
const owner = wallet.getAddress();
const ts = Math.floor(Date.now() / 1000);
const apiKeyMessage = `0xio-api-key:${owner}:${ts}`;
const signature = await wallet.signMessage(apiKeyMessage);
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `message` | string | Yes | The text message to sign (must be non-empty) |

**Returns:** `Promise<string>` - Base64-encoded Ed25519 signature (64 bytes)

**The 0xio Signed Message standard.** The wallet never signs the raw message. It signs the framed payload

```
"Octra Signed Message:\n" + utf8ByteLength(message) + "\n" + message
```

as an Ed25519 detached signature over the UTF-8 bytes of that string. The leading `O` guarantees the signed bytes never begin with `{`, so a personal-message signature can never be a valid transaction pre-image. Any verifier MUST reconstruct the same bytes.

#### `verifyMessage(message, signature, publicKey): Promise<boolean>`

Official verifier, using the Web Crypto Ed25519 primitive (zero runtime dependencies).

```typescript
import { verifyMessage } from "@0xio/sdk";

const publicKey = await wallet.getPublicKey();
const valid = await verifyMessage("Hello, 0xio!", signature, publicKey);
```

Web Crypto Ed25519 is available on Node 18+, Chrome 137+, Safari 17+, and Firefox 129+. On an older runtime, verify `getSignedMessageBytes(message)` with your own Ed25519 library instead.

#### `getSignedMessageBytes(message: string): Uint8Array`

Returns the exact bytes `signMessage` produces a signature over. Zero-dependency, so you can verify with any Ed25519 implementation (for example server-side):

```typescript
import { getSignedMessageBytes } from "@0xio/sdk";
import nacl from "tweetnacl";

const ok = nacl.sign.detached.verify(
  getSignedMessageBytes(message),
  base64ToBytes(signature),
  base64ToBytes(publicKey),
);
```

For `signAuthMessage(service, nonce)`, reconstruct the signed string with `buildAuthMessage(service, nonce, origin)` and pass it to `verifyMessage`.

**Throws:**
- `SIGNATURE_FAILED` - If signing fails or message is invalid
- `USER_REJECTED` - If user rejects the signature request
- `WALLET_LOCKED` - If wallet is locked

**Use Cases:**
- **Authentication**: Prove wallet ownership for login/API access
- **Attestation**: Sign data for on-chain verification
- **Authorization**: Approve off-chain actions
- **API Keys**: Create authenticated API credentials

**Security Notes:**
- The message is displayed to the user in the approval popup
- Never sign messages you don't understand
- Include timestamps to prevent replay attacks
- The signature can be verified using the wallet's public key

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

Not served by the 0xio extension: the wallet answers `NOT_AVAILABLE`, and users encrypt from the extension's Privacy screen. Kept for wallets that may implement it.

Encrypt public balance to private balance.

```typescript
// Encrypt 100 OCT from public to private
const success = await wallet.encryptBalance(100);
if (success) {
  console.log('Balance encrypted');
}
```

#### `decryptBalance(amount: number): Promise<boolean>`

Not served by the 0xio extension (see `encryptBalance`).

Decrypt private balance to public balance.

```typescript
// Decrypt 50 OCT from private to public
const success = await wallet.decryptBalance(50);
if (success) {
  console.log('Balance decrypted');
}
```

#### `sendPrivateTransfer(data: PrivateTransferData): Promise<TransactionResult>`

Send an encrypted (stealth) transfer to any address. The extension handles all cryptography:
1. Subtracts the amount from sender's encrypted balance (`ct_sub`)
2. Generates a range proof (proves amount is valid without revealing it)
3. Generates a zero proof (proves the subtraction is correct)
4. Submits the encrypted transaction to the network
5. The node re-encrypts the amount under the recipient's public key

The amount is never visible on-chain, only sender and recipient can see it.

Requires `'private_transfers'` permission and 0xio Wallet Extension v2.4.0+.

```typescript
const result = await wallet.sendPrivateTransfer({
  to: 'octRecipientAddress...',
  amount: 50,
  message: 'Private payment'
});
console.log('TX:', result.txHash);
```

**Use cases:** prediction markets (hidden bets), private payments, stealth transfers, confidential DeFi.

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
  console.log('Connected:', event.data.address);
});

wallet.on('balanceChanged', (event) => {
  console.log('Balance changed:', event.data.newBalance.total);
});
```

**Events:**

| Event | Data | Description |
|-------|------|-------------|
| `connect` | `ConnectEvent` | Wallet connected |
| `disconnect` | `DisconnectEvent` | Wallet disconnected: `disconnect()`, the wallet ended the session (`user_action`), a lock (`extension_locked`) or the 0xio Desktop link dropped (`network_error`) |
| `accountChanged` | `AccountChangedEvent` | User switched account (carries `canSign` from 2.10.0) |
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
  console.log('Connected once:', event.data.address);
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
} from '@0xio/sdk';
```

**Examples:**

```typescript
// Validation
if (isValidAddress('oct1...')) {
  console.log('Valid address');
}

// Formatting
const formatted = formatZeroXIO(123.456789, 2); // "123.46"
const shortAddr = formatAddress('oct1abc...xyz', 6, 4); // "oct1ab...xyz"

// Conversion
const micro = toMicroZeroXIO(1.5); // "1500000"
const oct = fromMicroZeroXIO(1500000); // 1.5

// Error handling
if (isErrorType(error, ErrorCode.INSUFFICIENT_BALANCE)) {
  console.log('Not enough balance');
}

// Async utilities
await delay(1000); // Wait 1 second

const result = await retry(
  () => wallet.getBalance(),
  3, 1000
);

const data = await withTimeout(
  wallet.sendTransaction(txData),
  5000 // 5 second timeout
);
```

---

## Request Lifecycle

Since 2.12.0 (wallet protocol 2). Every call that opens a review or signs gets a request id. The site can store it, follow the request's status, find it again after a reload, and wait for the chain's verdict without its own RPC client. Nothing in the lifecycle ever signs or sends again: a repeated id joins the request or returns its stored outcome, and a timeout ends only the SDK's wait.

### Detection before Connect

#### `wallet.detect(): Promise<DetectResult>` and `detectWallet(options?): Promise<DetectResult>`

No `initialize()` needed; about 300 ms on a normal page; never shows a browser prompt.

```typescript
interface DetectResult {
  injected: { kind: WalletKind; version?: string; protocol: 1 | 2 } | null;
  desktop: 'available' | 'unknown-until-connect' | 'not-running' | 'blocked' | 'not-allowed';
  mobile: boolean;
  openInAppUrl: string | null;   // set on a phone with nothing injected
  next: 'connect' | 'install' | 'open-in-app';
}
```

- `injected` comes from the `0xio:announceWallet` answer to the SDK's `0xio:requestWallet`, else from `window.wallet0xio` (protocol 1, version from `0xioWalletReady`), else `window.ReactNativeWebView` (an old 0xio app build).
- `desktop` is `unknown-until-connect` while Chrome would ask for local network access: any probe would show that prompt to every visitor. `blocked` when the visitor denied it, `not-allowed` with `desktop: false`, outside a secure context, with another wallet's adapter, or on a phone. Otherwise a silent socket and `site_hello` say `available` or `not-running`.
- `detectOptions.detectTimeoutMs` (default 300) bounds the wait for a wallet that injects late.

`initialize()` uses the same window instead of 10 s (10 s stays inside a frame and in the 0xio app's WebView). On `connect()` with the desktop deferred, `connectProgress` (`{ phase: 'local-network-prompt' }`) fires while the prompt is up; a block ends the attempt at once with `EXTENSION_NOT_FOUND` and `details.desktop: 'blocked'`, a refused socket with `'not-running'`.

#### `wallet.walletInfo: WalletInfo | null`

```typescript
type WalletKind = 'extension' | 'desktop' | 'app-ios' | 'app-android' | 'app-expo';
interface WalletInfo { kind: WalletKind; version?: string; protocol: 1 | 2; capabilities: readonly string[] }
```

Set when the transport is chosen, from `wallet_hello` (extension channel) or the `site_hello` reply (0xio Desktop). A protocol 1 wallet reads as `{ protocol: 1, capabilities: [] }`, its kind guessed from the transport and the app's WebView. The SDK switches features on capabilities, never on versions. `wallet.transport` stays `'extension' | 'desktop' | null`.

### Options on review calls

```typescript
interface ReviewOptions {
  requestId?: string;                         // from newRequestId(); store it before the call
  timeoutMs?: number;                         // the SDK's wait; never cancels the review
  onStatus?: (status: RequestStatus) => void; // every status change of this request
}
interface WriteOptions extends ReviewOptions {
  wait?: 'submitted' | 'confirmed';           // default 'submitted'
}
```

| Method | Options | Resolves with |
|---|---|---|
| `connect(options?)` | `ConnectOptions & ReviewOptions` | `ConnectEvent` |
| `switchNetwork(id, options?)` | `ReviewOptions` | `{ network, switched }` |
| `signMessage(message, options?)`, `signAuthMessage(service, nonce, options?)` | `ReviewOptions` | the signature |
| `signTransaction(data, options?)` | `ReviewOptions` | `{ signedTx }` |
| `sendTransaction`, `submitTransaction`, `callContract`, `sendPrivateTransfer`, `claimPrivateTransfer`, `encryptBalance`, `decryptBalance` | `WriteOptions` | `TransactionResult & WriteOutcome` |
| `deployContract(data, options?)` | `WriteOptions` | `ContractDeployResult & WriteOutcome` |
| `registerPrivateViewKey`, `sendContractTransactionSequence` | `WriteOptions` | the wallet's result plus `WriteOutcome` |

```typescript
interface WriteOutcome {
  requestId: string;
  requestStatus: 'submitted' | 'confirmed' | 'completed'; // 'completed' when the write gives no hash
  epoch?: number;                                          // wait: 'confirmed'
  receipt?: ContractReceipt | null;                        // contract calls and deploys, wait: 'confirmed'
  receiptUnavailable?: 'not_contract' | 'refused' | 'error';
}
interface ContractReceipt { contract: string; method: string; success: boolean; effort?: number; events: { event: string; values: unknown }[]; error?: unknown }
```

The field is `requestStatus`, not `status`, so the RFC-O-1 `status` of `TransactionResult` keeps the value the wallet sent. Octra's single call receipt has no return value: a contract that must report a result (shares minted, a queue position) emits it as an event, or the site reads it with `contractCallView` after `confirmed`.

`wait: 'confirmed'` resolves on `confirmed` and rejects with `EXECUTION_FAILED` (`details: { requestId, hash, reason }`) when the chain rejects or drops the transaction, with the usual codes for review and submit failures, and with `STATUS_UNKNOWN` after 10 minutes. A protocol 2 wallet watches the chain and pushes the result; the SDK asks `request_status` after 5 s without news. With a protocol 1 wallet the SDK reads `octra_transaction` through the wallet's `rpc_call` (every 4 s for a minute, then every 10 s) and one `contract_receipt`; when the wallet refuses `rpc_call` it rejects with `UNSUPPORTED_METHOD` and `details.hash`. Never a resend.

### Following a request

```typescript
newRequestId(): string                                          // 32 lowercase hex, 128 random bits
requestStatus(requestId: string): Promise<RequestStatus>
waitForRequest(requestId: string, options?: { until?: 'submitted' | 'final'; timeoutMs?: number; onStatus?: (s: RequestStatus) => void }): Promise<RequestStatus>
cancelRequest(requestId: string): Promise<RequestStatus>        // only before approval
pendingRequest(): { requestId: string; method: string; status: RequestStatusValue } | null
openInAppUrl(url?: string, options?: { scheme?: boolean }): string | null
wallet.on('requestUpdate', (event) => event.data as RequestStatus)
```

```typescript
interface RequestStatus {
  requestId: string;
  status: 'pending' | 'review_open' | 'locked' | 'signing' | 'submitted' | 'confirmed'
        | 'completed' | 'failed' | 'rejected' | 'expired' | 'unknown';
  method?: string;
  network?: string;        // only once the site is connected
  address?: string;        // the signer, only once the site is connected
  hash?: string;           // from 'submitted' on
  epoch?: number;
  receipt?: ContractReceipt | null;
  receiptUnavailable?: 'not_contract' | 'refused' | 'error';
  result?: unknown;        // 'completed', at most 4 KB
  error?: { code: string; message: string; stage: 'review' | 'submit' | 'execution' };
  watching?: boolean;      // false once the wallet stopped watching a 'submitted' tx
  seq: number;             // grows with every change
  createdAt: number;
  updatedAt: number;
}
```

| Status | Meaning | Next |
|---|---|---|
| `pending` | the wallet has it; waits behind another review or prepares one | `locked`, `review_open`, `submitted` (`broadcast_only`), `completed` (nothing to review), `failed`, `rejected` |
| `locked` | waits for unlock; only a connected site sees it | `review_open`, `rejected`, `expired`, `failed` |
| `review_open` | the review is on screen | `signing`, `completed`, `rejected`, `expired`, `failed` |
| `signing` | approved; signing, proofs, submit | `submitted`, `failed` |
| `submitted` | the node accepted it; `hash` is the node's | `confirmed`, `failed` |
| `confirmed`, `completed`, `failed`, `rejected`, `expired` | final, never change | |
| `unknown` | nobody knows the id (never seen, another origin, evicted, restarted) | |

A site that is not connected reaches only the public reads: `ping`, `register_dapp`, `disconnect`, `getConnectionStatus`, network reads, contract view and storage reads, `rpcCall`, `wallet_hello`, `request_status` and `cancel_request`. Everything else answers `NOT_CONNECTED` at once with no review, and no answer to such a site carries an address, public key or balance.

The lock is never visible to a site that is not connected. While the wallet is locked such a site gets the same `getConnectionStatus`, `ping` and `wallet_hello` answers as when it is unlocked, and `NOT_CONNECTED` at once for anything but `connect`, with no review and no unlock prompt. Its `connect` reads `review_open` from the start and keeps the same `seq` and `updatedAt` across the unlock, with no `requestUpdate` at that moment.

`completed` ends a review with no transaction (connect, switch_network, signMessage). Connect from a connected site, a switch to the current network and `registerPrivateViewKey` for a registered account go `pending` to `completed` with no review. `broadcast_only` goes `pending` to `submitted` with no second review: the only valid signature comes from the wallet's own `signTransaction` review, which already showed what was signed. The wallet refuses with `INVALID_PARAMS`, before any review, a `broadcast_only` whose `signedTx.from` is not the connected wallet.

#### `registerPrivateViewKey({ address }, options?)`

Makes the connected wallet able to receive private transfers (its view key on chain) and claim them (a confirmed PVAC key).

| Account | What happens | Statuses | Result |
|---|---|---|---|
| Already registered | Nothing is signed, no review | `pending`, `completed` | `{ status: 'registered', view_pubkey, pvac: true, requestStatus: 'completed' }` |
| Not registered | One review with the live fee, then an empty key switch, which puts the public key (and so the view key) and the PVAC key on chain | `pending`, `review_open`, `signing`, `submitted` (hash), `confirmed` | `{ hash, txHash, requestStatus }`; read `view_pubkey` after `confirmed` |
| `address` is not the connected wallet | Refused before any review | none | `INVALID_PARAMS` |
| Another PVAC key is registered for the account | Refused before any review: a key switch could strand its encrypted balance | none | `PVAC_KEY_MISMATCH` |
| This wallet's registration is submitted and not yet confirmed | Refused before any review | none | `REGISTRATION_PENDING` |
| Balance below the fee | Refused before any review | none | `INSUFFICIENT_BALANCE` |

The checks run in this order: another address, already registered (wins over a pending flag), another key, a pending registration, the balance.

There is no free registration: `octra_registerPublicKey` is a no-op on a BFT network, and the node derives the view key from the public key a transaction carries.

With a protocol 2 wallet `requestStatus` and `requestUpdate` come from the wallet, which keeps records 24 hours (cleared on browser or app restart). With a protocol 1 wallet they come from the SDK's record for the page's lifetime: `pending`, then the call's outcome; `unknown` after a reload. A protocol 1 wallet cannot recognise an id, so the SDK joins a repeated id itself and, once a call with that id timed out, refuses to send it again (`STATUS_UNKNOWN`): a new id is a new review the user sees.

### Timeouts

- A review call's wait ends with `STATUS_UNKNOWN`, `details: { requestId, lastStatus }`. The review stays open; the site asks `requestStatus` or `waitForRequest` later.
- With a protocol 2 wallet the wait counts from the last status change. Default: the transport's wait (180 s, 600 s for private transfers and on 0xio Desktop).
- `NETWORK_ERROR` is a failed link (socket closed, extension gone); on a review call it carries the id and `details.status: 'unknown'`, because the wallet may still finish it.
- 0xio Desktop: a protocol 2 desktop gets no `site_cancel` on a timeout; on page close only reviews not yet approved are cancelled, and an approved request finishes with its outcome kept. A protocol 1 desktop still gets `site_cancel` on a timeout, as in 2.11.0.

### Opening a site in the app

`openInAppUrl(url = location.href)` returns `https://0xio.xyz/open?url=<encoded>` for an https URL without credentials (at most 2048 characters), and null otherwise; `{ scheme: true }` gives `oxio://open?url=<encoded>` for in-app and QR use. The SDK never navigates; put the link on a button. The app shows the site's origin and asks before it opens; the link carries a URL and nothing else.

### Wire protocol (for wallet developers)

| | Extension and app (postMessage) | 0xio Desktop direct (WebSocket) |
|---|---|---|
| Request | `request: { id, method, params, timestamp, v: 2, rid? }` | `site_request { v: 1, _id, id, network, rid?, request }` |
| Hello | `wallet_hello { sdk, protocols: [1, 2] }` answered `{ protocol: 2, kind, version, capabilities }` | `protocol` and `capabilities` in the `site_hello` reply |
| Status | `request_status { rid }` | `site_status { v: 1, _id, rid }`, reply `{ result }` |
| Cancel | `cancel_request { rid }` | `site_cancel { id?, rid }` |
| Event | `event: { type: 'requestUpdate', data: RequestStatus }` | `site_event` kind `request` |

- Capabilities: `announce`, `request_id`, `request_status`, `request_events`, `idempotent`, `wait_confirmed`, `receipt`, `can_sign`, `kind`.
- `rid`: 32 lowercase hex, only on review methods; anything else is `INVALID_PARAMS`. Records are keyed by origin (from the browser, never from params) and `rid`.
- An error answer carries `rid` and `status` at the top level and in `error.details` as `{ requestId, status }`. The SDK reads `status` from `error.status`, `error.details.status` or the top level, in that order; it knows the id itself.
- Same request: sha256 of the canonical JSON of `{ method, network, params }` (keys sorted by code point, no whitespace); `network` is the frame's network on Desktop and `null` on postMessage channels, which carry none.
- Rate limits: `RATE_LIMITED` for more than 20 requests a second from a page (always an answer, never a drop), `RATE_LIMIT_EXCEEDED` for a 9th open request of a site.
- The conformance suite in `conformance/` checks every rule; see `conformance/README.md`.

## Advanced Usage

### Built-in Networks

The SDK includes pre-configured network definitions:

```typescript
import { NETWORKS, getNetworkConfig, getAllNetworks } from '@0xio/sdk';

// Get a specific network
const devnet = getNetworkConfig('devnet');
console.log(devnet.rpcUrl);           // https://devnet.octrascan.io
console.log(devnet.supportsPrivacy);  // true (FHE enabled)
console.log(devnet.isTestnet);        // true

const mainnet = getNetworkConfig('mainnet');
console.log(mainnet.rpcUrl);          // https://octra.network
console.log(mainnet.supportsPrivacy); // true

// List all available networks
const all = getAllNetworks();
all.forEach(n => console.log(n.id, n.name));
```

| Network | RPC | Privacy (FHE) | Testnet |
|---------|-----|:---:|:---:|
| Mainnet | `https://octra.network` | Yes | No |
| Devnet | `https://devnet.octrascan.io` | Yes | Yes |
| Custom | User-defined | No | No |

### Custom Network Configuration

```typescript
const wallet = new ZeroXIOWallet({
  appName: 'My DApp',
  networkId: 'custom'
});

// User can configure custom network in wallet extension
```

### Transaction with Priority Fee

```typescript
const result = await wallet.sendTransaction({
  to: 'oct1...',
  amountOct: '100',
  feeLevel: 3 // 1 = standard, 3 = priority
});
```

### Handling Bulk Transactions

```typescript
const recipients = [
  { to: 'oct1...', amountOct: '10' },
  { to: 'oct2...', amountOct: '20' },
  { to: 'oct3...', amountOct: '30' }
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
}
```

---

## Wallet Adapter System

The SDK uses a pluggable transport adapter pattern. Each adapter encapsulates the wire protocol for one wallet (detection, request posting, response parsing, and ready-signaling). You can add support for any wallet by dropping a single file in `src/supports/`.

### WalletTransportAdapter interface

```typescript
import type { WalletTransportAdapter, AdapterRequest, AdapterIncomingMessage } from '@0xio/sdk';

interface WalletTransportAdapter {
  /** Short machine-readable name, e.g. 'mywallet' */
  readonly name: string;
  /** Human-readable label, e.g. 'My Wallet' */
  readonly displayName: string;

  /** Return true if this wallet is present in the current page */
  detect(): boolean;

  /** Send a request to the wallet (page-level transport) */
  postRequest(request: AdapterRequest): void;

  /** Send a request to a parent frame (optional, for iframe bridge support) */
  postRequestToParent?(request: AdapterRequest, parentOrigin: string): void;

  /**
   * Subscribe to wallet responses and events.
   * Returns a teardown function, call it to unsubscribe.
   */
  listen(
    handler: (msg: AdapterIncomingMessage) => void,
    options?: { trustedParentOrigins?: string[] }
  ): () => void;

  /** Subscribe to the wallet's "ready" signal (optional) */
  listenForReady?(onReady: () => void): () => void;
}
```

`AdapterRequest` and `AdapterIncomingMessage`:

```typescript
interface AdapterRequest {
  id: string;
  method: string;
  params: unknown;
  timestamp: number;
}

interface AdapterIncomingMessage {
  requestId?: string;   // present on responses
  success?: boolean;
  data?: unknown;
  error?: { code: string; message: string; details?: unknown };
  eventType?: string;   // present on push events
  eventData?: unknown;
}
```

### SDKConfig.adapter

Pass your adapter directly to `ZeroXIOWallet`:

```typescript
import { ZeroXIOWallet } from '@0xio/sdk';
import { MyWalletAdapter } from '@0xio/sdk/supports/my-wallet';

const wallet = new ZeroXIOWallet({
  appName: 'My DApp',
  adapter: MyWalletAdapter
});
```

If `adapter` is omitted, the SDK defaults to `ZeroXIOAdapter` (the built-in 0xio extension adapter).

### Auto-detect

```typescript
import { detectWalletAdapter, ZeroXIOWallet } from '@0xio/sdk';

const adapter = detectWalletAdapter(); // first registered adapter whose detect() returns true
if (!adapter) throw new Error('No supported wallet detected');

const wallet = new ZeroXIOWallet({ appName: 'My DApp', adapter });
```

### List all registered adapters

```typescript
import { getAllAdapters } from '@0xio/sdk';

const adapters = getAllAdapters();
adapters.forEach(a => console.log(a.name, a.detect() ? 'detected' : 'not detected'));
```

### Adding a new wallet adapter

1. **Copy the template**: `src/supports/template.ts` to `src/supports/my-wallet.ts`
2. **Fill in the constants**:
   ```typescript
   const REQUEST_SOURCE  = 'wallet-sdk-request';  // outbound message source
   const RESPONSE_SOURCE = 'wallet-sdk-bridge';   // inbound message source
   const WINDOW_KEY      = 'myWallet';            // window property the wallet injects
   const READY_EVENT     = 'myWalletReady';       // CustomEvent fired when ready
   ```
3. **Map the message shape** in `listen()` to `AdapterIncomingMessage`
4. **Register** it in `src/supports/index.ts`:
   ```typescript
   import { MyWalletAdapter } from './my-wallet';

   const REGISTERED_ADAPTERS: WalletTransportAdapter[] = [
     ZeroXIOAdapter,
     MyWalletAdapter,  // add here; detection runs in order, first match wins
   ];
   ```
5. **Export** from `src/index.ts` if it should be part of the public API

### Built-in adapters

| Name | File | Detects | Priority |
|------|------|---------|----------|
| `zeroxio` | `src/supports/0xio.ts` | `window.wallet0xio`, `window.ZeroXIOWallet`, Chrome extension, meta tags | 1st |
| `octra-provider` | `src/supports/octra-provider.ts` | `window.octra.isOctra === true` (RFC-O-1) | 2nd |

`ZeroXIOAdapter` always takes priority when `window.wallet0xio` or `window.ZeroXIOWallet` is present, existing DApps built on the 0xio postMessage bridge are unaffected. `OctraProviderAdapter` is used when only `window.octra` is available (third-party RFC-O-1 wallets) or when passed explicitly.

### What each adapter can reach

The postMessage bridge carries every SDK method. The RFC-O-1 provider carries only what the RFC names, so a few SDK methods have no equivalent there.

| SDK method | 0xio bridge | RFC-O-1 provider |
|------------|-------------|------------------|
| connect, disconnect, getConnectionStatus, getNetworkInfo, switchNetwork | yes | yes |
| sendTransaction, signTransaction, submitTransaction, callContract, deployContract, contractCallView | yes | yes |
| signMessage, signAuthMessage | yes | yes |
| sendPrivateTransfer, claimPrivateTransfer, getPrivateBalanceInfo | yes | yes |
| getPrivateCapabilities, encryptValue, decryptValue, makeZeroProof, makeRangeProof, getPrivateBalance, registerPrivateViewKey, sendContractTransactionSequence | yes | yes |
| getBalance, getPublicKey, getTransactionHistory, getContractStorage, getPendingPrivateTransfers, rpcCall | yes | no |
| encryptBalance, decryptBalance | refused by the wallet | refused by the wallet |

Timeouts: interactive methods wait up to 3 minutes for the approval; `sendPrivateTransfer` waits up to 10 minutes because the wallet builds proofs after the approval; `claimPrivateTransfer` opens an approval window too.

### Security note

The built-in `ZeroXIOAdapter` validates a per-session nonce on every inbound message. The nonce is established over a `MessageChannel` private port at `document_start`, before any page scripts run. Page scripts cannot observe port messages, so they cannot forge valid responses.

---

## Framework Integration

### React

```tsx
import React, { useState, useEffect } from 'react';
import { ZeroXIOWallet, Balance } from '@0xio/sdk';

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
        setAddress(event.data.address);
        setBalance(event.data.balance);
      });

      wallet.on('disconnect', () => {
        setConnected(false);
        setAddress(null);
        setBalance(null);
      });

      wallet.on('balanceChanged', (event) => {
        setBalance(event.data.newBalance);
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
import { ZeroXIOWallet, Balance } from '@0xio/sdk';

const wallet = new ZeroXIOWallet({ appName: 'My Vue DApp' });
const connected = ref(false);
const address = ref<string | null>(null);
const balance = ref<Balance | null>(null);

onMounted(async () => {
  await wallet.initialize();

  wallet.on('connect', (event) => {
    connected.value = true;
    address.value = event.data.address;
    balance.value = event.data.balance;
  });

  wallet.on('disconnect', () => {
    connected.value = false;
    address.value = null;
    balance.value = null;
  });

  wallet.on('balanceChanged', (event) => {
    balance.value = event.data.newBalance;
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
  import { ZeroXIOWallet, type Balance } from '@0xio/sdk';

  const wallet = new ZeroXIOWallet({ appName: 'My Svelte DApp' });
  let connected = false;
  let address: string | null = null;
  let balance: Balance | null = null;

  onMount(async () => {
    await wallet.initialize();

    wallet.on('connect', (event) => {
      connected = true;
      address = event.data.address;
      balance = event.data.balance;
    });

    wallet.on('disconnect', () => {
      connected = false;
      address = null;
      balance = null;
    });

    wallet.on('balanceChanged', (event) => {
      balance = event.data.newBalance;
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
  SIGNATURE_FAILED = 'SIGNATURE_FAILED',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  WALLET_LOCKED = 'WALLET_LOCKED',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
  // RPC error types from octra_submit and octra_submitBatch
  MALFORMED_TRANSACTION = 'MALFORMED_TRANSACTION',
  SELF_TRANSFER = 'SELF_TRANSFER',
  SENDER_NOT_FOUND = 'SENDER_NOT_FOUND',
  INVALID_SIGNATURE = 'INVALID_SIGNATURE',
  DUPLICATE_TRANSACTION = 'DUPLICATE_TRANSACTION',
  NONCE_TOO_FAR = 'NONCE_TOO_FAR',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  // Returned by the 0xio wallet over the bridge
  NOT_CONNECTED = 'NOT_CONNECTED',              // connect() first
  INVALID_PARAMS = 'INVALID_PARAMS',
  METHOD_NOT_ALLOWED = 'METHOD_NOT_ALLOWED',    // rpcCall with a method outside the allow-list
  NOT_AVAILABLE = 'NOT_AVAILABLE',              // encryptBalance / decryptBalance
  PRIVATE_PROOF_FAILED = 'PRIVATE_PROOF_FAILED',
  PRIVATE_TRANSFER_FAILED = 'PRIVATE_TRANSFER_FAILED',
  CONTRACT_CALL_FAILED = 'CONTRACT_CALL_FAILED',
  SIGN_FAILED = 'SIGN_FAILED',
  RECIPIENT_NOT_REGISTERED = 'RECIPIENT_NOT_REGISTERED',
  DEPLOY_FAILED = 'DEPLOY_FAILED',
  DEPLOY_CHANGED = 'DEPLOY_CHANGED',            // the contract address moved during the review
  WATCH_ONLY = 'WATCH_ONLY',                    // the wallet is watch-only and cannot sign (2.10.0)
  UNSUPPORTED_METHOD = 'UNSUPPORTED_METHOD',
  NETWORK_CHANGED = 'NETWORK_CHANGED',
  WALLET_CHANGED = 'WALLET_CHANGED',
  STATUS_UNKNOWN = 'STATUS_UNKNOWN',            // the SDK stopped waiting; the wallet may still finish (2.12.0)
  REQUEST_ID_REUSED = 'REQUEST_ID_REUSED',      // the id belongs to another request (2.12.0)
  EXECUTION_FAILED = 'EXECUTION_FAILED',        // wait: 'confirmed' and the chain rejected or dropped it (2.12.0)
  PVAC_KEY_MISMATCH = 'PVAC_KEY_MISMATCH',      // registerPrivateViewKey: another key is registered for the account (2.12.0)
  REGISTRATION_PENDING = 'REGISTRATION_PENDING' // registerPrivateViewKey: this wallet's registration is unconfirmed (2.12.0)
}
```

Errors of review calls carry the request id in `error.requestId` and `error.details.requestId`. `RATE_LIMIT_EXCEEDED` names its cause in `details.reason`:

| `details.reason` | Cause | Wire code from the wallet |
|---|---|---|
| `review_pending` | another review of this page is open (`details.requestId`, `details.status` name it) | none, the SDK refuses before sending |
| `requests_per_second` | more than 20 requests a second from the page | `RATE_LIMITED` |
| `open_requests` | 8 requests of the site already wait in the wallet | `RATE_LIMIT_EXCEEDED` |

The wallet refuses anything that signs, submits or changes state until the page has connected, and a page can open the unlock screen at most once a minute. Both come back as `NOT_CONNECTED` or `WALLET_LOCKED`. While the wallet is locked, `getBalance` and the private balance reads also return `WALLET_LOCKED` (extension 3.0.0 and newer).

### Error Handling Pattern

```typescript
import { ZeroXIOWalletError, ErrorCode, isErrorType } from '@0xio/sdk';

try {
  const result = await wallet.sendTransaction(txData);

} catch (error) {
  if (error instanceof ZeroXIOWalletError) {
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

      // RPC-level transaction errors
      case ErrorCode.MALFORMED_TRANSACTION:
        showError('Transaction is malformed');
        break;

      case ErrorCode.SELF_TRANSFER:
        showError('Cannot send to yourself');
        break;

      case ErrorCode.DUPLICATE_TRANSACTION:
        showError('This transaction was already submitted');
        break;

      case ErrorCode.INVALID_SIGNATURE:
        showError('Invalid transaction signature');
        break;

      case ErrorCode.NONCE_TOO_FAR:
        showError('Transaction nonce is too far ahead, try again');
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
  console.error('Wallet error:', errorEvent.data.error);

  // Show user-friendly message
  if (errorEvent.data.error.code === ErrorCode.NETWORK_ERROR) {
    showNotification('Network connection lost. Retrying...');
  }
});
```

---

## Security

### Best Practices

1. **Always Validate Inputs**

```typescript
import { isValidAddress, isValidAmount } from '@0xio/sdk';

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

3. **Message Signing Security**

When implementing message signing, follow these practices:

```typescript
// GOOD: Include timestamp to prevent replay attacks
const timestamp = Date.now();
const message = `Login to MyDApp\nTimestamp: ${timestamp}`;
const signature = await wallet.signMessage(message);

// GOOD: Include nonce for one-time use
const nonce = crypto.randomUUID();
const message = `Authorize action\nNonce: ${nonce}`;

// BAD: Never sign messages you don't understand
// BAD: Never sign raw transaction data as "messages"
// BAD: Never sign messages without showing user the content
```

**Verification:** To verify signatures, use the wallet's public key with Ed25519 verification.

4. **Verify Network**

```typescript
const network = await wallet.getNetworkInfo();
if (network.isTestnet) {
  console.warn('Connected to testnet:', network.name);
  // Show warning to user
}

// Check privacy support before using FHE features
if (network.supportsPrivacy) {
  const balance = await wallet.getBalance();
  console.log('Private balance:', balance.private);
}
```

5. **Handle User Rejections Gracefully**

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

6. **Implement Timeouts**

```typescript
import { withTimeout } from '@0xio/sdk';

try {
  const result = await withTimeout(
    wallet.sendTransaction(txData),
    30000 // 30 second timeout
  );
} catch (error) {
  if (isErrorType(error, ErrorCode.NETWORK_ERROR)) {
    console.error('Transaction timed out');
  }
}
```

7. **Rate Limiting**

The SDK enforces rate limits:
- Max 20 requests per second
- Max 50 concurrent requests

Implement your own rate limiting for bulk operations:

```typescript
import { delay } from '@0xio/sdk';

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
// Bad: Creating multiple instances
function MyComponent() {
  const wallet = new ZeroXIOWallet({ appName: 'App' });
  // ...
}

// Good: Single instance
const wallet = new ZeroXIOWallet({ appName: 'App' });
export { wallet };
```

### 2. Clean Up Event Listeners

```typescript
// Good: Remove listeners when component unmounts
useEffect(() => {
  const handleBalance = (event) => {
    setBalance(event.data.newBalance);
  };

  wallet.on('balanceChanged', handleBalance);

  return () => {
    wallet.off('balanceChanged', handleBalance);
  };
}, []);
```

### 3. Cache Balances

```typescript
// Good: Use cached balance
const balance = await wallet.getBalance(); // Fast, uses cache

// Only force refresh when necessary
const freshBalance = await wallet.getBalance(true); // Slower, fetches from network
```

### 4. Handle Connection State

```typescript
// Good: Check connection before operations
async function sendMoney(to: string, amount: number) {
  if (!wallet.isConnected()) {
    await wallet.connect();
  }

  return await wallet.sendTransaction({ to, amount });
}
```

### 5. User Feedback

```typescript
// Good: Show loading states
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
    window.open('https://chromewebstore.google.com/detail/0xio-wallet/anknhjilldkeelailocijnfibefmepcc');
  }
}
```

### Events Not Firing

**Problem:** Event listeners not receiving events

**Solutions:**
1. Ensure wallet is initialized
2. Check listener is registered before event occurs
3. Verify event name spelling

```typescript
// Register listener before connecting
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
  updateUI(event.data.newBalance);
});

// Or force refresh
const balance = await wallet.getBalance(true);
```

### Transaction Fails Silently

**Problem:** Transaction fails without error

**Solution:** Add proper error handling

```typescript
wallet.on('error', (event) => {
  console.error('Wallet error:', event.data.error);
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

- **Issues**: [GitHub Issues](https://github.com/0xio-xyz/0xio-sdk/issues)
- **Documentation**: [0xio Docs](https://docs.0xio.xyz)
- **Website**: [0xio.xyz](https://0xio.xyz)

## License

MIT License - See [LICENSE](LICENSE) file for details

---

**Built by 0xio Labs for the Octra Network ecosystem**
