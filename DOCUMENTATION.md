# 0xio Wallet SDK Documentation

## Table of Contents
1. [Initialization](#initialization)
2. [Connection](#connection)
3. [Transactions](#transactions)
4. [Message Signing](#message-signing)
5. [Private Features](#private-features)

## Initialization

\`\`\`typescript
import { ZeroXIOWallet } from '@0xio/sdk';

const wallet = new ZeroXIOWallet({
  appName: 'My DApp',
  appDescription: 'My awesome dApp on Octra',
  networkId: 'mainnet'
});

await wallet.initialize();
\`\`\`

## Connection

\`\`\`typescript
// Check if already connected
const info = await wallet.getConnectionStatus();

// Connect
if (!info.isConnected) {
    await wallet.connect();
}
\`\`\`

## Transactions

\`\`\`typescript
const result = await wallet.sendTransaction({
  to: 'oct1...',
  amount: 10.5, // OCT
  message: 'Payment for services'
});
\`\`\`

## Message Signing

The SDK allows you to request the user to sign a text message using their wallet's private key. This is useful for authentication challenges.

### `signMessage(message: string): Promise<string>`

- **Parameters**: `message` (string) - The text content to sign.
- **Returns**: A Promise resolving to the standard signature string.
- **Throws**: `SIGNATURE_FAILED` if rejected or failed.

\`\`\`typescript
try {
  const message = "Login to MyDApp: " + Date.now();
  const signature = await wallet.signMessage(message);
  console.log("Signature:", signature);

  // Send signature to backend for verification
} catch (error) {
  if (error.code === 'USER_REJECTED') {
     console.log("User denied signature");
  }
}
\`\`\`
