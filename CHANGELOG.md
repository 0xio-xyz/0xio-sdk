# Changelog

All notable changes to the 0xio Wallet SDK will be documented in this file.

## [2.4.2] - 2026-04-15

### Fixed
- **Cross-origin iframe DApp bridge**: SDK now accepts localhost origins as trusted parents for dev/testing. Fixes "Unable to post message" errors when DApps run on different localhost ports inside the desktop browser.
- **Parent origin capture**: `walletReady` signal now carries `parentOrigin` field. SDK stores it and uses it for cross-origin replies instead of failing silently.
- **postMessage targeting**: When inside an iframe, SDK replies to the captured parent origin (or wildcard fallback) instead of `window.location.origin` which fails for cross-port scenarios.

## [2.4.1] - 2026-04-14

### Security
- **[CRITICAL] postMessage origin validation**: Parent-frame messages now validated against a strict trusted origins set instead of accepting all origins. Prevents malicious pages from intercepting wallet requests via iframe embedding.
- **[CRITICAL] Removed auto-trust for iframes**: SDK no longer assumes any iframe parent is a wallet bridge. Must receive a `walletReady` signal from a trusted origin first.
- **[CRITICAL] Response binding**: Only responses with matching pending request IDs are processed. Forged responses from injected scripts are rejected.
- **[HIGH] Removed `simulateExtensionEvent`**: Dev utility that could be exploited on staging builds to inject fake wallet events has been removed.
- **[HIGH] No wildcard postMessage**: `postMessageToExtension` now uses specific trusted origins (`tauri://localhost`, etc.) instead of `'*'` for parent-frame communication.

### Fixed
- **No retry on user rejection**: `retry()` detects rejection/denied/cancelled errors and throws immediately. Prevents double confirmation popups.
- **`withTimeout` timer leak**: Timer is now cleared via `.finally()` when the promise resolves, preventing 30s memory retention per request.
- **`retry` off-by-one**: `maxRetries=1` now correctly means 1 initial + 1 retry = 2 total (was 3).
- **Message listener cleanup**: `cleanup()` now removes the `window.addEventListener('message')` listener, preventing accumulation on re-instantiation.
- **Type compatibility**: Replaced `NodeJS.Timeout` with `ReturnType<typeof setTimeout>` for browser-only environments.
- **`process.env` guard**: `createLogger` now uses optional chaining for `process.env.NODE_ENV`, preventing ReferenceError when imported in browser without bundler.
- **Duplicate `isValidNetworkId`**: Removed duplicate export from `utils.ts`, canonical version in `config/networks.ts`.

### Added
- **`setTrustedOrigins(origins)`**: New method to configure allowed parent-frame origins for iframe/bridge communication.

### Documentation
- Fixed all event listener examples to use `event.data.xxx` (WalletEvent wrapper)
- Fixed `TransactionHistory` type (`totalCount`/`hasMore` instead of `total`/`limit`/`totalPages`)
- Fixed `retry()` docs (positional args, not options object)
- Fixed `formatZeroXIO` return value (no " OCT" suffix)
- Fixed `toMicroZeroXIO` return type (string, not number)
- Removed nonexistent `ConnectOptions.timeout`, `.requestPrivateAccess`
- Removed nonexistent `ConnectionInfo.permissions`
- Changed `ErrorCode.TIMEOUT` to `ErrorCode.NETWORK_ERROR`
- Updated mainnet privacy support to "Yes"

## [2.4.0] - 2026-03-24

### Added
- **Desktop/Mobile DApp Bridge**: SDK now supports running inside iframes (desktop browser) and WebViews (mobile browser). Requests are relayed to the parent frame automatically.
- **Parent Frame Detection**: `postMessageToExtension()` now posts to both `window` (extension content script) and `window.parent` (iframe bridge) when running inside a frame.
- **Frame-Aware Message Listener**: `setupMessageListener()` now accepts messages from `window.parent` in addition to same-window, enabling desktop/mobile wallet bridges to communicate with DApps.
- **walletReady via postMessage**: `startExtensionDetection()` now detects `walletReady` events sent via `postMessage` from parent frames, in addition to DOM events and global signals.
- **Auto Frame Detection**: When `window.parent !== window`, the SDK assumes a wallet bridge is available and marks the wallet as detected.

### Security
- Parent frame messages are only accepted from `window.parent`, not arbitrary origins
- Extension content script messages continue to use strict origin validation

### Compatibility
- Fully backward compatible — extension-based DApps work unchanged
- Desktop (0xio Desktop): DApps loaded in BrowserScreen iframe now auto-connect
- Mobile (0xio App): DApps loaded in WebView browser now auto-connect via existing bridge
- Mainnet Alpha: Extension v2.0.1+
- Devnet: Extension v2.2.1+

---

## [2.3.0] - 2026-03-10

### Added
- **Smart Contract Interaction**: New `callContract()` method for state-changing contract calls. The extension builds, signs, and submits via `octra_submit` — works on both mainnet and devnet.
- **Contract View Calls**: New `contractCallView()` method for read-only contract queries. No wallet unlock or approval popup required.
- **Contract Storage**: New `getContractStorage()` method to read contract storage by key directly from the chain.
- **New Types**: `ContractCallData`, `ContractViewCallData`, and `ContractParams` for type-safe contract interaction.
- **Devnet Version Constant**: New `MIN_EXTENSION_VERSION_DEVNET` export (`'2.2.1'`) for programmatic devnet compatibility checks.

### Improved
- **Type Safety**: Replaced `any` with `ContractParams` (`ReadonlyArray<string | number | boolean>`) in `ContractCallData.params` and `ContractViewCallData.params`.
- **Event Handler Typing**: Three internal event handlers (`handleAccountChanged`, `handleNetworkChanged`, `handleBalanceChanged`) now use properly typed parameters instead of `any`.
- **Error Consistency**: `getNetworkConfig()` now throws `ZeroXIOWalletError` with `ErrorCode.NETWORK_ERROR` instead of a generic `Error`.
- **UMD Global Name**: Fixed UMD build global from `OctraWalletSDK` to `ZeroXIOWalletSDK` to match SDK branding.

### Security
- **Fixed wildcard origin**: `simulateExtensionEvent` now uses `window.location.origin` instead of `'*'` wildcard, preventing cross-origin message injection.
- **signMessage length limit**: Added 10,000 character max to prevent memory exhaustion from oversized signing requests.
- **Narrowed dev detection**: Removed overly broad `hostname.includes('dev')` check that would enable debug mode on any domain containing "dev" (e.g., `developer.mozilla.org`). Dev mode now only activates on `localhost`, `127.0.0.1`, or when `NODE_ENV=development`.

### Fixed
- **Message validation**: Increased `isValidMessage()` limit from 280 to 100,000 characters. The 280-char limit was blocking contract call parameters which are serialized JSON and can be large.

### Compatibility
- **Mainnet Alpha**: Requires 0xio Wallet Extension v2.0.1 or higher
- **Devnet**: Requires 0xio Wallet Extension v2.2.1 or higher (contract calls, privacy features)

---

## [2.2.0] - 2026-03-08

### Added
- **Devnet Network Support**: Added full Octra Devnet configuration (`rpcUrl`, `explorerUrl`, `explorerAddressUrl`, `indexerUrl`) to the built-in `NETWORKS` registry.
- **Expanded `NetworkInfo` Type**: Added `explorerAddressUrl`, `indexerUrl`, and `supportsPrivacy` fields to the `NetworkInfo` interface for richer network metadata.
- **Privacy Flag**: Each network now exposes `supportsPrivacy: boolean` so DApps can detect FHE/encrypted balance support at the config level.
- **Devnet Validation**: `isValidNetworkId()` now accepts `'devnet'` in addition to `'mainnet'` and `'custom'`.

### Fixed
- **Explorer URLs**: Mainnet `explorerUrl` and `explorerAddressUrl` now include trailing `/` to match all other 0xio platforms (extension, app, desktop).
- **Mock Data**: `generateMockData()` now returns a `NetworkInfo` object with all new fields (`explorerAddressUrl`, `indexerUrl`, `supportsPrivacy`, correct URLs).

### Network Configurations

| Network | RPC | Explorer | Privacy | Testnet |
|---------|-----|----------|---------|---------|
| Mainnet | `http://46.101.86.250:8080` | `https://lite.octrascan.io` | Yes | No |
| Devnet | `http://165.227.225.79:8080` | `https://devnet.octrascan.io` | Yes | Yes |
| Custom | User-defined | User-defined | No | No |

---

## [2.1.8] - 2026-02-13

### Added
- **Transaction Finality**: New `TransactionFinality` type (`'pending' | 'confirmed' | 'rejected'`) and `finality` field on `TransactionResult` and `Transaction` interfaces.
- **RPC Error Codes**: 7 new `ErrorCode` entries for RPC-level transaction errors from `octra_submit` and `octra_submitBatch`:
  - `MALFORMED_TRANSACTION` — Transaction is malformed
  - `SELF_TRANSFER` — Cannot transfer to yourself
  - `SENDER_NOT_FOUND` — Sender address not found
  - `INVALID_SIGNATURE` — Invalid transaction signature
  - `DUPLICATE_TRANSACTION` — Duplicate transaction detected
  - `NONCE_TOO_FAR` — Transaction nonce is too far ahead
  - `INTERNAL_ERROR` — Internal server error
- **Error Messages**: All new error codes have corresponding human-readable messages in `createErrorMessage()`.

### Fixed
- Address validation now enforces `oct` prefix and 47-char length per Octra address spec.
- Mock data generates correct `oct`-prefixed addresses instead of uppercase `OCT`.
- `getBalance()` throws `ZeroXIOWalletError` instead of generic `Error` when address is missing.
- Decimal conversion comment now references JSON-RPC spec (6 decimal places confirmed).
- Stale REST endpoint comment (`/send-tx`, `/send-batch`) updated to JSON-RPC method names.
- Mock data network config updated from testnet to mainnet (`octra.network`).

## [2.1.7] - 2026-01-27

### Added
- **Public Key Exposure**: `ConnectionInfo` and `ConnectEvent` now include `publicKey` field (Base64-encoded Ed25519 public key).
- Enables DApps to perform cryptographic verification (e.g., API key signing) without additional extension requests.
- Updated `wallet.connect()` and `wallet.getConnectionStatus()` to propagate `publicKey` from extension.

### Changed
- `WalletAddress` interface now has optional `publicKey` field for consistency.

## [2.1.6] - 2026-01-27

### Added
- `signMessage` method to `ZeroXIOWallet` class for signing arbitrary text messages using Ed25519.
- `sign_messages` and `read_address` permission types for TypeScript definitions.
- Input validation for `signMessage` - rejects empty or non-string messages.
- Improved debug logging for signature requests (truncates long messages in logs).

## [2.1.4] - 2026-01-18

### Fixed
- **Critical Transaction Fix**: Fixed `ZeroXIOWalletError` when sending transactions from DApps. The SDK now properly handles extension response formats.
- **Wallet ID Resolution**: Fixed wallet lookup failing when `getActiveWallet()` returns address instead of UUID in vault fallback mode. Extension now finds wallet by address match.
- **Error Response Format**: Extension error responses now use proper object format `{ code, message }` instead of plain strings, matching SDK's `ExtensionResponse` type expectations.
- **Success Response Format**: Transaction success responses now include `data` wrapper as expected by SDK's `handleExtensionResponse`.

### Changed
- **Version Compatibility**: Changed from explicit version array to semver range (`^2.0.1`) - SDK now supports all extension versions >= 2.0.1.
- **New Export**: Added `MIN_EXTENSION_VERSION` constant for programmatic version checking.

### Compatibility
- Requires 0xio Wallet Extension v2.0.1 or higher
- Fully backward compatible with existing DApp integrations

## [2.1.3] - 2026-01-17

### Fixed
- **Simplified Balance Fetching**: Reverted to extension-based balance fetching to avoid CORS issues. The SDK now fetches both public and private balance exclusively from the extension's background script, which has unrestricted network access.
- **Reliability**: Removed complex hybrid architecture in favor of a simpler, more reliable single-source approach.

## [2.1.2] - 2026-01-17

### Fixed
- **Critical Refactor**: `getBalance` now implements a **Hybrid Architecture**. It fetches Public Balance directly from the RPC (bypassing extension middleware) and merges it with Private Balance from the extension. This permanently resolves "0.00" balance issues caused by extension caching or race conditions.
- **Feature**: Added support for `private` balance field in the standard Balance response.
- **Internal**: Added robust mapping for RPC responses to ensure correct public/private `Balance` object structure.

## [2.1.1] - 2026-01-16

### Changed
- Updated logging to be less verbose in production.

## [2.0.2] - 2025-12-22

### Breaking Changes
- **Network Migration**: Default network changed from `octra-testnet` to `mainnet`.
- **Testnet Removal**: Removed hardcoded Testnet configuration.
- **Compatibility**: SDK now strictly requires Extension versions `2.0.1`, `2.0.3`, or `2.0.4`.

### Changed
- Updated `NETWORKS` configuration to point to Octra Mainnet Alpha (`https://octra.network`).
- `isTestnet` flag set to `false` by default.

## [2.0.1] - 2025-11-24

### Breaking Changes
- **Rebranded message sources**: Changed from `octra-sdk-*` to `0xio-sdk-*` for consistency with 0xio branding
  - `octra-sdk-request` → `0xio-sdk-request`
  - `octra-sdk-bridge` → `0xio-sdk-bridge`
- This is a breaking change that requires wallet extension v2.0+ for compatibility

### Changed
- Updated package metadata to reflect 0xio Team ownership
- Changed author from "NullxGery" to "0xio Team"
- Updated author email from "0xgery@proton.me" to "team@0xio.xyz"
- Updated repository URL from `0xGery/0xio-sdk` to `0xio-xyz/0xio-sdk`
- Updated keywords: "0xio" → "0xio wallet", added "octra wallet"
- Author URL changed to organization: `https://github.com/0xio-xyz`

### Migration Guide
To upgrade from v1.x to v2.x:
1. Update SDK: `npm install @0xio/sdk@^2.0.0`
2. Update 0xio Wallet extension to v2.0 or higher
3. No code changes required - API remains unchanged

---

## [1.0.4] - 2025-10-23

### Fixed
- Fixed network configuration to use correct Octra Network RPC endpoint
- Removed non-existent 0xio-testnet network configuration
- Updated default network to octra-testnet with https://octra.network RPC
- Updated explorer URL to https://octrascan.io/

---

## [1.0.3] - 2025-10-04

### Changed
- Updated CHANGELOG.md with complete release notes for all versions

---

## [1.0.2] - 2025-10-04

### Changed
- Removed development-only documentation files for cleaner npm package
- Package now only includes essential documentation (README, CHANGELOG, LICENSE)

---

## [1.0.1] - 2025-10-04

### Fixed
- Added missing RATE_LIMIT_EXCEEDED error message
- Fixed branding: Updated all references from "Octra Wallet" to "0xio Wallet"
- Clarified SDK is for Octra Network/blockchain, not "0xio network"

---

## [1.0.0] - 2025-10-04

### Major Release - Production Ready

This is the first stable release of the 0xio Wallet SDK, a comprehensive bridge for dApps to connect to the 0xio Wallet extension on the Octra Network.

### Security Improvements
- **Fixed 8 critical wildcard origins** in postMessage communication
- **Origin validation**: All messages now validate against `window.location.origin`
- **Rate limiting**: Implemented 50 concurrent requests, 20 requests/second limits
- **Cryptographic request IDs**: Using `crypto.randomUUID()` instead of predictable sequential IDs
- **Professional code refactoring**: All files now include comprehensive JSDoc documentation

### Package Changes
- **Package renamed**: `@0xgery/wallet-sdk` → `@0xio/sdk`
- **Version bump**: 0.2.1 → 1.0.0 (production-ready)
- **Repository**: Published to https://github.com/0xGery/0xio-sdk
- **Homepage**: https://0xio.xyz

### Branding Updates
- SDK rebranded from "Octra Wallet SDK" to "0xio Wallet SDK"
- Wallet name: 0xio Wallet (for Octra Network)
- Currency: OCT (Octra Network's native gas token)

### Files Added
- LICENSE (MIT)
- .npmignore (excludes examples, source, docs from npm package)
- .gitignore (standard Node.js gitignore)
- Complete integration examples (React, Vue, Vanilla JS)

### Technical Improvements
- **JSDoc coverage**: 0% → 95%
- **Code quality**: Refactored all functions to <30 lines
- **Error handling**: Enhanced with detailed context and diagnostics
- **TypeScript**: Full type safety with comprehensive type definitions

### Breaking Changes
None - maintains backward compatibility with exported `OctraWallet` class (also exported as `ZeroXIOWallet`)

---

## [0.2.1] - 2025-09-09

### Changes
- Update debugging messages to use plain text formatting

---

## [0.2.0] - 2025-09-09

### Major Features Added

- **Built-in Extension Detection**: No longer requires wrapper polling - SDK automatically detects and monitors extension availability
- **Automatic Retry Logic**: Exponential backoff retry system for all extension requests (3 retries by default)
- **Enhanced Error Diagnostics**: Detailed error reporting showing specific failure causes, browser state, and extension diagnostics
- **Event-Based Communication**: Real-time extension events replace polling - instant updates for account changes, balance updates, network switches
- **Development Mode**: Comprehensive debugging tools with detailed logging for development environments

### Technical Improvements

#### Extension Detection
- Continuous background monitoring of extension availability
- Multiple detection methods: runtime checks, DOM signals, extension-specific indicators
- Automatic reconnection attempts when extension becomes available
- Detailed browser compatibility diagnostics

#### Retry & Error Handling
- Exponential backoff retry logic (1s, 2s, 4s delays)
- Enhanced error context with request IDs, retry counts, timestamps
- Browser and extension state diagnostics in error details
- Specific timeout handling with detailed failure information

#### Event System
- Real-time event forwarding from extension to SDK
- Automatic balance updates on transaction confirmations
- Account and network change detection and handling
- Extension lock/unlock state management
- Event-driven connection state management

#### Development Tools
- Advanced logging system with grouped output and table formatting
- Debug mode auto-detection for localhost/development environments
- Browser console utilities at `window.__ZEROXIO_SDK_UTILS__`
- Extension event simulation for testing
- Comprehensive SDK state inspection tools

### API Enhancements

#### New Utility Functions (now exported)
```typescript
// Validation
isValidAddress, isValidAmount, isValidMessage, isValidFeeLevel, isValidNetworkId

// Formatting
formatOCT, formatAddress, formatTimestamp, formatTxHash

// Conversion
toMicroOCT, fromMicroOCT

// Error handling
createErrorMessage, isErrorType

// Async utilities
delay, retry, withTimeout

// Browser support
isBrowser, checkBrowserSupport

// Development
generateMockData, createLogger
```

#### Enhanced Debug Information
- `getDebugInfo()` now includes extension diagnostics and availability state
- Real-time extension state monitoring
- Detailed browser environment detection

### Bug Fixes
- Fixed substr() deprecation warning (replaced with substring())
- Improved error handling for edge cases in extension communication
- Better cleanup of pending requests and event listeners
- Enhanced memory management for background processes

### Developer Experience
- Rich console output with grouped logging in development mode
- Automatic debug mode detection for development environments
- Extension event simulation tools for testing
- Comprehensive error messages with actionable information
- SDK state inspection utilities accessible from browser console

### Breaking Changes
None - this version maintains full backward compatibility with v0.1.x

### Performance Improvements
- Reduced polling overhead by switching to event-based communication
- More efficient extension detection with targeted checks
- Optimized retry logic to reduce unnecessary network calls
- Background monitoring with minimal CPU impact

---

## [0.1.2-dev] - Previous Version
- Initial SDK implementation
- Basic extension communication
- Core wallet operations
- Transaction handling
- Private transfer support
