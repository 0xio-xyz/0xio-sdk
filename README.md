# 0xio Wallet SDK

**Version:** 2.1.3

A comprehensive TypeScript/JavaScript SDK that enables seamless integration between decentralized applications (DApps) and the 0xio Wallet browser extension.

## What's New in v2.1.2 (The "Fertility" Update)

- **Robust "Hybrid" Balance Fetching:** Fixed a critical issue where `getBalance()` could return stale cached data or fail on 404s. The SDK now fetches **Public Balance** directly from the RPC node (`https://octra.network/balance`) while securely retrieving **Private Balance** from the extension.
- **Private Balance Support:** The `Balance` object now includes a `private` field, populated by the secure context of the 0xio Wallet.
- **Enhanced Types:** Full type definitions for the composite Public/Private balance structure.

## Quick Start

### Installation

```bash
npm install @0xio/sdk
```

### Usage

```typescript
import { ZeroXIOWallet } from '@0xio/sdk';

// 1. Initialize
const wallet = new ZeroXIOWallet({
  appName: 'My DApp',
  requiredPermissions: ['read_balance']
});

await wallet.initialize();

// 2. Connect
const connection = await wallet.connect();
console.log('Connected:', connection.address);

// 3. Get Fresh Balance (Public + Private)
const balance = await wallet.getBalance(true); // true = force refresh
console.log('Total:', balance.total);
console.log('Public:', balance.public);
console.log('Private:', balance.private);
```

## API Reference

### `wallet.getBalance(forceRefresh?: boolean)`

Fetches the current balance.
- **Returns**: `Promise<Balance>`
  ```typescript
  interface Balance {
    public: number;   // Visible on chain
    private: number;  // Encrypted (FHE), decrypted locally
    total: number;    // public + private
    currency: 'OCT';
  }
  ```

### `wallet.connect(options?)`

Requests a connection to the user's wallet.
- **Returns**: `Promise<ConnectEvent>` including initial address and balance.

### `wallet.sendTransaction(txData)`

Sends a standard or shielded transaction.

## Development

```bash
# Build
npm run build

# Link locally
npm link
```

## License

MIT License. Copyright © 2026 0xio Team.