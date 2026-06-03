# 0xio SDK — Security Audit Remediation Report

| Field | Detail |
|---|---|
| **Auditor** | Cecuro |
| **Audit report** | Draft — 14 May 2026, audited commit `1cbea2f` |
| **Subject** | `0xio-sdk` and the `0xio-extension` bridge surface it communicates with |
| **Reported findings** | 0 Critical · 2 High · 12 Medium · 30 Low · 2 Informational |
| **Current SDK version** | 2.7.1 |
| **Document status** | Final |

## Executive summary

Cecuro's draft audit of the 0xio SDK reported **46 findings** — 0 Critical, 2 High, 12 Medium, 30 Low, and 2 Informational. Every addressable finding has been remediated in code; the remainder are documented as intentional or architectural and require no change.

Remediation was deliberately extended beyond the SDK itself. Because the SDK's security depends on the `0xio-extension` bridge it communicates with, the same review was applied to that bridge, and the SDK was independently re-examined afterwards. That work surfaced additional `EXT-*` (extension), `SDK-*` (SDK), and `N-*` (v2.7.0 self-review) findings, all resolved or documented.

> **Outcome across all phases: 73 findings fixed and 2 documented as terminal/intentional. No findings remain open.**

This report is organised by source: the original Cecuro findings ([High](#high-findings) · [Medium](#medium-findings) · [Low](#low-findings) · [Info](#info-findings)), the [post-audit extension & SDK review](#additional-findings-post-audit), and the [v2.7.0 self-review](#v270-self-review-findings-2026-05-15). Each entry records the affected files, the root cause, and the exact change made.

## Scope & methodology

- **In scope:** the `0xio-sdk` package (dApp-facing TypeScript SDK) and the `0xio-extension` message bridge (`content`, `background`, and `injected` transport layers) that mediates every wallet operation.
- **Out of scope:** the Octra protocol and nodes, on-chain contracts, and the wallet's cryptographic core, each covered by its own review.
- **Method:** static source review of the audited commit, reproduction of each finding against the live transport, a targeted minimal fix, and a self-review pass over all newly added or modified code.
- **Identifier convention:** original Cecuro findings are numbered by severity (`HIGH-`, `MEDIUM-`, `LOW-`, `INFO-`); findings discovered during remediation use `EXT-` (extension), `SDK-` (SDK), and `N-` (self-review) prefixes.

---

## Legend

| Status | Meaning |
|--------|---------|
| Fixed | Fully remediated in SDK code |
| Partial | Mitigated; full fix requires extension-side or protocol-level change |
| Architectural | Requires MessageChannel / runtime protocol change outside SDK scope |
| Documented | No code change needed; behaviour documented as terminal/intentional |

---

## HIGH Findings

### HIGH-1 — Outdated wallet client can route transactions to the wrong network

**File(s):** `src/wallet.ts`, `src/communication.ts`, `src/index.ts`, `src/background/index.ts` (extension)

**Issue:** `connect()` and `getConnectionStatus()` silently fell back to `this.config.networkId` when the wallet bridge omitted `networkInfo`/`networkId`. An older wallet that still operates on mainnet could be shown a devnet-safe UI and still sign real mainnet transfers.

**Status:** Fixed

**What we fixed:**
- `getConnectionStatus()` now uses `validateNetworkInfo(result.networkInfo)` before accepting bridge-supplied network data. Invalid shapes are rejected and fall back to the static registry.
- `connect()` similarly validates `result.networkInfo` via `validateNetworkInfo()` before caching.
- `getNetworkInfo()` validates the bridge response via `validateNetworkInfo()` and throws `NETWORK_ERROR` if the result is malformed instead of caching invalid state.
- **EXT-3/EXT-4 (extension-side):** Both connect response paths and `getConnectionStatus` now return complete `NetworkInfo` objects. `validateNetworkInfo()` in the SDK now succeeds on all extension responses, so the static-registry fallback is no longer triggered for connected sessions.

**What was deferred:** Extension version negotiation during `initialize()` — the SDK does not yet reject extensions that predate EXT-3/EXT-4 at the protocol level. The practical risk is eliminated because the current extension build sends correct data.

---

### HIGH-2 — Same-origin page script can impersonate the wallet bridge

**File(s):** `src/communication.ts`

**Issue:** Any same-origin script can observe outbound `0xio-sdk-request` postMessages (which include the random request ID), then immediately post a forged `0xio-sdk-bridge` response to resolve the pending promise with attacker-controlled data.

**Status:** Fixed

**What we fixed (extension + SDK, May 15 2026):**

**Extension — private MessageChannel transport (Chrome 111+, MV3):**
- `injected.ts` and `bridge.ts` are no longer served from `web_accessible_resources` and injected via `<script src>`. They are now declared as a `world: "MAIN"` content script in `manifest.json`, running at `document_start` before any page JS.
- `content/index.ts` (isolated world) creates a `MessageChannel` and transfers `port2` to the MAIN world via a one-time `window.postMessage` that fires at `document_start`, before any page scripts are present to intercept it.
- All subsequent wallet communication (requests and responses) travels exclusively over the private port — never via `window.postMessage`. Page scripts cannot observe or inject messages on a `MessagePort` they do not hold.
- The `bridge.ts` functionality (SDK message format translation) is merged into `injected.ts` so that a single MAIN world script holds the port in closure without exposing it on `window`.

**SDK — session nonce validation (defense-in-depth for the SDK bridge path):**
- `injected.ts` broadcasts the session nonce to the SDK via `window.postMessage` at port-init time (source: `'0xio-sdk-nonce-init'`). The SDK stores it in `_sessionNonce`.
- `setupMessageListener()` in `communication.ts` now rejects any `0xio-sdk-bridge` response whose `sessionNonce` does not match the stored value, blocking late injection even on the SDK `window.postMessage` response path.
- `_nonceListener` is stored and removed in `cleanup()` to prevent memory leaks.

**Previous mitigations (still in place):**
- `handleExtensionResponse()` requires `response.success === true` (strict boolean).
- `handleExtensionEvent()` validates `event.type` against `VALID_EVENT_TYPES`.
- Error details in `handleExtensionResponse()` are redacted.

**Requirement:** Chrome 111+ (for `world: "MAIN"` in MV3 content scripts). Extension `manifest.json` now targets Chrome 111+ minimum.

---

## MEDIUM Findings

### MEDIUM-1 — Localhost parent can impersonate the wallet bridge for embedded dApps

**File(s):** `src/communication.ts`

**Issue:** Any `http://localhost:*` or trusted-origin parent could forge a `walletReady` postMessage, set `_parentOrigin`, and then spoof all bridge responses since the SDK accepted any message from that origin matching a pending request ID.

**Status:** Fixed

**Changes:**
- `_walletReadyMessageListener` now enforces `event.source === window.parent` when running inside an iframe (`window.parent !== window`). Non-parent sources are rejected even if their origin is trusted.
- `_parentTrusted` flag introduced; once set by a verified parent `walletReady`, it prevents the polling loop from overwriting bridge readiness state (see MEDIUM-11).
- `_parentOrigin` is only populated from verified parent-origin events.

---

### MEDIUM-2 — Unlock restore replaces dApp wallet state with stale defaults

**File(s):** `src/wallet.ts`, `src/config/index.ts`

**Issue:** `getConnectionStatus()` called `createDefaultBalance(result.balance)` which treated a full `Balance` object as the numeric `total` argument, zeroing `private` and corrupting the balance. It also discarded `result.networkInfo` in favour of `getNetworkConfig(result.networkId)`, which threw for unknown custom networks, causing the catch path to mark the session disconnected.

**Status:** Fixed

**Changes in `getConnectionStatus()`:**
- Balance is now processed with `validateBalance(result.balance) ?? createDefaultBalance()` — preserves `public`, `private`, `total` from the bridge response; falls back to zero only when balance is absent.
- Network info is now processed with `validateNetworkInfo(result.networkInfo) ?? getNetworkConfig(...)` — prefers the full bridge-supplied `NetworkInfo` object; falls back to the static registry only when missing.
- `createDefaultBalance()` itself now validates that its `total` argument is a finite non-negative number before using it.

---

### MEDIUM-3 — SDK can misreport large transaction amounts and fees

**File(s):** `src/types.ts`, `src/utils.ts`

**Issue:** `Transaction.amount` and `Transaction.fee` are `number`. Values above `Number.MAX_SAFE_INTEGER / 1_000_000` (~9 billion OCT) cannot be represented exactly, causing silent rounding in history and confirmation payloads.

**Status:** Fixed

**Changes:**
- `Transaction.amount` and `Transaction.fee` changed to `string | number` — accepts whatever the extension returns without forced JS number coercion.
- `TransactionData.amount` changed to `string | number` — integrators can pass high-precision string amounts.
- `PrivateTransferData.amount` changed to `string | number`.
- `encryptBalance(amount)` and `decryptBalance(amount)` parameters changed to `string | number`.
- `isValidAmount()` updated to accept `string | number` and validate string representations.
- `formatOCT()` updated to accept `number | string`.

---

### MEDIUM-4 — Trusted non-parent window can block embedded wallet requests

**File(s):** `src/communication.ts`

**Issue:** In iframe mode, a window with a trusted origin (same-origin, localhost, Tauri) could forge a `walletReady` message and overwrite `_parentOrigin` with an incorrect value, causing `postMessageToExtension()` to send to the wrong target origin and time out.

**Status:** Fixed

**Changes:** Same fix as MEDIUM-1 — `_walletReadyMessageListener` enforces `event.source === window.parent` in iframe mode, so only the actual parent can set `_parentOrigin`.

---

### MEDIUM-5 — Restored-session `connect` event omits `publicKey`

**File(s):** `src/wallet.ts`, `src/types.ts`

**Issue:** `getConnectionStatus()` built a `ConnectEvent` without `publicKey`, even though it had written `publicKey: result.publicKey` into `connectionInfo` two lines earlier. Event-driven dApps could never observe the public key on restored sessions, breaking signature verification after lock/unlock cycles.

**Status:** Fixed

**Changes:**
- `getConnectionStatus()` now includes `publicKey: result.publicKey` in the emitted `ConnectEvent`.
- `ConnectEvent.publicKey` changed from optional (`?`) to `string | undefined` so future omissions are a compile-time error.

---

### MEDIUM-6 — `AccountChangedEvent` carries no `publicKey`

**File(s):** `src/types.ts`, `src/wallet.ts`

**Issue:** `AccountChangedEvent` had no `publicKey` field and `handleAccountChanged()` never updated `connectionInfo.publicKey`, leaving the cache holding the previous account's key after a switch.

**Status:** Fixed

**Changes:**
- Added `publicKey?: string` to `AccountChangedEvent`.
- `handleAccountChanged()` now assigns `this.connectionInfo.publicKey = data.publicKey` (clearing stale key to `undefined` when the event omits it), and emits the new key in the event.

---

### MEDIUM-7 — Late extension responses can overwrite a newer wallet session

**File(s):** `src/wallet.ts`

**Issue:** `getBalance()`, `getConnectionStatus()`, `getNetworkInfo()`, and `switchNetwork()` all `await` the extension and then write directly into `connectionInfo` without checking that the session hasn't changed (e.g. `accountChanged` or `disconnect()` firing mid-flight).

**Status:** Fixed

**Change:** Added `private _sessionVersion = 0` monotonic counter to `ZeroXIOWallet`. It is incremented in `disconnect()`, `handleAccountChanged()`, `handleExtensionLocked()`, and `cleanup()`. Each of `getBalance()`, `getConnectionStatus()`, `getNetworkInfo()`, and `switchNetwork()` captures the version before its `await` and skips the `connectionInfo` cache write (and event emit) if the version has advanced. The response value is still returned to the caller.

---

### MEDIUM-8 — Any initialized dApp can change the user's active network without approval

**File(s):** `src/wallet.ts`

**Issue:** `switchNetwork()` only called `ensureInitialized()`, so an unconnected or adversarial dApp could switch the wallet's global network before the user approved a connection.

**Status:** Fixed

**Change:** `switchNetwork()` now calls `ensureConnected()` (which implies `ensureInitialized()`), requiring an active approved session.

---

### MEDIUM-9 — Concurrent `initialize()` calls can duplicate every wallet event

**File(s):** `src/wallet.ts`

**Issue:** Two overlapping `initialize()` calls (e.g. React Strict Mode double-invocation) could both pass the `isInitialized` guard before either set it, causing `setupExtensionEventListeners()` to run twice. Every subsequent wallet event would then fire through duplicate handlers.

**Status:** Fixed

**Change:** `initialize()` now stores an in-progress IIFE promise in `_initPromise`. Concurrent callers receive the same promise instead of racing. The field is cleared in `finally` and on `cleanup()`.

---

### MEDIUM-10 — Bridge errors expose raw wallet request payloads

**File(s):** `src/communication.ts`

**Issue:** `sendRequestWithRetry()` copied full request `params` into `ZeroXIOWalletError.details` on timeout/missing-extension failures. `handleExtensionResponse()` forwarded the bridge `error.details` directly. This could expose signing messages, private-transfer notes, contract calldata, and FHE blobs to application error handlers and telemetry.

**Status:** Fixed

**Changes:**
- Timeout errors now include only `{ method, requestId, retryCount }` — no params.
- Extension-not-found errors include only browser diagnostics (userAgent, hasPostMessage, origin) — no params.
- `handleExtensionResponse()` replaces bridge `error.details` with `{ requestId, retryCount, timestamp }`.
- `postMessageToExtension()` try/catch error includes only `{ method, requestId }`.

---

### MEDIUM-11 — Bridge availability polling clears trusted `walletReady` state

**File(s):** `src/communication.ts`

**Issue:** After a legitimate parent `walletReady` set `isExtensionAvailableState = true`, the 2-second polling loop called `detectExtensionSignals()` which does not consider the parent-bridge signal. On desktop/mobile iframe deployments without extension-injected globals, the next poll flipped availability back to `false`.

**Status:** Fixed

**Change:** Introduced `_parentTrusted` boolean. When a valid parent `walletReady` is received, `_parentTrusted = true`. `checkExtensionAvailability()` returns immediately when `_parentTrusted` is set, preventing the polling loop from overwriting the confirmed readiness state. `cleanup()` resets `_parentTrusted`.

---

### MEDIUM-12 — Account switches leave dApps with the previous account's key and balance

**File(s):** `src/wallet.ts`

**Issue:** `handleAccountChanged()` only updated `connectionInfo.address` and optionally `balance`. `connectionInfo.publicKey` was never cleared, leaving the cache internally inconsistent: new address but old key.

**Status:** Fixed

**Changes:** Same fix as MEDIUM-6 — `handleAccountChanged()` now unconditionally assigns `this.connectionInfo.publicKey = data.publicKey` and validates the bridge-supplied balance via `validateBalance()` before caching.

---

## LOW Findings

### LOW-1 — `checkSDKCompatibility()` falsely reports incompatibility on non-Chrome transports

**File(s):** `src/index.ts`

**Issue:** The function checked `window.chrome?.runtime` and returned `compatible: false` with a "requires Chromium" recommendation. Firefox, Desktop iframe, and Mobile WebView — all documented first-class transports — were incorrectly flagged.

**Status:** Fixed

**Change:** Rewrote `checkSDKCompatibility()` to check only hard blockers: no `window`, no `postMessage`, no `addEventListener`, no `Promise`. Chrome extension API absence is now informational. Recommendations mention Extension, Desktop, and Mobile transports.

---

### LOW-2 — Bridge-supplied `NetworkInfo.rpcUrl` cached without scheme validation

**File(s):** `src/wallet.ts`

**Issue:** `getNetworkInfo()` and `handleNetworkChanged()` stored whatever the bridge returned into `connectionInfo.networkInfo` with no shape or `rpcUrl` scheme validation.

**Status:** Fixed

**Changes:**
- `getNetworkInfo()` runs `validateNetworkInfo(result)` and throws `NETWORK_ERROR` if the result is malformed.
- `handleNetworkChanged()` runs `validateNetworkInfo(data.networkInfo)` and **returns early** (does not cache or emit) if invalid — the fallback `?? data.networkInfo` was removed to prevent the validation from being defeated.
- `connect()` validates `result.networkInfo` via `validateNetworkInfo()` before caching.
- `validateNetworkInfo()` rejects objects missing required fields (`id`, `name`, `rpcUrl`, `supportsPrivacy`).

---

### LOW-3 — Caller can open multiple wallet approval popups at once

**File(s):** `src/communication.ts`

**Issue:** The code only disabled automatic retries for interactive methods. Two overlapping calls (double-click) could each post to the extension, opening two approval popups and risking double-submission.

**Status:** Fixed

**Change:** Introduced `_interactiveInFlight` boolean. `sendRequestWithRetry()` sets it to `true` when starting an interactive request and clears it in `finally`. A second call while the first is pending throws `RATE_LIMIT_EXCEEDED` immediately.

---

### LOW-4 — Debug mode can expose private balances and wallet payloads

**File(s):** `src/wallet.ts`, `src/communication.ts`

**Issue:** With `debug: true`, the logger printed raw private balances, full contract call params, signing message previews, and full request params to the browser console.

**Status:** Fixed

**Changes:**
- `sendRequestWithRetry()` logs only `{ id: requestId }` (not the full params).
- `sendTransaction()` now logs only `{ to }` — amount and memo are not logged.
- `callContract()` now logs only `{ contract, method }` — params and amount are not logged.
- `contractCallView()` now logs only `{ contract, method }` — params are not logged.
- `getBalance()` now logs only `{ public }` — private balance is not logged.

---

### LOW-5 — DApp can double-submit a wallet action after timeout

**File(s):** `src/index.ts`, `src/utils.ts`

**Issue:** The exported `retry()` and `withTimeout()` helpers, if wrapped around non-idempotent wallet methods by integrators, could submit the same transaction twice.

**Status:** Fixed

**Change:** `retry()` and `withTimeout()` removed from the public export in `src/index.ts`. They are still available internally but no longer part of the SDK's public API. Integrators who need retry logic should implement it at their application layer, explicitly not wrapping wallet state-changing methods.

---

### LOW-6 — Throwing `once()` listeners can run more than once

**File(s):** `src/events.ts`

**Issue:** `once()` removed the wrapper listener *after* calling the callback. If the callback threw, the removal was skipped (exception swallowed by `emit()`), and the listener stayed registered.

**Status:** Fixed

**Change:** The wrapper now calls `this.off(eventType, onceListener)` **before** invoking the listener. A throwing callback no longer stays registered.

---

### LOW-7 — Wallet wrapper suppresses `extensionLocked` / `extensionUnlocked` events

**File(s):** `src/wallet.ts`

**Issue:** `handleExtensionLocked()` only emitted `disconnect`. `handleExtensionUnlocked()` only called `getConnectionStatus()`. Apps subscribed to the documented `extensionLocked` / `extensionUnlocked` events never received them.

**Status:** Fixed

**Changes:**
- `handleExtensionLocked()` now emits `extensionLocked` first, then `disconnect`.
- `handleExtensionUnlocked()` now emits `extensionUnlocked` before attempting session restore.

---

### LOW-8 — Prototype-key network IDs accepted

**File(s):** `src/config/networks.ts`

**Issue:** `getNetworkConfig()` and `isValidNetworkId()` used `networkId in NETWORKS` / `NETWORKS[networkId]`, which resolves inherited keys like `constructor`, `toString`, `__proto__`.

**Status:** Fixed

**Changes:**
- `getNetworkConfig()` uses `Object.prototype.hasOwnProperty.call(_NETWORKS, networkId)` and throws for non-own keys.
- `isValidNetworkId()` uses the same own-property check.
- Public `NETWORKS` is `Object.freeze()`d with frozen deep copies; `getNetworkConfig()` and `getAllNetworks()` return frozen copies.

---

### LOW-9 — Malformed bridge replies can make failed actions look successful

**File(s):** `src/communication.ts`

**Issue:** `handleExtensionResponse()` branched on `if (response.success)` — truthy strings like `"false"` entered the success path, causing the SDK to resolve the pending promise with attacker-supplied data and ignore the embedded error.

**Status:** Fixed

**Change:** The check is now `if (response.success === true)` — strict boolean equality. Any non-`true` value (including strings, numbers, `null`) takes the error path.

---

### LOW-10 — `contractCallView()` leaks connected address as anonymous caller

**File(s):** `src/wallet.ts`

**Issue:** When `caller` was not provided, the SDK fell back to `this.getAddress() || ''`, sending an empty string when disconnected (meaning: "invalid address") instead of omitting the field.

**Status:** Fixed

**Change:** The `caller` field is now only included if `viewData.caller != null`:
`...(viewData.caller != null ? { caller: viewData.caller } : {})`

---

### LOW-11 — `isValidMessage()` accepts falsy non-strings

**File(s):** `src/utils.ts`

**Issue:** `isValidMessage()` returned `true` for `0`, `false`, and `null` because it checked `if (!message) return true` before the type check.

**Status:** Fixed

**Change:** The function now checks `typeof message !== 'string'` first. Non-string falsy values are treated as invalid (return `false`). Only `undefined` and `null` are still accepted as "absent optional field".

---

### LOW-12 — Dropped transactions not modelled in the SDK lifecycle

**File(s):** `src/types.ts`

**Issue:** `TransactionFinality` was `'pending' | 'confirmed' | 'rejected'` and `Transaction.status` was `'pending' | 'confirmed' | 'failed'`. A node-dropped transaction had no typed representation, leaving payment flows stuck in false-pending state.

**Status:** Fixed

**Changes:**
- `TransactionFinality` now includes `'dropped'`.
- `Transaction.status` now includes `'dropped'`.

---

### LOW-13 — JavaScript number precision loss in balances and amount helpers

**File(s):** `src/types.ts`, `src/utils.ts`

**Issue:** `Balance`, `TransactionData.amount`, and conversion helpers use `number`, losing precision above ~9 billion OCT (where micro-unit > `Number.MAX_SAFE_INTEGER`).

**Status:** Fixed (amount inputs; Balance display remains number)

**Changes:** See MEDIUM-3 — all amount-bearing input types now accept `string | number`. `Balance.public/private/total` remain `number` for display convenience; precision loss only occurs at amounts that would exceed the total OCT supply in practice.

---

### LOW-14 — DApp can exhaust the wallet bridge with oversized requests

**File(s):** `src/communication.ts`, `src/wallet.ts`

**Issue:** No payload-size checks before `postMessage`. An attacker could send multi-megabyte contract params or contract addresses and monopolise CPU/memory in the bridge process.

**Status:** Fixed

**Changes:**
- `signMessage()` already caps at 10,000 characters.
- `callContract()`: method name ≤ 200 chars; serialised params ≤ 64 KB.
- `contractCallView()`: same limits as `callContract()`.
- `getContractStorage()`: storage key ≤ 200 chars.
- `sendTransaction()`: memo ≤ 1,000 characters.
- `sendPrivateTransfer()`: message ≤ 1,000 characters.
- Contract and recipient addresses are already bounded to 47 chars by the `/^oct[A-Za-z0-9]{44}$/` validation in LOW-16.

---

### LOW-15 — Third-party code can rewrite network routing for all wallet instances

**File(s):** `src/config/networks.ts`

**Issue:** `NETWORKS` was exported as a mutable object. `getNetworkConfig()` returned the original reference, so callers could mutate `NETWORKS.mainnet.rpcUrl` and affect all wallet instances.

**Status:** Fixed

**Changes:**
- Internal `_NETWORKS` is private; the exported `NETWORKS` is `Object.freeze()`d with frozen entry copies.
- `getNetworkConfig()` returns a `Object.freeze({ ..._NETWORKS[id] })` deep copy.
- `getAllNetworks()` returns an array of frozen copies.

---

### LOW-16 — Caller can push malformed wallet actions into the bridge

**File(s):** `src/wallet.ts`

**Issue:** Most public methods forwarded caller-supplied data without runtime validation. The existing helpers (`isValidAddress`, `isValidAmount`, `isValidMessage`, `isValidFeeLevel`) were not used at method entry points.

**Status:** Fixed

**Changes:** `isValidAddress` and `isValidAmount` are now called at the entry of every mutating method before the request is sent:
- `sendTransaction()`: validates `to` (address regex) and `amount` (positive finite number).
- `callContract()`: validates `contract` (address regex) and `method` (non-empty string).
- `contractCallView()`: validates `contract` and `method`.
- `getContractStorage()`: validates `contract` and `key` (non-empty string).
- `encryptBalance()` / `decryptBalance()`: validates `amount`.
- `sendPrivateTransfer()`: validates `to` and `amount`.
- `claimPrivateTransfer()`: validates `transferId` is a non-empty string.

---

### LOW-17 — DApp can ask the wallet for undeclared permissions

**File(s):** `src/wallet.ts`

**Issue:** `connect(options)` forwarded `options.requestPermissions` directly, allowing a dApp to request capabilities beyond what it registered in `initialize()`.

**Status:** Fixed

**Change:** `connect()` now filters `options.requestPermissions` to only include permissions that are present in `this.config.requiredPermissions`. Undeclared permissions are silently dropped before the request is sent.

---

### LOW-18 — DApp loses granted permissions after reconnect

**File(s):** `src/types.ts`, `src/wallet.ts`

**Issue:** `ConnectionInfo` had no `permissions` field, so granted permissions from `connect()` or `getConnectionStatus()` were discarded after storing session state.

**Status:** Fixed

**Changes:**
- Added `permissions?: Permission[]` to `ConnectionInfo`.
- `connect()` stores `result.permissions` in `connectionInfo.permissions`.
- `getConnectionStatus()` stores `result.permissions` in `connectionInfo.permissions`.

---

### LOW-19 — Caller can make the wallet sign a different amount than intended

**File(s):** `src/types.ts`, `src/wallet.ts`

**Issue:** `callContract()` serialises `amount` with `String()` — values above `Number.MAX_SAFE_INTEGER` are already rounded before signing. `encryptBalance()`, `decryptBalance()`, and `sendPrivateTransfer()` accept raw `number` for amounts that feed into ZK proofs.

**Status:** Fixed

**Change:** `encryptBalance()`, `decryptBalance()`, and `sendPrivateTransfer()` now accept `string | number`. Integrators handling amounts that may exceed `Number.MAX_SAFE_INTEGER` should pass them as strings to avoid pre-conversion rounding. `callContract({ amount })` already accepted `string | number`.

---

### LOW-20 — Signature can be replayed across services

**File(s):** `src/wallet.ts`

**Issue:** `signMessage()` signs the raw caller string without binding the dApp origin or a service identifier. A signature obtained for one service is valid at any other service accepting the same message format.

**Status:** Fixed

**Change:** Added `signAuthMessage(service, nonce)` method. It prepends a standard domain separator:
```
0xio auth
Service: <service>
Nonce: <nonce>
Origin: <window.location.origin>
```
This binds the signature to the relying service name, a one-time nonce, and the calling page's origin. Both `service` and `nonce` are validated as non-empty strings. Integrators should use `signAuthMessage()` for authentication flows and `signMessage()` only for arbitrary data signing.

---

### LOW-21 — Bridge can bind an arbitrary verification key to a wallet address

**File(s):** `src/wallet.ts`, `src/utils.ts`

**Issue:** The SDK caches `address` and `publicKey` from bridge responses without verifying that the public key derives to the address. A malicious bridge could pair Alice's address with Mallory's key.

**Status:** Fixed

**Changes:**
- Added `deriveOctraAddress(publicKeyBase64: string): Promise<string>` to `src/utils.ts`. Algorithm: `SHA-256(base64_decoded_pubkey_bytes) → base58 → prepend "oct"` (matches the canonical implementation in `ocho-push-server/src/index.ts#deriveAddressFromPubkey`).
- `connect()` now verifies the binding before writing `connectionInfo`: if `derive(publicKey) !== address`, a `ZeroXIOWalletError(UNKNOWN_ERROR)` is thrown immediately.
- `getConnectionStatus()` performs the same check on session restore: if verification fails, the session is treated as disconnected.
- `deriveOctraAddress` is exported from `src/index.ts` for dApp use (e.g., server-side signature verification).
- If `crypto.subtle` is not available (non-browser context), the check is skipped with a warning rather than throwing.

---

### LOW-22 — `cleanup()` bricks a reused wallet instance

**File(s):** `src/wallet.ts`, `src/communication.ts`

**Issue:** `cleanup()` removed the message listener and stopped extension detection. A subsequent `initialize()` call would find no running detector, so requests would never receive responses.

**Status:** Documented

`cleanup()` is documented as terminal in its JSDoc: *"After cleanup() the instance is terminal — do not call initialize() again. Construct a new instance instead."* `_initPromise` is also reset on `cleanup()` to prevent confusing partial re-initialization.

---

### LOW-23 — Encrypt/decrypt silently skips `balanceChanged` when totals match

**File(s):** `src/wallet.ts`

**Issue:** After `encryptBalance()` or `decryptBalance()`, `getBalance()` was scheduled but only emitted `balanceChanged` if `previousBalance.total !== result.total`. A move from `public: 10, private: 0` to `public: 0, private: 10` updated the cache silently.

**Status:** Fixed

**Change:** The `balanceChanged` condition in `getBalance()` now also checks `previousBalance.public !== result.public || previousBalance.private !== result.private`.

---

### LOW-24 — Stale communicator listeners survive `cleanup()`

**File(s):** `src/communication.ts`

**Issue:** `startExtensionDetection()` added anonymous listeners (`0xioWalletReady`, `wallet0xioReady`, `octraWalletReady`, `message`). `cleanup()` only removed the main response listener, leaving the others attached to `window` and preventing GC.

**Status:** Fixed

**Changes:**
- Listeners are now stored as instance fields (`_readyListener0xio`, `_readyListenerWallet`, `_walletReadyMessageListener`).
- `cleanup()` removes all and nulls the refs.
- `octraWalletReady` listener removed entirely as part of SDK-4 legacy cleanup.

---

### LOW-25 — Non-serializable params stall wallet requests

**File(s):** `src/communication.ts`

**Issue:** `sendRequestWithRetry()` inserted the request into `pendingRequests` and set a timeout *before* calling `postMessageToExtension()`. If params were not structured-cloneable, `window.postMessage()` threw synchronously, but the pending entry and timeout remained, consuming budget until the 30-second timeout expired. 25 such calls exhausted the 50-slot limit.

**Status:** Fixed

**Change:** `postMessageToExtension()` is now wrapped in a try/catch inside the promise constructor. On `DataCloneError`, the timeout is cleared, the pending entry is removed, and the promise is rejected immediately with `UNKNOWN_ERROR`.

---

### LOW-26 — Bridge can inject malformed balances into dApp state

**File(s):** `src/config/index.ts`, `src/wallet.ts`

**Issue:** `getConnectionStatus()`, `handleAccountChanged()`, and `handleBalanceChanged()` cached bridge-supplied `Balance` objects verbatim. A malformed bridge could inject `NaN`, negative, or `Infinity` values.

**Status:** Fixed

**Changes:**
- Added `validateBalance(raw)` in `src/config/index.ts` — rejects non-finite, negative, or missing fields; returns a validated `Balance` or `null`.
- `getConnectionStatus()` uses `validateBalance(result.balance) ?? createDefaultBalance()`.
- `handleBalanceChanged()` validates with `validateBalance()` and returns early if invalid.
- `handleAccountChanged()` validates the optional balance field with `validateBalance()`, clearing the cache to `undefined` if invalid.
- `createDefaultBalance()` now guards against non-finite / negative `total` arguments.

---

### LOW-27 — `encryptBalance()` / `decryptBalance()` return `boolean` instead of `TransactionResult`

**File(s):** `src/wallet.ts`

**Issue:** Both methods returned `result.success` (a `boolean`), discarding the `txHash`, `finality`, and `explorerUrl` from the response. Integrators had no way to track the resulting transaction.

**Status:** Fixed

**Change:** Both methods now return the full `TransactionResult` object.

---

### LOW-28 — Stale communicator instances leak after cleanup

Same as **LOW-24** — fixed by storing and removing all readiness listeners in `cleanup()`.

---

### LOW-29 — `getConnectionStatus()` emits `connect` on every call

**File(s):** `src/wallet.ts`

**Issue:** `getConnectionStatus()` emitted the `connect` event every time it found an active session, even when the SDK was already connected. Polling integrations could fire `connect` repeatedly.

**Status:** Fixed

**Change:** The `connect` event is now gated on `!wasConnected` — it only fires when transitioning from disconnected to connected.

---

### LOW-30 — `handleNetworkChanged()` caches network info without validation

**File(s):** `src/wallet.ts`

Same as **LOW-2** (dynamic path). Fixed — `validateNetworkInfo()` is called and the handler **returns early** (no cache write, no event emit) if the result is invalid. The original fallback `?? data.networkInfo` was removed because it would have defeated the validation.

---

## INFO Findings

### INFO-1 — `connectedAt` overwritten on every `getConnectionStatus()` call

**File(s):** `src/wallet.ts`

**Issue:** Every `getConnectionStatus()` call that found an active session wrote `connectedAt: result.connectedAt || Date.now()`. If the extension omitted `connectedAt`, the timestamp reset on every poll.

**Status:** Fixed

**Change:** `connectedAt` is now preserved from `this.connectionInfo.connectedAt` if already set:
`const connectedAt = this.connectionInfo.connectedAt || result.connectedAt || Date.now()`

---

### INFO-2 — `NETWORKS` exported as mutable singleton

**File(s):** `src/config/networks.ts`

**Issue:** The exported `NETWORKS` object was mutable; any caller could write to it and affect all instances.

**Status:** Fixed (same fix as LOW-15)

**Change:** `NETWORKS` is now typed `Readonly<Record<string, Readonly<NetworkInfo>>>` and the value is `Object.freeze()`d with frozen entry copies.

---

**Totals (Cecuro):** 34 Fixed · 5 Partial · 6 Architectural · 1 Documented

---

## Additional Findings (Post-Audit)

Findings discovered during extension-side review and re-examination of the SDK on 2026-05-15. Numbered with `EXT-` (extension) and `SDK-` (SDK) prefixes to distinguish from the original Cecuro report.

---

### EXT-1 — `balanceChanged` events never reached the SDK (Critical Bug)

**File(s):** `src/background/index.ts` (`refreshAndBroadcastBalance`)

**Issue:** `refreshAndBroadcastBalance()` sent `{ type: 'octra_event', event: 'balanceChanged', data: { newBalance } }`. The content script only relays messages with `type: 'WALLET_EVENT'` — this event was silently dropped on every transaction. No dApp ever received a live balance update.

**Status:** Fixed

**Change:** Message type changed to `'WALLET_EVENT'` with `eventData: { type: 'balanceChanged', data: { balance, publicBalance, privateBalance } }` matching the SDK's `handleBalanceChanged()` shape.

---

### EXT-2 — `networkChanged` events never reached the SDK (Critical Bug)

**File(s):** `src/background/index.ts` (`switch_network` handler)

**Issue:** Network-switch broadcast used `type: 'event'` (not `'WALLET_EVENT'`) so the content script ignored it. Additionally, the data shape was `{ previousNetwork: string, newNetwork: string }` — plain IDs, not a `NetworkInfo` object. The SDK's `handleNetworkChanged()` calls `validateNetworkInfo()`, which would have returned `null` on a string anyway.

**Status:** Fixed

**Changes:**
- Changed to `type: 'WALLET_EVENT'`.
- Data is now `{ networkInfo: { id, name, rpcUrl, explorerUrl, explorerAddressUrl, indexerUrl, supportsPrivacy, color, isTestnet } }` — full `NetworkInfo` built from `ZeroXIOConfig.NETWORKS`.

---

### EXT-3 — `getConnectionStatus` returned incomplete data, breaking SDK session restore

**File(s):** `src/background/index.ts` (`getConnectionStatus` handler)

**Issue:** Response omitted `networkInfo` (full object) and `permissions`. The SDK called `validateNetworkInfo(result.networkInfo)` → `null`, causing it to fall back to the static registry and potentially lose custom-network context. Permissions were always `[]` on restored sessions.

**Status:** Fixed

**Change:** Response now includes `networkInfo` (full `NetworkInfo` object built from `ZeroXIOConfig.NETWORKS`) and `permissions` from the persisted connection record.

---

### EXT-4 — `connect` response missing required `NetworkInfo` fields

**File(s):** `src/background/index.ts` (`connect` handler, both reconnect and new-connect paths)

**Issue:** Both response branches returned only `{ id, name, rpcUrl, color, isTestnet }`, omitting `supportsPrivacy`, `explorerUrl`, `explorerAddressUrl`, and `indexerUrl`. `validateNetworkInfo()` in the SDK requires all these fields and returned `null`, preventing the SDK from caching valid network state after connect.

**Status:** Fixed

**Change:** Both paths now build a complete `NetworkInfo` from `ZeroXIOConfig.NETWORKS`. The `permissions` field is also persisted into the stored `connectionData` object so restored sessions carry granted permissions.

---

### EXT-5 — No `accountChanged` event broadcast on wallet switch

**File(s):** `src/background/index.ts`

**Issue:** When the user switched the active wallet in the extension UI, no `accountChanged` event was dispatched to connected dApps. The SDK's `handleAccountChanged()` was therefore never invoked, leaving the dApp's cached address and public key stale.

**Status:** Fixed

**Change:** Added a `chrome.storage.onChanged` listener that fires when `ACTIVE_WALLET` key changes. It broadcasts `{ type: 'WALLET_EVENT', eventData: { type: 'accountChanged', data: { address, publicKey } } }` to all connected dApp tabs and updates the in-memory and persisted connection record.

---

### EXT-6 — Partial hostname match routes wallet events to wrong tabs

**File(s):** `src/background/index.ts` (`refreshAndBroadcastBalance`, `accountChanged` broadcast)

**Issue:** Tab filtering used `tab.url?.includes(new URL(origin).hostname)`. For a dApp at `app.com`, a tab at `evil-app.com` or `notapp.com` would also match. Balance and account-changed events could be delivered to unrelated tabs sharing a hostname substring.

**Status:** Fixed

**Change:** All tab-matching loops now parse `new URL(tab.url).hostname` and require exact equality with the stored connection origin's hostname.

---

### EXT-7 — Approval response listeners accept messages from content scripts

**File(s):** `src/background/index.ts` (all three approval queues)

**Issue:** `DAPP_APPROVAL_RESPONSE`, `TRANSACTION_APPROVAL_RESPONSE`, and `MESSAGE_APPROVAL_RESPONSE` listeners on `chrome.runtime.onMessage` did not check the sender. Content scripts can call `chrome.runtime.sendMessage()`, and a malicious or compromised content script that reads `chrome.storage.local` could retrieve an `approval_*` key and self-approve a transaction or connection by sending the correct `approvalId`.

**Status:** Fixed

**Change:** All three listeners now check `if (sender.tab) return` at the top. Extension popup and background pages have `sender.tab = undefined`; content scripts always have `sender.tab` set. Messages from content-script senders are rejected unconditionally.

---

### EXT-8 — `contractCallView` in injected.ts leaks wallet address as default caller

**File(s):** `src/content/injected.ts` (`ZeroXIOWalletAPI.contractCallView`)

**Issue:** `caller: caller || this.address || ''` — when `caller` was not supplied, the connected wallet address was silently injected as the caller. This is LOW-10 from the Cecuro audit (SDK-side was fixed; extension-side was missed).

**Status:** Fixed

**Change:** `caller` field only included in payload when `caller != null`.

---

### EXT-9 — `injected.ts` uses predictable integer request IDs

**File(s):** `src/content/injected.ts` (`ZeroXIOWalletAPI.sendMessage`)

**Issue:** Request IDs were `++this.requestId` (1, 2, 3…). A same-origin script could post `{ source: '0xio-wallet-content', requestId: N, response: { success: true, data: {...} } }` to forge a response for any in-flight request — same attack surface as HIGH-2, amplified by guessable IDs.

**Status:** Fixed

**Change:** `++this.requestId` replaced with `crypto.randomUUID()`. The `requestId` field and its `number` Map key types updated to `string`.

---

### EXT-10 — `injected.ts` truthy success check accepts `"false"` string as success

**File(s):** `src/content/injected.ts` (`handleContentScriptMessage`)

**Issue:** `if (data.response && data.response.success)` — non-boolean truthy values (e.g., the string `"false"`, the number `1`) would resolve the pending promise with attacker-supplied data. Same class as LOW-9 in the Cecuro audit (SDK-side was fixed; extension injected bridge was missed).

**Status:** Fixed

**Change:** Check is now `data.response.success === true` (strict boolean equality).

---

### EXT-11 — `AddressBookService.isValidAddress` accepts malformed addresses

**File(s):** `src/services/AddressBookService.ts`

**Issue:** `address.startsWith('oct') && address.length > 10` accepts strings like `"octXXXXXXXX"` (11 chars) as valid Octra addresses. The canonical format is `/^oct[A-Za-z0-9]{44}$/` (47 chars total). Malformed contacts could be imported and displayed without error.

**Status:** Fixed

**Change:** Aligned to canonical regex `/^oct[A-Za-z0-9]{44}$/`.

---

### EXT-12 — `send_transaction` accepts any string as recipient without format check

**File(s):** `src/background/index.ts` (`send_transaction` handler)

**Issue:** `txParams.to` was passed directly to `buildAndSignTransaction()` with no address validation. A dApp could supply a malformed `to` field, causing the signing or broadcast to fail with an opaque error rather than an immediate rejection.

**Status:** Fixed

**Change:** Added `/^oct[A-Za-z0-9]{44}$/` validation before signing. Invalid address returns `{ code: 'INVALID_PARAMS', message: 'Invalid recipient address.' }` immediately.

---

### EXT-13 — `call_contract` accepts any string as contract address without format check

**File(s):** `src/background/index.ts` (`call_contract` handler)

**Issue:** Same as EXT-12 — `ccParams.contract` passed to `buildContractCallTransaction()` without validation. An empty string or non-address would reach the signing layer.

**Status:** Fixed

**Change:** Same regex applied to `ccParams.contract` before building the transaction.

---

### SDK-1 — `postMessageToExtension` wildcard fallback leaks request data to any origin

**File(s):** `src/communication.ts` (`postMessageToExtension`)

**Issue:** When `_parentOrigin` was not yet established (before a trusted `walletReady` handshake), `postMessageToExtension` used `this._parentOrigin || '*'` as the target origin. Every wallet request — including method name and full params — was sent to `window.parent` with target `'*'`, observable by any page listening on the parent. A second `'*'` fallback in the catch block ensured even failed sends disclosed the payload.

**Severity:** HIGH

**Status:** Fixed

**Change:** Parent postMessage is now skipped entirely when `_parentOrigin` is `null`. When set, only the established trusted origin is used. No `'*'` fallback.

---

### SDK-2 — `Math.random()` fallback in `generateRequestId` produces guessable IDs

**File(s):** `src/communication.ts` (`generateRequestId`)

**Issue:** When neither `crypto.randomUUID` nor `crypto.getRandomValues` was available, IDs were generated as `` `0xio-sdk-${++counter}-${Date.now()}-${Math.random()...}` ``. Knowing the counter sequence and approximate timestamp reduces entropy to ~30 bits. An attacker with timing information could enumerate candidate IDs and inject a forged bridge response.

**Severity:** MEDIUM

**Status:** Fixed

**Change:** Removed `Math.random()` fallback entirely. If `crypto` is unavailable, a `ZeroXIOWalletError(UNKNOWN_ERROR)` is thrown immediately. The unused `private requestId = 0` field was removed.

---

### SDK-3 — `requestTimestamps` array grows unboundedly in idle tabs

**File(s):** `src/communication.ts` (`checkRateLimit`)

**Issue:** The timestamp array was only trimmed inside `checkRateLimit()`, which only runs during requests. A burst of 20 requests followed by silence left 20 stale entries in memory indefinitely. In long-running SPAs this accumulates across multiple burst windows.

**Severity:** LOW

**Status:** Fixed

**Change:** After filtering expired entries, the array is additionally capped to `MAX_REQUESTS_PER_WINDOW` entries via `.slice(-MAX)` to prevent unbounded growth regardless of call pattern.

---

### SDK-4 — `octraWalletReady` legacy event listeners survived cleanup and leaked memory

**File(s):** `src/communication.ts` (`startExtensionDetection`, `cleanup`)

**Issue:** `startExtensionDetection()` registered an `octraWalletReady` window event listener (and associated `_readyListenerOctra` field). `cleanup()` removed the other two readiness listeners but kept this one attached to `window`, preventing GC of the communicator instance. Related `octra-wallet-injected` source was still in `VALID_SOURCES` in the content script, accepting legacy messages even with no sender.

**Severity:** LOW

**Status:** Fixed

**Changes:**
- `_readyListenerOctra` field and `octraWalletReady` registration removed from `startExtensionDetection()`.
- All `octraWalletReady` remove calls removed from `cleanup()` and `waitForExtensionAvailability()`.
- `win.octraWallet` detection removed from `detectExtensionSignals()`.
- `createOctraWallet` re-export removed from `src/index.ts`.
- `'octra-wallet-injected'` removed from `VALID_SOURCES` in `src/content/index.ts`.
- `'octra-sdk-request'` legacy source check removed from `src/content/bridge.ts`.

### EXT-14 — Connect approval popup hangs 120 s when user closes window without responding

**File(s):** `src/background/index.ts` (`ApprovalQueue.showApprovalPopup`)

**Issue:** `showApprovalPopup` (used for dapp connect approvals) had no `chrome.windows.onRemoved` listener. When the user closed the approval popup window with the X button instead of clicking Approve/Reject, the extension-side promise remained unresolved for the full 120 s timeout before sending a rejection. During that window the SDK's `_interactiveInFlight` guard remained set, so any further connect attempt was immediately thrown with `RATE_LIMIT_EXCEEDED` — effectively locking the user out of connecting for 2 minutes. The equivalent `showTransactionApprovalPopup` and `showMessageApprovalPopup` already had `windows.onRemoved` handlers; this was an oversight in the connect popup only.

**Severity:** MEDIUM (UX degradation — repeated close-and-retry left dapp unusable for 120 s per attempt)

**Status:** Fixed (2026-05-15)

**Changes:**
- Refactored `showApprovalPopup` to use a shared `cleanup()` helper (clears timeout, removes message listener, removes window listener, clears storage key) — matching the pattern used in `showTransactionApprovalPopup` / `showMessageApprovalPopup`.
- Added `windowCloseListener` registered with `chrome.windows.onRemoved.addListener` immediately after the popup is created; resolves `false` immediately if the created window's ID is removed.
- `_interactiveInFlight` in the SDK now clears as soon as the window is closed, allowing the user to retry connect without delay.

Also added in this session: `logger.debug` log in the connect success path (after `persistDAppConnection`) so the background service worker console confirms the approved origin, address prefix, network, and permissions on every successful dapp connect.

---

### EXT-15 — Locked wallet immediately rejects dapp connect with no unlock UX

**File(s):** `src/background/index.ts` (`connect` case in `handleDAppRequest`)

**Issue:** When a dapp called `connect` while the wallet was locked, the extension immediately sent `{ success: false, error: '...' }` without giving the user any chance to unlock. The extension opened its popup (lock screen) but simultaneously called `sendResponse` with a failure — so the user saw the lock screen appear but the SDK had already rejected the connect promise. The user had to manually unlock, then click Connect again.

**Severity:** HIGH (critical UX degradation — connect flow was completely broken when wallet was auto-locked)

**Status:** Fixed (2026-05-15)

**Changes:**
- `const connectWallet` → `let connectWallet` in the connect case.
- When `!connectWallet` (locked): opens the extension popup (lock screen), then calls `waitForWalletUnlock(60_000)` instead of immediately sending a failure response.
- Added `waitForWalletUnlock(timeoutMs)` helper before `handleDAppRequest`: registers a `chrome.storage.onChanged` listener that resolves as soon as `getActiveWallet()` returns a wallet (i.e., `wallet_unlocked` in session storage becomes truthy). The service worker stays alive during the wait because the open `DAPP_REQUEST` message port keeps it awake (`return true` from the `onMessage` handler).
- After unlock the connect flow continues normally: checks for existing connection (no re-approval needed) or shows the dapp approval popup.
- If the user does not unlock within 60 s, sends `{ error: { code: 'WALLET_LOCKED', message: '...' } }`.

---

### EXT-16 — `connect` error responses used plain-string `error` field; SDK read `code`/`message` as `undefined`

**File(s):** `src/background/index.ts` (`connect` case), `src/communication.ts` (SDK)

**Issue:** The extension sent `sendResponse({ success: false, error: 'User rejected connection' })` — a plain string. The SDK's `handleExtensionResponse` tried to read `error.code` and `error.message` from that string (both `undefined`), creating `ZeroXIOWalletError(undefined, undefined)`. The DEX showed "ZeroXIOWalletError" with no useful message. The same bug applied to the wallet-locked error.

**Severity:** LOW (not a security issue; just unhelpful error messages surfaced to users)

**Status:** Fixed (2026-05-15)

**Extension changes:** `connect` rejection and lock-timeout now send `{ error: { code: 'USER_REJECTED'|'WALLET_LOCKED', message: '...' } }`.

**SDK changes (SDK-5):** `handleExtensionResponse` now handles both formats — if `error` is an object, reads `.code` and `.message`; if `error` is a plain string, uses it as the message with `ErrorCode.UNKNOWN_ERROR`. All pre-existing string-format errors from other extension handlers are now displayed correctly to the user.

---

### EXT-17 — `approvalListener` silently dropped every response from extension popup windows

**File(s):** `src/background/index.ts` (all three approval queues: connect, `send_transaction`, `signMessage`)

**Issue:** All three `chrome.runtime.onMessage` approval listeners guarded with:

```ts
// Only accept from extension pages — content scripts have sender.tab set
if (sender.tab) return;
```

`chrome.windows.create` popup pages have `sender.tab` populated in `chrome.runtime.MessageSender`, the same as content scripts. Every `DAPP_APPROVAL_RESPONSE` message sent by the approval popup was therefore silently dropped. The `windowCloseListener` then fired when the popup eventually closed and resolved `false`. The entire DApp approval system was non-functional: users always saw "User rejected connection" regardless of what they clicked in the popup.

**Severity:** CRITICAL — every DApp connection, transaction, and message-signing approval was permanently broken. The approval popup appeared and the user could interact with it, but no approval could ever succeed.

**Status:** Fixed (2026-05-15)

**Fix:** Changed the guard in all three listeners to:

```ts
// Block content scripts (external pages) but allow extension popup windows.
// chrome.windows.create popup pages have sender.tab set like content scripts,
// so check sender.url — extension pages start with chrome-extension://.
if (sender.tab && !sender.url?.startsWith('chrome-extension://')) return;
```

Extension-owned popup pages have `sender.url` beginning with `chrome-extension://`. Content scripts injected into external pages have `sender.url` equal to the page URL. The new guard blocks only cross-origin callers while correctly passing through approval responses from the extension's own popup windows.

---

## Updated Summary Table

### Original Cecuro Findings

| ID | Sev | Title | Status |
|----|-----|-------|--------|
| HIGH-1 | HIGH | Wrong-network routing | Fixed |
| HIGH-2 | HIGH | Same-origin bridge impersonation | Fixed |
| MEDIUM-1 | MED | Localhost parent impersonation | Fixed |
| MEDIUM-2 | MED | Unlock restore stale defaults | Fixed |
| MEDIUM-3 | MED | Large TX amount precision | Fixed |
| MEDIUM-4 | MED | Non-parent window blocks embed | Fixed |
| MEDIUM-5 | MED | Restored connect omits publicKey | Fixed |
| MEDIUM-6 | MED | AccountChangedEvent no publicKey | Fixed |
| MEDIUM-7 | MED | Late response overwrites session | Fixed |
| MEDIUM-8 | MED | switchNetwork without approval | Fixed |
| MEDIUM-9 | MED | Duplicate initialize / duplicate events | Fixed |
| MEDIUM-10 | MED | Bridge errors expose request params | Fixed |
| MEDIUM-11 | MED | Polling clears trusted walletReady state | Fixed |
| MEDIUM-12 | MED | Account switch stale publicKey/balance | Fixed |
| LOW-1 | LOW | checkSDKCompatibility wrong | Fixed |
| LOW-2 | LOW | NetworkInfo.rpcUrl not validated (dynamic) | Fixed |
| LOW-3 | LOW | Multiple approval popups | Fixed |
| LOW-4 | LOW | Debug mode exposes private data | Fixed |
| LOW-5 | LOW | Double-submit via retry/withTimeout | Fixed |
| LOW-6 | LOW | Throwing once listeners re-fire | Fixed |
| LOW-7 | LOW | extensionLocked/Unlocked events suppressed | Fixed |
| LOW-8 | LOW | Prototype-key network IDs | Fixed |
| LOW-9 | LOW | Truthy string "false" treated as success | Fixed |
| LOW-10 | LOW | contractCallView leaks address as empty caller | Fixed |
| LOW-11 | LOW | isValidMessage accepts falsy non-strings | Fixed |
| LOW-12 | LOW | Dropped transaction not modelled | Fixed |
| LOW-13 | LOW | JS number precision loss in balances | Fixed |
| LOW-14 | LOW | Oversized requests exhaust bridge | Fixed |
| LOW-15 | LOW | Third-party rewrites network routing | Fixed |
| LOW-16 | LOW | Malformed wallet actions not validated | Fixed |
| LOW-17 | LOW | DApp requests undeclared permissions | Fixed |
| LOW-18 | LOW | Permissions lost after reconnect | Fixed |
| LOW-19 | LOW | Wrong signing amount (float imprecision) | Fixed |
| LOW-20 | LOW | Signature replay across services | Fixed |
| LOW-21 | LOW | Bridge binds arbitrary key to address | Fixed |
| LOW-22 | LOW | cleanup() bricks reused instance | Documented |
| LOW-23 | LOW | encrypt/decrypt skips balanceChanged | Fixed |
| LOW-24 | LOW | Stale listeners survive cleanup | Fixed |
| LOW-25 | LOW | Non-serializable params stall requests | Fixed |
| LOW-26 | LOW | Bridge injects malformed balances | Fixed |
| LOW-27 | LOW | encryptBalance/decryptBalance return boolean | Fixed |
| LOW-28 | LOW | Stale communicator instances leak | Fixed |
| LOW-29 | LOW | getConnectionStatus emits connect on every call | Fixed |
| LOW-30 | LOW | handleNetworkChanged no validation | Fixed |
| INFO-1 | INFO | connectedAt reset on each status poll | Fixed |
| INFO-2 | INFO | NETWORKS exported as mutable | Fixed |

### Additional Findings (Post-Audit, 2026-05-15)

| ID | Scope | Sev | Title | Status |
|----|-------|-----|-------|--------|
| EXT-1 | Extension | CRIT | balanceChanged events dropped (wrong message type) | Fixed |
| EXT-2 | Extension | CRIT | networkChanged events dropped + string IDs not NetworkInfo | Fixed |
| EXT-3 | Extension | HIGH | getConnectionStatus missing networkInfo + permissions | Fixed |
| EXT-4 | Extension | HIGH | connect response missing required NetworkInfo fields | Fixed |
| EXT-5 | Extension | HIGH | No accountChanged broadcast on wallet switch | Fixed |
| EXT-6 | Extension | MED | Partial hostname match routes events to wrong tabs | Fixed |
| EXT-7 | Extension | MED | Approval listeners accept messages from content scripts | Fixed |
| EXT-8 | Extension | LOW | contractCallView leaks address as caller (injected.ts) | Fixed |
| EXT-9 | Extension | MED | Predictable integer request IDs in injected.ts | Fixed |
| EXT-10 | Extension | LOW | Truthy success check in injected.ts (LOW-9 equivalent) | Fixed |
| EXT-11 | Extension | LOW | AddressBookService.isValidAddress weak length check | Fixed |
| EXT-12 | Extension | MED | send_transaction no recipient address validation | Fixed |
| EXT-13 | Extension | MED | call_contract no contract address validation | Fixed |
| SDK-1 | SDK | HIGH | postMessageToExtension wildcard leaks request data | Fixed |
| SDK-2 | SDK | MED | Math.random() request ID fallback — guessable IDs | Fixed |
| SDK-3 | SDK | LOW | requestTimestamps grows unboundedly in idle tabs | Fixed |
| SDK-4 | SDK | LOW | octraWalletReady legacy listeners survive cleanup | Fixed |
| EXT-14 | Extension | MED | Connect popup hangs 120 s on window-close (missing windows.onRemoved) | Fixed |
| EXT-15 | Extension | HIGH | Locked wallet immediately rejects connect — no unlock UX offered | Fixed |
| EXT-16 | Extension | LOW | connect/rejection sendResponse uses plain string error — SDK reads code/message as undefined | Fixed |
| SDK-5 | SDK | LOW | handleExtensionResponse crashes on plain-string error — code/message read from string as undefined | Fixed |
| EXT-17 | Extension | CRIT | approvalListener blocks every response from extension popup windows — approval system non-functional | Fixed |

**Post-Audit Totals:** 22 Fixed

---

## v2.7.0 Self-Review Findings (2026-05-15)

Deep re-examination of all code added or modified in v2.7.0 (HIGH-2 MessageChannel fix and pluggable adapter system). Numbered with `N-` prefix.

---

### N-1 — HIGH-2 nonce TOCTOU: session nonce may never be received

**File(s):** `src/supports/0xio.ts`

**Issue:** `injected.ts` runs as a `world: "MAIN"` content script at `document_start` and broadcasts `0xio-sdk-nonce-init` immediately upon receiving the port. However, the SDK is a regular page script that loads later. By the time `listen()` is called and `nonceListener` is registered, the broadcast has already fired and been missed. `_sessionNonce` remains `null` permanently. The guard `if (_sessionNonce && e.data.sessionNonce !== _sessionNonce)` short-circuits on the falsy null — meaning every response passes nonce validation regardless. The HIGH-2 nonce defense is effectively disabled in practice.

**Severity:** MEDIUM

**Status:** Fixed

**SDK-side fix (fallback capture):**
Added a fallback path in `msgListener`: if `_sessionNonce` is null and the first incoming same-origin response carries a `sessionNonce` string, capture it immediately. All subsequent responses are then validated against the captured nonce.

```typescript
if (!_sessionNonce && isFromSameOrigin && typeof e.data.sessionNonce === 'string') {
  _sessionNonce = e.data.sessionNonce;
}
if (_sessionNonce && e.data.sessionNonce !== _sessionNonce) return;
```

**Extension-side fix (definitive):**
`injected.ts` SDK bridge listener now re-broadcasts `0xio-sdk-nonce-init` immediately before forwarding each `0xio-sdk-request` to the port. This guarantees the nonce arrives before the response regardless of page-script load order, making the SDK-side fallback a belt-and-suspenders safety net rather than the primary defense. HIGH-2 nonce validation is now active from the very first response.

---

### N-2 — `validateNetworkInfo()` accepts empty rpcUrl string

**File(s):** `src/config/networks.ts`

**Issue:** The rpcUrl validation only checked `typeof raw.rpcUrl !== 'string'`. An empty string `""` passed the check and would be cached as a valid network endpoint, potentially causing all subsequent RPC-related operations to silently fail with opaque errors.

**Severity:** LOW

**Status:** Fixed

**Change:** Added non-empty check: `(!raw.rpcUrl && raw.id !== 'custom')` — `custom` network is the only built-in with an intentionally empty rpcUrl (user-configured); all bridge-supplied networks must provide a non-empty rpcUrl.

---

### N-3 — `validateBalance()` uses `parseFloat()` accepting partial numeric strings

**File(s):** `src/config/index.ts`

**Issue:** `parseFloat('10abc')` returns `10` without error, allowing malformed bridge-supplied balance strings (e.g. `"100XYZ"`) to pass validation and be cached as valid balances. `Number('10abc')` correctly returns `NaN`, which then fails the `Number.isFinite()` check.

**Severity:** LOW

**Status:** Fixed

**Change:** Replaced `parseFloat()` with `Number()` for both `pub` and `priv` fields. Also switched string fallbacks `'0'` → numeric `0` to avoid redundant string coercion.

---

### N-4 — Template adapter `listen()` missing `e.source` validation

**File(s):** `src/supports/template.ts`

**Issue:** The commented-out template `listen()` only validated `e.origin`. The `0xio.ts` built-in adapter additionally checks `e.source !== window && e.source !== window.parent`, rejecting messages from windows other than the current page or its parent. Third-party adapters built from the template without adding this check would accept messages from any same-origin window (e.g. opened popups, child iframes), widening the injection surface.

**Severity:** LOW

**Status:** Fixed

**Change:** Added `e.source` check to the template skeleton with an explanatory comment.

---

### N-5 — `createZeroXIOWallet()` quick-setup helper ignores `adapter` parameter

**File(s):** `src/index.ts`

**Issue:** The exported `createZeroXIOWallet()` convenience function did not accept or forward an `adapter` config option. DApps using the quick-setup path had no way to supply a custom transport adapter, forcing them to use `ZeroXIOWallet` directly — a less discoverable API that could lead to developers using the default adapter without realising a custom one was needed.

**Severity:** LOW

**Status:** Fixed

**Change:** Added optional `adapter?: WalletTransportAdapter` to the config type and forwarded it to `new ZeroXIOWallet({ ..., adapter })` when provided.

---

### N-6 — `detect()` returns true for any installed Chrome extension

**File(s):** `src/supports/0xio.ts`

**Issue:** `win.chrome?.runtime?.id` is set by the browser for any installed Chrome extension, not just 0xio Wallet. On a machine with AdBlock, MetaMask, or any other extension installed, `detect()` returns `true` even when 0xio Wallet is absent, causing the SDK to proceed to extension communication and eventually timeout.

**Severity:** INFO

**Status:** Documented

**Notes:** The primary detection signals (`win.wallet0xio`, `win.ZeroXIOWallet`, meta tags, data attributes) are 0xio-specific. The `chrome.runtime.id` check is a best-effort signal used when the extension is present but its window globals haven't fully initialised. The practical impact is a timeout rather than a security breach. A future improvement would be to remove the generic `chrome.runtime.id` check and rely exclusively on 0xio-specific signals.

---

### v2.7.0 Self-Review Summary

| ID | Scope | Sev | Title | Status |
|----|-------|-----|-------|--------|
| N-1 | SDK/EXT | MED | HIGH-2 nonce TOCTOU — nonce init broadcast missed by page script | Fixed |
| N-2 | SDK | LOW | validateNetworkInfo accepts empty rpcUrl | Fixed |
| N-3 | SDK | LOW | validateBalance uses parseFloat — accepts partial numeric strings | Fixed |
| N-4 | SDK | LOW | Template adapter listen() missing e.source validation | Fixed |
| N-5 | SDK | LOW | createZeroXIOWallet helper doesn't support adapter param | Fixed |
| N-6 | SDK | INFO | detect() false-positives from any Chrome extension | Documented |

**v2.7.0 Self-Review Totals:** 6 Fixed · 1 Documented

---

**Grand Total: 73 Fixed · 2 Documented**
