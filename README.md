# 0xio Wallet SDK

A comprehensive TypeScript/JavaScript SDK that enables seamless integration between decentralized applications (DApps) and the 0xio Wallet browser extension. This toolkit provides developers with a secure, type-safe, and user-friendly way to interact with the Octra blockchain network.

## What is this SDK?

The 0xio Wallet SDK bridges the gap between web applications and blockchain functionality, allowing developers to:

- **Connect to 0xio Wallet**: Establish secure connections with users' 0xio wallet extensions
- **Manage Transactions**: Send regular and private transactions with full type safety
- **Handle Balances**: Read public and encrypted private balance information
- **Event-Driven Architecture**: React to wallet events like balance changes, network switches, and connection status
- **Private Features**: Support for Octra Network's unique private balance encryption and private transfer system
- **Multi-Framework Support**: Works with React, Vue, Svelte, and vanilla JavaScript applications

## Why use this SDK?

- **Security First**: Only authenticated DApps with proper SDK integration can connect
- **TypeScript Native**: Full type definitions for better development experience
- **Smart Extension Detection**: Built-in extension monitoring with automatic retry logic
- **Event-Driven Architecture**: Real-time updates replace polling for better performance
- **Robust Error Handling**: Detailed diagnostics with automatic retry and exponential backoff
- **Framework Agnostic**: Compatible with any JavaScript framework or vanilla JS
- **Developer Friendly**: Advanced debugging tools and development mode logging
- **Production Ready**: Clean builds with zero console noise in production

> **Disclaimer**: This is an unofficial, community-built project for the Octra Network. It is not affiliated with, endorsed by, or maintained by the official Octra team.

> **Note**: This SDK is developed by 0xio Team for the Octra Network ecosystem.

## What's New in v2.0.1

**Breaking Changes & Rebranding:**

- **Rebranded message protocol**: Changed from `octra-sdk-*` to `0xio-sdk-*` for consistency
- **Organization migration**: Moved from personal to organization repository
- **Requires**: 0xio Wallet extension v2.0+ for compatibility

**Previous Major Release - v1.0.0**

**Major Performance & Reliability Improvements:**

- **Built-in Extension Detection**: No more manual polling - SDK automatically detects extension availability
- **Automatic Retry Logic**: Exponential backoff retry system (3 attempts: 1s → 2s → 4s)  
- **Enhanced Error Diagnostics**: Detailed failure context with browser/extension state information
- **Event-Based Communication**: Real-time extension events replace polling for instant updates
- **Advanced Development Tools**: Rich debugging with browser console utilities
- **Production-Safe Logging**: Zero console output in production builds

[View Full Changelog](./CHANGELOG.md)

## Quick Start

### Installation

```bash
# npm
npm install @0xgery/0xio-sdk

# yarn
yarn add @0xgery/0xio-sdk

# CDN (for quick testing)
<script src="https://unpkg.com/@0xgery/0xio-sdk@2.0.1/dist/index.umd.js"></script>
```

### Basic Usage

```typescript
import { ZeroXIOWallet } from '@0xgery/0xio-sdk';

// Create wallet instance
const wallet = new ZeroXIOWallet({
  appName: 'My Awesome DApp',
  appDescription: 'A revolutionary decentralized application',
  requiredPermissions: ['read_balance', 'send_transactions']
});

// Initialize and connect
await wallet.initialize();
const connection = await wallet.connect();

console.log('Connected!', connection.address);

// Get balance
const balance = await wallet.getBalance();
console.log('Balance:', balance.total, 'OCT');

// Send transaction
const result = await wallet.sendTransaction({
  to: 'recipient_address',
  amount: 10.5,
  message: 'Hello from my DApp!'
});

console.log('Transaction sent:', result.txHash);
```

### Simple Setup (Auto-connect)

```javascript
import { createZeroXIOWallet } from '@0xgery/0xio-sdk';

const wallet = await createZeroXIOWallet({
  appName: 'My DApp',
  autoConnect: true,
  debug: true
});

if (wallet.isConnected()) {
  const balance = await wallet.getBalance();
  console.log('Balance:', balance.total, 'OCT');
}
```

## API Reference

### ZeroXIOWallet Class

#### Constructor

```typescript
new ZeroXIOWallet(config: SDKConfig)
```

**SDKConfig:**
```typescript
interface SDKConfig {
  appName: string;                    // Required: Your DApp name
  appDescription?: string;            // App description for user
  appVersion?: string;               // App version (default: '1.0.0')
  appUrl?: string;                   // App URL (auto-detected)
  appIcon?: string;                  // App icon URL
  requiredPermissions?: Permission[]; // Required permissions
  networkId?: string;                // Target network ('mainnet', 'testnet')
  debug?: boolean;                   // Enable debug logging
}
```

#### Methods

##### Initialize
```typescript
await wallet.initialize(): Promise<boolean>
```
Initialize the SDK. Must be called before any other methods.

##### Connection Management
```typescript
await wallet.connect(options?: ConnectOptions): Promise<ConnectEvent>
await wallet.disconnect(): Promise<void>
wallet.isConnected(): boolean
wallet.getConnectionInfo(): ConnectionInfo
```

##### Wallet Information
```typescript
wallet.getAddress(): string | null
await wallet.getBalance(forceRefresh?: boolean): Promise<Balance>
await wallet.getNetworkInfo(): Promise<NetworkInfo>
```

##### Transactions
```typescript
await wallet.sendTransaction(txData: TransactionData): Promise<TransactionResult>
await wallet.getTransactionHistory(page?: number, limit?: number): Promise<TransactionHistory>
```

##### Private Features
```typescript
await wallet.getPrivateBalanceInfo(): Promise<PrivateBalanceInfo>
await wallet.encryptBalance(amount: number): Promise<boolean>
await wallet.decryptBalance(amount: number): Promise<boolean>
await wallet.sendPrivateTransfer(data: PrivateTransferData): Promise<TransactionResult>
await wallet.getPendingPrivateTransfers(): Promise<PendingPrivateTransfer[]>
await wallet.claimPrivateTransfer(transferId: string): Promise<TransactionResult>
```

##### Event Handling
```typescript
wallet.on(event: WalletEventType, listener: (data) => void): void
wallet.off(event: WalletEventType, listener: Function): void
wallet.once(event: WalletEventType, listener: (data) => void): void
```

**Events:**
- `connect` - Wallet connected
- `disconnect` - Wallet disconnected  
- `accountChanged` - Account switched
- `balanceChanged` - Balance updated
- `networkChanged` - Network switched
- `transactionConfirmed` - Transaction confirmed
- `error` - Error occurred
- `extensionLocked` - Extension was locked
- `extensionUnlocked` - Extension was unlocked

### Utility Functions

The SDK now exports useful utility functions:

```typescript
import {
  // Validation utilities
  isValidAddress,
  isValidAmount,
  isValidMessage,
  isValidFeeLevel,
  isValidNetworkId,
  
  // Formatting utilities
  formatZeroXIO,
  formatAddress,
  formatTimestamp,
  formatTxHash,

  // Conversion utilities
  toMicroZeroXIO,
  fromMicroZeroXIO,
  
  // Error utilities
  createErrorMessage,
  isErrorType,
  
  // Async utilities
  delay,
  retry,
  withTimeout,
  
  // Browser utilities
  isBrowser,
  checkBrowserSupport,
  
  // Development utilities
  generateMockData,
  createLogger
} from '@0xgery/0xio-sdk';

// Example usage
const isValid = isValidAddress('octxyz123...');
const formatted = formatOCT(123.456789, 2); // "123.46"
const shortAddr = formatAddress('octxyz123...abc', 6, 4); // "octxyz...abc"
```

### Development & Debugging Tools

The SDK includes advanced debugging tools available in development environments:

```javascript
// Available at window.__ZEROXIO_SDK_UTILS__ in development
window.__ZEROXIO_SDK_UTILS__.enableDebugMode();   // Enable detailed logging
window.__ZEROXIO_SDK_UTILS__.disableDebugMode();  // Disable logging
window.__ZEROXIO_SDK_UTILS__.getSDKInfo();        // Get SDK version info
window.__ZEROXIO_SDK_UTILS__.simulateExtensionEvent('balanceChanged', data); // Test events
window.__ZEROXIO_SDK_UTILS__.showWelcome();       // Show SDK welcome message
```

**Automatic Development Detection:**
- Localhost and development domains automatically enable debug utilities
- Rich console output with grouped logging and clear indicators  
- Extension state monitoring and diagnostics
- Event simulation for testing
- Zero production overhead

## Integration Examples

### React Integration

```jsx
import React, { useState, useEffect } from 'react';
import { ZeroXIOWallet, createZeroXIOWallet } from '@0xgery/0xio-sdk';

function WalletConnector() {
  const [wallet, setWallet] = useState(null);
  const [connected, setConnected] = useState(false);
  const [address, setAddress] = useState('');
  const [balance, setBalance] = useState(0);

  useEffect(() => {
    async function initWallet() {
      try {
        const walletInstance = await createZeroXIOWallet({
          appName: 'My React DApp',
          debug: process.env.NODE_ENV === 'development'
        });

        // Setup event listeners
        walletInstance.on('connect', (event) => {
          setConnected(true);
          setAddress(event.address);
          setBalance(event.balance.total);
        });

        walletInstance.on('disconnect', () => {
          setConnected(false);
          setAddress('');
          setBalance(0);
        });

        walletInstance.on('balanceChanged', (event) => {
          setBalance(event.newBalance.total);
        });

        setWallet(walletInstance);
      } catch (error) {
        console.error('Failed to initialize wallet:', error);
      }
    }

    initWallet();
  }, []);

  const connect = async () => {
    try {
      await wallet.connect();
    } catch (error) {
      alert('Connection failed: ' + error.message);
    }
  };

  const sendTransaction = async () => {
    try {
      const result = await wallet.sendTransaction({
        to: 'recipient_address',
        amount: 1,
        message: 'Test from React DApp'
      });
      alert('Transaction sent: ' + result.txHash);
    } catch (error) {
      alert('Transaction failed: ' + error.message);
    }
  };

  return (
    <div>
      <h2>0xio Wallet Integration</h2>

      {!connected ? (
        <button onClick={connect} disabled={!wallet}>
          {wallet ? 'Connect Wallet' : 'Loading...'}
        </button>
      ) : (
        <div>
          <p>Connected: {address}</p>
          <p>Balance: {balance} Oct</p>
          <button onClick={() => wallet.disconnect()}>Disconnect</button>
          <button onClick={sendTransaction}>Send Test Transaction</button>
        </div>
      )}
    </div>
  );
}

export default WalletConnector;
```

### Vue.js Integration

```vue
<template>
  <div>
    <h2>0xio Wallet Integration</h2>

    <div v-if="!connected">
      <button @click="connect" :disabled="!wallet">
        {{ wallet ? 'Connect Wallet' : 'Loading...' }}
      </button>
    </div>

    <div v-else>
      <p>Connected: {{ address }}</p>
      <p>Balance: {{ balance }} OCT</p>
      <button @click="disconnect">Disconnect</button>
      <button @click="sendTransaction">Send Test Transaction</button>
    </div>
  </div>
</template>

<script>
import { createZeroXIOWallet } from '@0xgery/0xio-sdk';

export default {
  data() {
    return {
      wallet: null,
      connected: false,
      address: '',
      balance: 0
    };
  },
  
  async mounted() {
    try {
      this.wallet = await createZeroXIOWallet({
        appName: 'My Vue DApp',
        debug: process.env.NODE_ENV === 'development'
      });

      // Setup event listeners
      this.wallet.on('connect', (event) => {
        this.connected = true;
        this.address = event.address;
        this.balance = event.balance.total;
      });

      this.wallet.on('disconnect', () => {
        this.connected = false;
        this.address = '';
        this.balance = 0;
      });
    } catch (error) {
      console.error('Failed to initialize wallet:', error);
    }
  },
  
  methods: {
    async connect() {
      try {
        await this.wallet.connect();
      } catch (error) {
        alert('Connection failed: ' + error.message);
      }
    },
    
    async disconnect() {
      await this.wallet.disconnect();
    },
    
    async sendTransaction() {
      try {
        const result = await this.wallet.sendTransaction({
          to: 'recipient_address',
          amount: 1,
          message: 'Test from Vue DApp'
        });
        alert('Transaction sent: ' + result.txHash);
      } catch (error) {
        alert('Transaction failed: ' + error.message);
      }
    }
  }
};
</script>
```

### Vanilla JavaScript Integration

```html
<!DOCTYPE html>
<html>
<head>
    <title>0xio Wallet Integration</title>
    <script src="https://unpkg.com/@0xgery/0xio-sdk/dist/index.umd.js"></script>
</head>
<body>
    <div id="app">
        <h2>0xio Wallet Integration</h2>
        <div id="connection-status">Loading...</div>
        <button id="connect-btn" style="display: none;">Connect Wallet</button>
        <button id="disconnect-btn" style="display: none;">Disconnect</button>
        <button id="send-btn" style="display: none;">Send Transaction</button>
    </div>

    <script>
        let wallet;

        async function initWallet() {
            try {
                wallet = await ZeroXIOWalletSDK.createZeroXIOWallet({
                    appName: 'My Vanilla JS DApp',
                    debug: true
                });

                // Setup event listeners
                wallet.on('connect', (event) => {
                    document.getElementById('connection-status').textContent =
                        `Connected: ${event.address} (${event.balance.total} OCT)`;
                    document.getElementById('connect-btn').style.display = 'none';
                    document.getElementById('disconnect-btn').style.display = 'inline';
                    document.getElementById('send-btn').style.display = 'inline';
                });

                wallet.on('disconnect', () => {
                    document.getElementById('connection-status').textContent = 'Disconnected';
                    document.getElementById('connect-btn').style.display = 'inline';
                    document.getElementById('disconnect-btn').style.display = 'none';
                    document.getElementById('send-btn').style.display = 'none';
                });

                // Show connect button
                document.getElementById('connection-status').textContent = 'Ready to connect';
                document.getElementById('connect-btn').style.display = 'inline';
                
            } catch (error) {
                document.getElementById('connection-status').textContent = 'Error: ' + error.message;
                console.error('Failed to initialize wallet:', error);
            }
        }

        // Event handlers
        document.getElementById('connect-btn').addEventListener('click', async () => {
            try {
                await wallet.connect();
            } catch (error) {
                alert('Connection failed: ' + error.message);
            }
        });

        document.getElementById('disconnect-btn').addEventListener('click', async () => {
            await wallet.disconnect();
        });

        document.getElementById('send-btn').addEventListener('click', async () => {
            try {
                const result = await wallet.sendTransaction({
                    to: 'recipient_address',
                    amount: 1,
                    message: 'Test from Vanilla JS DApp'
                });
                alert('Transaction sent: ' + result.txHash);
            } catch (error) {
                alert('Transaction failed: ' + error.message);
            }
        });

        // Initialize on page load
        initWallet();
    </script>
</body>
</html>
```

## Security Best Practices

### 1. Input Validation
```typescript
import { isValidAddress, isValidAmount } from '@0xgery/0xio-sdk';

// Always validate user inputs
const recipientAddress = userInput.trim();
if (!isValidAddress(recipientAddress)) {
  throw new Error('Invalid recipient address');
}

const amount = parseFloat(userAmountInput);
if (!isValidAmount(amount)) {
  throw new Error('Invalid transaction amount');
}
```

### 2. Enhanced Error Handling
```typescript
import { ZeroXIOWalletError, ErrorCode, isErrorType } from '@0xgery/0xio-sdk';

try {
  await wallet.sendTransaction(txData);
} catch (error) {
  if (isErrorType(error, ErrorCode.INSUFFICIENT_BALANCE)) {
    alert('Not enough balance for this transaction');
  } else if (isErrorType(error, ErrorCode.USER_REJECTED)) {
    console.log('User cancelled the transaction');
  } else if (isErrorType(error, ErrorCode.EXTENSION_NOT_FOUND)) {
    // Enhanced diagnostics available
    console.error('Extension not found. Details:', error.details);
    alert('Please install 0xio Wallet extension');
  } else {
    // All errors now include detailed context
    console.error('Transaction failed:', {
      message: error.message,
      code: error.code,
      details: error.details // Browser/extension state info
    });
    alert('Transaction failed: ' + error.message);
  }
}
```

### 3. Network Validation
```typescript
const networkInfo = await wallet.getNetworkInfo();
if (networkInfo.id !== 'mainnet') {
  console.warn('Not connected to mainnet!');
  // Show warning to user or switch network
}
```

## Development

### Prerequisites
- Node.js 16+
- TypeScript 4.5+
- Modern browser with extension support

### Building from Source
```bash
git clone https://github.com/0xio-xyz/0xio-sdk.git
cd 0xio-sdk
npm install
npm run build
```

### Testing
```bash
npm run test
npm run typecheck
npm run lint
```

## Type Definitions

The SDK is fully typed with TypeScript. Import types as needed:

```typescript
import {
  Balance,
  TransactionData,
  TransactionResult,
  WalletEventType,
  ConnectEvent,
  ErrorCode
} from '@0xgery/0xio-sdk';
```

## Error Codes

| Code | Description |
|------|-------------|
| `EXTENSION_NOT_FOUND` | 0xio Wallet extension not installed |
| `CONNECTION_REFUSED` | User denied connection request |
| `USER_REJECTED` | User rejected transaction/action |
| `INSUFFICIENT_BALANCE` | Not enough balance for transaction |
| `INVALID_ADDRESS` | Invalid wallet address format |
| `INVALID_AMOUNT` | Invalid transaction amount |
| `NETWORK_ERROR` | Network communication failure |
| `TRANSACTION_FAILED` | Transaction processing failed |
| `PERMISSION_DENIED` | Missing required permissions |
| `WALLET_LOCKED` | Wallet needs to be unlocked |
| `RATE_LIMIT_EXCEEDED` | Too many requests (max: 20/sec, 50 concurrent) |

## Support

- **Issues**: [GitHub Issues](https://github.com/0xio-xyz/0xio-sdk/issues)
- **Discussions**: [GitHub Discussions](https://github.com/0xio-xyz/0xio-sdk/discussions)
- **Team**: 0xio Team
- **Email**: team@0xio.xyz
- **Website**: [0xio.xyz](https://0xio.xyz)

## License

MIT License - see [LICENSE](LICENSE) for details.

---

Built by 0xio Team for the Octra Network