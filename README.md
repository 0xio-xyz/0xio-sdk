# 0xio Wallet SDK

**Version:** 2.1.4

A comprehensive TypeScript/JavaScript SDK that enables seamless integration between decentralized applications (DApps) and the 0xio Wallet browser extension.

## What's New in v2.1.4

- **Critical Transaction Fix**: Fixed `ZeroXIOWalletError` when sending transactions from DApps.
- **Wallet ID Resolution**: Fixed wallet lookup in vault fallback mode - extension now correctly finds wallets by address.
- **Semver Compatibility**: SDK now supports all extension versions `^2.0.1` (>= 2.0.1) instead of explicit version list.
- **Improved Error Handling**: Extension responses now use proper typed error format.

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

### `wallet.signMessage(message: string)`

Requests the user to sign a text message.
- **Returns**: `Promise<string>` (the signature)

## Development

```bash
# Build
npm run build

# Link locally
npm link
```

## License

MIT License. Copyright © 2026 0xio Team.