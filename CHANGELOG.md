# Changelog

All notable changes to the 0xio Wallet SDK.

## [2.8.1] - 2026-09-22

### Changed

- `switchNetwork` asks the user in every 0xio wallet (extension 2.5.6, app 1.3.0, desktop 0.4.1) and is refused while another request from the site is pending; declining rejects with `USER_REJECTED`. The API is unchanged.
- `signMessage` is framed the same way on desktop 0.4.1 and app 1.3.0 (browser and WalletConnect), so `verifyMessage` verifies their signatures.

## [2.8.0] - 2026-06-09

### Added

- `wallet.request(method, params)` passes any method through the bridge.
- Private primitives over the bridge; the wallet keeps all secret material: `getPrivateCapabilities`, `callContractView`, `getPrivateBalance`, `encryptValue`, `decryptValue`, `makeZeroProof` (`{ proof, commitment, blinding, encoding }`), `makeRangeProof` (`{ proof, encoding }`), `registerPrivateViewKey`, `sendContractTransactionSequence`.
- 0xio Signed Message standard: `signMessage` signs `"Octra Signed Message:\n<byteLength>\n<message>"`; `verifyMessage`, `getSignedMessageBytes` and `buildAuthMessage` added. Verifiers of raw-message signatures must adopt the framing.

### Changed

- `amount` in `sendTransaction`, `signTransaction` and `callContract` is documented as raw micro-OCT, as the wallet always read it; the new `amountOct` takes OCT, and `sendPrivateTransfer` gains `amountRaw`.
- Permission names match the wallet (`accounts`, `public_transactions`, `contract_calls`, `contract_views`, `private_balance_read`, `private_proofs`, `private_transfers`, `private_claims`); older names are translated on connect and returned as aliases. `WALLET_PERMISSIONS`, `LEGACY_PERMISSION_MAP`, `toWalletPermissions` and `withLegacyAliases` exported.
- `sendPrivateTransfer` waits up to 10 minutes for proofs.
- `switchNetwork` and every signing or submitting call need a connected page (`NOT_CONNECTED` otherwise).
- The RFC-O-1 adapter maps the 2.8.0 primitives to their `octra_*` names.

### Fixed

- `getPublicKey()` exists (the docs called it).
- `rpcCall(method, params)` wraps the wallet's read-only node RPC allow-list.
- `transactionFailed` events reach the dApp.
- `ErrorCode` includes every code the wallet returns.
- `encryptValue` and `makeZeroProof` types include `commitment` and `blinding`.
- `encryptBalance` and `decryptBalance` are deprecated (the extension answers `NOT_AVAILABLE`).
- Built-in devnet points at `https://devnet.octrascan.io`.
- `PendingPrivateTransfer` documents `id` and a raw `amount`.

## [2.7.1] - 2026-05-27

### Security

- `connect()` and `getConnectionStatus()` no longer fall back to `config.networkId`; an unresolvable network throws `NETWORK_ERROR` or returns cached state.
- `SDKConfig.trustedParentOrigins` limits trusted parent iframe bridges (plus `tauri://`) and turns off implicit localhost trust.
- `validateNetworkInfo()` rejects `http://` RPC URLs on non-testnet networks.
- `encryptBalance`, `decryptBalance`, `sendPrivateTransfer` and `callContract` throw `INVALID_AMOUNT` for numbers not exact in micro-OCT; pass a string for exact control.

### Added

- `OctraProviderAdapter`: RFC-O-1 transport over `window.octra.request()` for any wallet with `window.octra.isOctra`, mapping SDK method and event names.
- `OctraProviderAdapter` also listens for `octra#initialized` (extension 2.4.3+).

### Changed

- `ZeroXIOAdapter` (postMessage) stays the default; `OctraProviderAdapter` is opt-in or picked by `detectWalletAdapter()`.

### Fixed

- Mainnet RPC URL in the docs is `https://octra.network`.
- `ContractCallData.amount` JSDoc says OCT.

## [2.7.0] - 2026-05-16

### Security

- Session nonce checked on every bridge response.
- No wildcard `'*'` postMessage fallback; the parent is addressed only once its origin is known.
- No `Math.random()` request ids; throws without `crypto`.
- `requestTimestamps` capped.
- Legacy `octraWalletReady` listeners and the `createOctraWallet` alias removed.
- Debug logs carry only non-sensitive fields.
- Payload limits: method names 200 characters, params 64 KB, memos 1,000 characters.
- Input validation at every mutating entry point.
- `contractCallView` no longer sends the connected address as the default caller.
- `connect()` and `getConnectionStatus()` check the public key against the address.

### Added

- Pluggable wallet adapters: `WalletTransportAdapter`, `ZeroXIOAdapter`, `createZeroXIOAdapter`, `detectWalletAdapter`, `getAllAdapters`, plus a starter template.
- `signAuthMessage(service, nonce)`: domain-separated auth signing bound to the origin.
- `deriveOctraAddress(publicKeyBase64)`.

### Changed

- `ExtensionCommunicator` delegates detection, messaging and ready events to the adapter; session nonces live in the adapter.
- Requires Chrome 111+ with the 0xio extension.
- Amounts accept `string | number`.
- `encryptBalance` and `decryptBalance` return a full `TransactionResult`.
- `retry()` and `withTimeout()` no longer exported.
- `NETWORKS` frozen; `getNetworkConfig()` returns frozen copies.
- `switchNetwork()` requires a connection.

### Fixed

- `_sessionVersion` stops stale writes after a disconnect or account switch.
- `balanceChanged` fires on a public/private split change.
- `once()` removes the listener before calling it.
- `extensionLocked` and `extensionUnlocked` are emitted.
- Permissions and `connectedAt` survive session restore and polling.
- `connect` fires only on a disconnected to connected transition.
- `validateBalance()` rejects partial numbers; `validateNetworkInfo()` rejects an empty RPC URL.
- `checkSDKCompatibility()` no longer flags non-Chrome transports.

## [2.6.0] - 2026-05-13

### Added

- `sendPrivateTransfer()`: encrypted transfers; the extension builds the ciphertext and proofs.
- `getPendingPrivateTransfers()` and `claimPrivateTransfer(transferId)`.

### Changed

- Private transfer methods are live with extension 2.4.0+; older extensions throw. The `private_transfers` permission covers all three.

## [2.5.0] - 2026-05-10

### Added

- `switchNetwork(networkId)` switches the extension's network without the popup (extension 2.3.6+).
- `getNetworkId()` returns `mainnet` or `devnet`.

## [2.4.5] - 2026-05-07

### Fixed

- Network read from the extension's `connect` and `getConnectionStatus` responses instead of defaulting to mainnet.
- Live balance on every status check (was a cached zero).
- `getTransactionHistory()` returns real pages: `{ transactions, totalCount, page, hasMore }`.
- `transactionConfirmed` event name aligned with the extension.
- Private balance info returns `encryptedAmount`.

### Changed

- `connect` returns `networkInfo` and `permissions`; `getNetworkInfo` adds explorer, indexer, privacy and testnet fields.
- Network info falls back from `result.networkInfo` to `getNetworkConfig(result.networkId)` to the configured id.
- Full alignment needs extension 2.3.5+; older ones return partial data.

## [2.4.4] - 2026-05-02

### Added

- `ContractCallData` documents base64 params for FHE ciphers, proofs and public keys; `ContractParam` exported.

### Changed

- Interactive timeout 180 s (was 120 s) for proof-heavy contract calls.
- `ContractCallData` JSDoc covers micro-unit amounts, FHE params and OU fees.

## [2.4.3] - 2026-04-24

### Fixed

- State-changing methods no longer retry on timeout, which opened a second approval popup.
- Interactive timeout 120 s (was 30 s).

## [2.4.2] - 2026-04-15

### Fixed

- Localhost origins accepted as trusted parents for development.
- `walletReady` carries `parentOrigin`; replies go to it.
- Iframe replies target the captured parent origin.

## [2.4.1] - 2026-04-14

### Security

- Parent-frame messages validated against a strict trusted origins set.
- No automatic trust for an iframe parent without a trusted `walletReady`.
- Only responses matching a pending request id are processed.
- `simulateExtensionEvent` removed.
- No wildcard postMessage to the parent.

### Added

- `setTrustedOrigins(origins)`.

### Fixed

- `retry()` stops on user rejection.
- `withTimeout` clears its timer.
- `retry` with `maxRetries=1` makes 2 attempts (was 3).
- `cleanup()` removes the message listener.
- `ReturnType<typeof setTimeout>` replaces `NodeJS.Timeout`.
- `createLogger` guards `process.env`.
- Duplicate `isValidNetworkId` removed.
- Docs corrected: event examples, `TransactionHistory`, `retry`, `formatZeroXIO`, `toMicroZeroXIO`, `ConnectOptions`, `ConnectionInfo`, `ErrorCode.NETWORK_ERROR`, mainnet privacy support.

## [2.4.0] - 2026-03-24

### Security

- Parent messages accepted only from `window.parent`; extension messages keep strict origin checks.

### Added

- Runs inside iframes (0xio Desktop browser) and WebViews (0xio app): requests relay to the parent frame, and `walletReady` is detected via postMessage.

### Changed

- Backward compatible; mainnet needs extension 2.0.1+, devnet 2.2.1+.

## [2.3.0] - 2026-03-10

### Security

- `simulateExtensionEvent` posts to `window.location.origin` instead of `'*'`.
- `signMessage` limited to 10,000 characters.
- Debug mode only on localhost, 127.0.0.1 or `NODE_ENV=development`.

### Added

- `callContract()`, `contractCallView()` and `getContractStorage()`.
- `ContractCallData`, `ContractViewCallData` and `ContractParams` types; `MIN_EXTENSION_VERSION_DEVNET`.

### Changed

- `ContractParams` replaces `any` in contract params; internal event handlers typed.
- `getNetworkConfig()` throws `ZeroXIOWalletError` (`NETWORK_ERROR`).
- UMD global is `ZeroXIOWalletSDK`.
- Mainnet needs extension 2.0.1+, devnet 2.2.1+.

### Fixed

- `isValidMessage()` allows 100,000 characters (280 blocked contract params).

## [2.2.0] - 2026-03-08

### Added

- Devnet in `NETWORKS`; `NetworkInfo` gains `explorerAddressUrl`, `indexerUrl` and `supportsPrivacy`; `isValidNetworkId()` accepts `devnet`.

### Fixed

- Mainnet explorer URLs end with `/`.
- `generateMockData()` returns the new `NetworkInfo` fields.

## [2.1.8] - 2026-02-13

### Added

- `TransactionFinality` (`pending`, `confirmed`, `rejected`) on `TransactionResult` and `Transaction`.
- RPC error codes with messages: `MALFORMED_TRANSACTION`, `SELF_TRANSFER`, `SENDER_NOT_FOUND`, `INVALID_SIGNATURE`, `DUPLICATE_TRANSACTION`, `NONCE_TOO_FAR`, `INTERNAL_ERROR`.

### Fixed

- Addresses must start with `oct` and be 47 characters.
- `getBalance()` throws `ZeroXIOWalletError` without an address.
- Mock data uses `oct` addresses and mainnet.

## [2.1.7] - 2026-01-27

### Added

- `publicKey` (base64 Ed25519) on `ConnectionInfo`, `ConnectEvent` and `WalletAddress`.

## [2.1.6] - 2026-01-27

### Added

- `signMessage` (Ed25519), rejecting empty or non-string messages.
- `sign_messages` and `read_address` permission types.

## [2.1.4] - 2026-01-18

### Changed

- Supports extension `^2.0.1`; `MIN_EXTENSION_VERSION` exported.

### Fixed

- Transactions from dApps handle the extension's response formats.
- Wallet lookup by address when the vault returns an address.
- Extension error and success responses match `ExtensionResponse`.

## [2.1.3] - 2026-01-17

### Fixed

- Balances come from the extension only (the direct RPC read hit CORS).

## [2.1.2] - 2026-01-17

### Fixed

- `getBalance` reads the public balance from RPC and the private one from the extension.
- Private balance field added.

## [2.1.1] - 2026-01-16

### Changed

- Less verbose production logging.

## [2.0.2] - 2025-12-22

### Changed

- Default network is mainnet (`https://octra.network`); testnet removed. Breaking.
- Requires extension 2.0.1, 2.0.3 or 2.0.4.

## [2.0.1] - 2025-11-24

### Changed

- Message sources renamed from `octra-sdk-*` to `0xio-sdk-*`. Breaking: needs extension 2.0+. Upgrade with `npm install @0xio/sdk@^2.0.0`; no code changes.
- Package metadata, author and repository moved to 0xio-xyz.

## [1.0.4] - 2025-10-23

### Fixed

- Network RPC `https://octra.network`, explorer `https://octrascan.io/`; nonexistent testnet removed.

## [1.0.3] - 2025-10-04

### Changed

- Changelog completed for every version.

## [1.0.2] - 2025-10-04

### Changed

- npm package ships README, CHANGELOG and LICENSE only.

## [1.0.1] - 2025-10-04

### Fixed

- `RATE_LIMIT_EXCEEDED` message added; branding reads 0xio Wallet for the Octra Network.

## [1.0.0] - 2025-10-04

First stable release.

### Security

- postMessage origins validated (8 wildcard origins removed).
- Rate limits: 50 concurrent requests, 20 per second.
- Request ids from `crypto.randomUUID()`.

### Changed

- Package renamed from `@0xgery/wallet-sdk` to `@0xio/sdk` and rebranded as the 0xio Wallet SDK.
- JSDoc on every export; MIT license; React, Vue and vanilla JS examples.
- `OctraWallet` still exported (also as `ZeroXIOWallet`).

## [0.2.1] - 2025-09-09

### Changed

- Plain-text debug messages.

## [0.2.0] - 2025-09-09

### Added

- Built-in extension detection and monitoring.
- Retry with exponential backoff (3 retries).
- Event-based updates for account, balance, network and lock state.
- Development mode with grouped logs and `window.__ZEROXIO_SDK_UTILS__`.
- Exported utilities for validation, formatting, conversion, errors, async, browser support and mock data.
- `getDebugInfo()` includes extension diagnostics.

### Fixed

- `substr()` replaced with `substring()`; pending request and listener cleanup.

## [0.1.2-dev]

- Initial SDK: extension communication, wallet operations, transactions, private transfers.
