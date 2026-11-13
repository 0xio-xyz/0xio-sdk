# Rules for coding assistants using @0xio/sdk

Follow these when you write code against `@0xio/sdk`. Every name below exists in `dist/index.d.ts`; check the types there before you use anything not listed. Full reference: `README.md` and `DOCUMENTATION.md` in this package, and https://docs.0xio.xyz.

## Install and init

```bash
npm install @0xio/sdk
```

- Browser only. Create one `ZeroXIOWallet` per page, call `initialize()` once, and call `cleanup()` when the page or component goes away.
- Declare every permission the app will ever ask for in `requiredPermissions`. `connect()` only requests declared ones.

```typescript
import { ZeroXIOWallet, ZeroXIOWalletError, ErrorCode } from '@0xio/sdk';

const wallet = new ZeroXIOWallet({
  appName: 'My DApp',
  requiredPermissions: ['accounts', 'public_transactions'],
});
await wallet.initialize();
```

Scopes: `accounts`, `public_transactions`, `contract_calls`, `contract_views`, `private_balance_read`, `private_proofs`, `private_transfers`, `private_claims`.

## Detect and connect

- `wallet.detect()` needs no `initialize()` and never shows a browser prompt. `next` is `'connect'`, `'install'` or `'open-in-app'`; on a phone without a wallet, `openInAppUrl` is a link to put on a button (the SDK never navigates).
- `initialize()` rejects with `EXTENSION_NOT_FOUND` when no wallet answers. It can also resolve with `wallet.transport === null` and `wallet.desktopAvailableOnConnect === true`: keep the Connect button enabled, `connect()` reaches 0xio Desktop.
- Call `connect()` only from a click. It opens a review and resolves with `ConnectEvent`: `{ address, publicKey, canSign, balance, networkInfo, permissions }`.
- On page load, `getConnectionStatus()` restores an existing session without a review. Check `isConnected` on its result.
- `disconnect()` ends the session and emits `disconnect`.

## Reading state

- `getAddress(): string | null` and `getNetworkId(): string | null` are synchronous and `null` until connected.
- `getConnectionInfo()` returns the cached `ConnectionInfo`.
- `getBalance(forceRefresh?)` resolves with `Balance`: `public`, `private`, `total` as numbers in OCT, `currency: 'OCT'`. Use these for display only, never for amount math. On 0xio Desktop `private` is always 0; read it with `getPrivateBalance()`.
- `getNetworkInfo()` resolves with `NetworkInfo`: `id`, `name`, `rpcUrl`, `explorerUrl` (append the tx hash), `isTestnet`.
- `getPublicKey()` resolves with the base64 Ed25519 key.
- `getTransactionHistory(page?, limit?)` rows carry `amount` in raw micro-OCT and `fee` in OCT, as the node returns them.

## Amounts

One OCT is 1000000 micro-OCT. Pass amounts as strings.

| Method | OCT field | Raw micro-OCT field |
|--------|-----------|---------------------|
| `sendTransaction`, `signTransaction` | `amountOct` | `amount` |
| `callContract` | `amountOct` | `amount` |
| `sendPrivateTransfer` | `amount` | `amountRaw` |

- Prefer the OCT field: `{ amountOct: '1.5' }`. The SDK converts it exactly.
- Never pass both fields. At most 6 decimals. A number that is not exact in 6 decimals (`0.1 + 0.2`) fails with `INVALID_AMOUNT`.
- Never put an OCT value in a raw field: `{ amount: '1.5' }` on `sendTransaction` is 1.5 micro-OCT.
- Helpers: `octToMicro(oct)` (exact string), `fromMicroOCT(raw)` (number, display only), `formatOCT(value)`, `isValidAddress(address)`.

## Sending and the request lifecycle

Every write opens a review in the wallet; the user approves or rejects there. Nothing signs without it.

```typescript
const requestId = wallet.newRequestId();
localStorage.setItem(`send:${network}:${address}`, requestId);

const result = await wallet.sendTransaction(
  { to, amountOct: '1.5' },
  { requestId, wait: 'confirmed', onStatus: (s) => setStatus(s.status) }
);
// result.hash, result.requestStatus ('submitted' | 'confirmed' | 'completed'), result.epoch
```

- Options on every review call (`ReviewOptions`): `requestId`, `timeoutMs`, `onStatus`. Writes (`WriteOptions`) add `wait: 'submitted' | 'confirmed'` (default `'submitted'`).
- Store the request id before the call, scoped by network and address, so a reload can find it.
- Statuses: `pending`, `locked`, `review_open`, `signing`, `submitted`, then final `confirmed`, `completed`, `failed`, `rejected`, `expired`; `unknown` when the wallet has no record of the id.
- One review per page at a time. Disable the action while a call is in flight. A second call fails with `RATE_LIMIT_EXCEEDED` and `details.reason === 'review_pending'`; `pendingRequest()` names the open one.
- `wait: 'confirmed'` rejects with `EXECUTION_FAILED` (`details.hash`, `details.reason`) when the chain rejects or drops the transaction.
- `UNSUPPORTED_METHOD` with `details.hash` on a confirmed wait means the transaction was submitted but this wallet cannot report confirmation. Treat it as submitted.
- `USER_REJECTED` means the user declined or the review expired (5 minutes).

### Never resend

`STATUS_UNKNOWN` and `NETWORK_ERROR` on a review call mean the wallet may still finish the request. The error carries `error.requestId`.

```typescript
try {
  await wallet.sendTransaction({ to, amountOct: '1' }, { requestId });
} catch (error) {
  if (
    error instanceof ZeroXIOWalletError &&
    (error.code === ErrorCode.STATUS_UNKNOWN || error.code === ErrorCode.NETWORK_ERROR)
  ) {
    const final = await wallet.waitForRequest(requestId, { onStatus: (s) => setStatus(s.status) });
  }
}
```

- Follow it with `waitForRequest(requestId, { until?, timeoutMs?, onStatus? })` or `requestStatus(requestId)`. Never call the send again with a new id, never show a Resend button for this case.
- Calling again with the same `requestId` joins the first request or returns its stored outcome; it never opens a second review. A different request under a used id fails with `REQUEST_ID_REUSED`.
- After a reload: read the stored id, call `requestStatus(id)`, and call `waitForRequest(id)` if it is not final.
- `wallet.walletInfo?.protocol === 2` wallets keep statuses for 24 hours. Older wallets have no record; after a reload the status is `unknown`. Tell the user to check the wallet's activity; do not resend.

## Watch-only wallets

- `canSign()` returns `false` for a watch-only wallet, `true` when it signs, `undefined` when unknown. Fallback: `wallet.canSign() ?? !!wallet.getConnectionInfo().publicKey`.
- Hide or disable every signing action when it is `false`. Signing calls fail with `WATCH_ONLY`.
- `connect` and `accountChanged` events carry `canSign`; update the UI from them.

## Networks and scoping

- Network ids: `'mainnet'` and `'devnet'`. The wallet chooses the network; read it from `connect()` (`networkInfo`) or `getNetworkId()`. Never assume mainnet.
- `switchNetwork(networkId, options?)` needs a connection, opens a review and resolves with `{ network, switched }`. It fails while another review of the page is open.
- Key every cache, query, stored request id and UI state by network plus address. On `networkChanged`, `accountChanged` or `disconnect`, drop that state and read again. `networkChanged` clears the cached balance; call `getBalance()`.
- A request is bound to the wallet and network it was reviewed under. `NETWORK_CHANGED` or `WALLET_CHANGED` means the user moved; read state again and let the user retry.

## Contracts

- `callContract({ contract, method, params, amountOct?, amount?, ou? }, WriteOptions)` signs a state changing call. `params` is a flat array of `string | number | boolean`; binary data as base64. `ou` defaults to 10000.
- The receipt (`wait: 'confirmed'`) has `success`, `events` and `error`, but no return value. Read results from events or with a view call after `confirmed`. `receipt` is `null` with `receiptUnavailable` when the node gives none.
- `contractCallView({ contract, method, params, caller? })` is read only, opens no review and needs no connection. It resolves with the wallet's answer (`any`).
- `getContractStorage(contract, key)` reads one storage key.
- `lookupAddress(address?)` resolves with the address's primary name (`0xio.oct`) or `null`; `resolveName(name)` with `{ name, kind: 'wallet' | 'circle' | 'none', wallet, circle }` or `null` where the network has no name service. Display the name, send to the address, and resolve again right before sending. Ask for `contract_views` at connect. The contract comes from the token-lists name list (`ONS_LIST_URL`) and is checked on chain; never pass one in from a page.
- `deployContract({ bytecode, params?, ou? }, WriteOptions)` resolves with `{ txHash, contractAddress }`. `DEPLOY_CHANGED` means nothing was sent.

## Private transfers

- `sendPrivateTransfer({ to, amount, amountRaw? }, WriteOptions)` needs a connection and the `private_transfers` permission, declared in `requiredPermissions` and granted at connect.
- It takes minutes: the wallet builds proofs after the review. The SDK waits up to 10 minutes by default. Do not pass a shorter `timeoutMs`; show progress from `onStatus` (`signing` lasts the longest).
- Private transfers carry no memo. `RECIPIENT_NOT_REGISTERED` means the recipient cannot receive one yet.
- Incoming: `getPendingPrivateTransfers()` then `claimPrivateTransfer(id, WriteOptions)` (needs `private_claims`). On 0xio Desktop the first fails with `UNSUPPORTED_METHOD`; use `getPrivateBalance({ include_claimable: true })`.
- `registerPrivateViewKey({ address }, WriteOptions)` with the connected address only.
- `encryptBalance` and `decryptBalance` are deprecated; the 0xio extension answers `NOT_AVAILABLE`.

## Message signing

- `signMessage(message, options?)` resolves with a base64 Ed25519 signature. The wallet signs a framed payload, never the raw message. At most 10000 characters.
- Verify with `verifyMessage(message, signature, publicKey)` from `@0xio/sdk`, using `getPublicKey()`. Any other Ed25519 verifier checks the bytes from `getSignedMessageBytes(message)`.
- Login: `signAuthMessage(service, nonce)` with a server nonce; the server rebuilds the text with `buildAuthMessage(service, nonce, origin)`.

## Events and cleanup

```typescript
import type { WalletEvent, AccountChangedEvent } from '@0xio/sdk';

const onAccount = (event: WalletEvent<AccountChangedEvent>) => reload(event.data.newAddress);
wallet.on('accountChanged', onAccount);
// later
wallet.off('accountChanged', onAccount);
```

- Listeners receive `WalletEvent<T>`: `{ type, data, timestamp }`. Read the payload from `event.data`.
- Events: `connect`, `disconnect` (`data.reason`), `accountChanged`, `balanceChanged`, `networkChanged`, `transactionConfirmed`, `transactionFailed`, `permissionsChanged`, `extensionLocked`, `extensionUnlocked`, `requestUpdate` (a `RequestStatus`), `connectProgress`.
- Remove every listener you add with `off`, or call `wallet.cleanup()` on unmount, which removes all of them. In React, create the wallet inside an effect and return `() => wallet.cleanup()`.

## Error codes

Every failure is a `ZeroXIOWalletError` with `code` (an `ErrorCode`), `message`, `details` and, on review calls, `requestId`.

| Code | Do this |
|------|---------|
| `EXTENSION_NOT_FOUND` | Show install links or the open-in-app link |
| `CONNECTION_REFUSED`, `NOT_CONNECTED` | Not connected: call `connect()` from a click |
| `USER_REJECTED` | Stop; no retry prompt |
| `WALLET_LOCKED` | Ask the user to unlock the wallet |
| `WATCH_ONLY` | Show a read-only state |
| `INSUFFICIENT_BALANCE`, `INVALID_AMOUNT`, `INVALID_ADDRESS` | Show the error next to the field |
| `RATE_LIMIT_EXCEEDED` | Wait for the open review (`details.reason`) |
| `STATUS_UNKNOWN`, `NETWORK_ERROR` | Follow `error.requestId`; never resend |
| `EXECUTION_FAILED` | The chain refused it; show `details.reason` |
| `REQUEST_ID_REUSED` | Make a new id for a new request |
| `NETWORK_CHANGED`, `WALLET_CHANGED`, `NOT_AVAILABLE` | Read state again; the user switched network or wallet |
| `PERMISSION_DENIED` | Declare and request the scope |

## EVM

The SDK covers Octra only. For Ethereum and other EVM networks the 0xio extension is a standard EIP-1193 provider found through EIP-6963 (rdns `xyz.0xio.wallet`); use an EVM library with it, not this SDK. It sets `window.ethereum` only when no other wallet has.

## Never

- Never ask for, store or log a seed phrase or private key. Keys stay in the wallet.
- Never build a retry loop around a write.
- Leave fees to the wallet: omit `ou` on `deployContract` so the wallet sets the live fee, and set it on `callContract` only when the contract needs more than the default.

## Docs for assistants

- MCP server: `https://docs.0xio.xyz/mcp` (streamable HTTP). Claude Code: `claude mcp add --transport http 0xio-docs https://docs.0xio.xyz/mcp`
- https://docs.0xio.xyz/llms.txt (index) and https://docs.0xio.xyz/llms-full.txt (every page)
- Any docs page as Markdown: add `.md` to its URL, for example https://docs.0xio.xyz/developers/request-lifecycle.md
- Starter app: `npm create @0xio/dapp`
