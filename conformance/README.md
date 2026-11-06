# Wallet protocol 2 conformance

One suite that every 0xio wallet runs: the extension, 0xio Desktop (direct and relayed), the Expo app and the native iOS and Android apps. It checks the request lifecycle at the wire, never through the SDK, so a wallet passes only by following the rules itself.

## What is here

| File | What it is |
|---|---|
| `harness.ts` | The interface your test harness implements (`ConformanceAdapter`, `PageTransport`) and the wire shapes |
| `suite.ts` | The cases. `defineConformanceSuite({ name, features, create })` registers them with Jest or Vitest |
| `vectors.json` | Language neutral vectors: request id format, digest canonicalization with sha256, transitions, idempotency table, masking, limits, app links. For `cargo test`, XCTest and JUnit |
| `reference/referenceWallet.ts` | A protocol 2 wallet in memory that passes the suite; read it as the executable spec |
| `reference/legacyWallet.ts` | The same wallet in protocol 1 mode, used to prove the SDK's fallbacks |
| `reference/adapter.ts` | The adapter for the reference wallet: a complete example of a harness |
| `reference/browserPage.ts` | A page in memory that runs the real SDK against a reference wallet |
| `reference.test.ts` | The runner for the reference wallet (`npm run test:conformance` in this repo) |

## Running it in a wallet repo

The suite is TypeScript with Jest style globals (`describe`, `it`, `it.each`, `it.skip`, `expect`, `beforeEach`, `afterEach`); it runs unchanged under Jest and under Vitest with `globals: true`. Check out `0xio-sdk` next to your repo (the usual `0xio/` layout) and add one test file.

1. Write the adapter. Implement `ConformanceAdapter` from `harness.ts` over your wallet's real request handler, with test hooks for what a person and the chain do:

   ```ts
   import type { ConformanceAdapter } from '../../../0xio-sdk/conformance/harness';

   export function createExtensionAdapter(): ConformanceAdapter {
     // build a fresh background state, a fake chain and a movable clock
     return {
       name: 'extension',
       features: { clock: true, chain: true, lock: true, frames: true, account: true },
       openPage: async (origin, { tab, frame } = {}) => /* a PageTransport for that tab and frame */,
       approve: async (requestId) => /* press Approve on the review */,
       reject: async (requestId) => /* press Reject */,
       reviewOnScreen: async () => /* rid of the review on screen, or null */,
       lock: async () => {}, unlock: async () => {},
       confirmOnChain: async (hash) => {}, failOnChain: async (hash, reason) => {}, dropOnChain: async (hash) => {},
       advance: async (ms) => {},
       setAccount: async ({ registered, balanceRaw, foreignKey, pendingRegistration }) => {},
       stats: async () => ({ signatures, reviewsOpened }),
       dispose: async () => {},
     };
   }
   ```

2. Register the suite:

   ```ts
   // src/__tests__/protocol2.conformance.test.ts
   import { defineConformanceSuite } from '../../../0xio-sdk/conformance/suite';
   import { createExtensionAdapter } from './conformanceAdapter';

   defineConformanceSuite({
     name: 'extension',
     features: { clock: true, chain: true, lock: true, frames: true, account: true },
     create: () => createExtensionAdapter(),
   });
   ```

3. Run it with the repo's own runner: `npx vitest run src/__tests__/protocol2.conformance.test.ts` (extension) or `npx jest protocol2.conformance` (Expo app). A test that needs a feature your harness does not declare is skipped and shown as skipped, never as passed.

0xio Desktop, iOS and Android run `vectors.json` in `cargo test`, XCTest and JUnit for the byte exact parts (digest, transitions, masking), and run this suite from Node with an adapter that speaks their channel (a WebSocket for Desktop, the harness page in a WebView for the apps).

### Channel mapping

The suite speaks the extension channel. A harness on another channel maps it:

| Suite | 0xio Desktop direct | Desktop relayed by the extension |
|---|---|---|
| request `{ id, method, params, v: 2, rid, network? }` | `site_request { id, network, rid, request: { method, params } }` | the extension copies `rid` into the frame |
| `request_status { rid }` | `site_status { rid }` | `site_status` over the pairing |
| `cancel_request { rid }` | `site_cancel { id?, rid }` | `site_cancel` over the pairing |
| event `requestUpdate` | `site_event` kind `request` | kind `request` mapped to `requestUpdate` |
| `wallet_hello` | the `site_hello` reply carries `protocol` and `capabilities` | `wallet_hello` |

## The rules it checks

- `wallet_hello`: protocol 2, a known kind, the capabilities (`announce` is not asked of Desktop), no user state, answered to a page that is not connected.
- Request ids: 32 lowercase hex or `INVALID_PARAMS` with no review; `rid` on every answer; `unknown` for an id nobody knows.
- Answer envelope: an error answer carries `rid` and `status` at the top level and again in `error.details` as `{ requestId, status }`.
- Idempotency: the same request joins (one review, one signature, the same answer, from any tab of the origin); another method, params or network is `REQUEST_ID_REUSED`; `submitted` and `completed` give the stored result; `rejected`, `expired` and `failed` give the stored error and never run again; ids are per origin.
- Transitions: only the moves in `REQUEST_STATUS_TRANSITIONS`, `seq` grows, a final state never changes; a contract call goes `signing`, `submitted` (hash), `confirmed` (epoch, receipt or `receiptUnavailable`); a drop ends `failed` at stage `execution`.
- Nothing to review: connect from a connected site and a switch to the current network go `pending` to `completed`.
- Pre-signed: `broadcast_only` from the connected wallet goes `pending` to `submitted` (with a hash) and `confirmed` with no new review and no signature, since the `sign_transaction` review already showed what was signed; from another wallet it is refused with `INVALID_PARAMS` and no review.
- Registration: `register_private_view_key` for another address is refused with `INVALID_PARAMS` and no review; for a registered account (view key on chain, PVAC key confirmed) it goes `pending` to `completed` with no review and no signature and answers `{ status: 'registered', view_pubkey, pvac: true }`; for an unregistered account it opens one review with the fee, then goes `submitted` (with a hash) and `confirmed`; it is refused with no review and, in this order, `PVAC_KEY_MISMATCH` when another PVAC key is registered for the account, `REGISTRATION_PENDING` while this wallet's registration is unconfirmed (a second request right after the first is one), `INSUFFICIENT_BALANCE` below the fee. A registered account completes even with a registration flagged pending. The harness sets the account with `setAccount({ registered, balanceRaw, foreignKey?, pendingRegistration? })` (feature `account`).
- Events: only to the tab and frame that sent the request; a page that is not connected still follows its own connect; none for a request without an id.
- Locked: a site that is not connected sees `review_open`, no address and no network; a connected site sees `locked`, then `review_open`.
- Sites that are not connected: every non-public method (wallet info, address, public key, balance, history, private reads and primitives, every review but `connect`) answers `NOT_CONNECTED` at once with no review, and no answer carries an address, public key or balance. Public reads still answer: `ping`, `register_dapp`, `disconnect`, `getConnectionStatus`, network reads, contract view and storage reads, `rpc_call`, `wallet_hello`, `request_status`, `cancel_request`.
- Lock privacy: while locked, a site that is not connected gets the same `getConnectionStatus`, `ping` and `wallet_hello` answers as when unlocked, and `NOT_CONNECTED` at once for review requests, with no review and no prompt. Its connect made while locked keeps the same `seq` and `updatedAt` across the unlock, with no `requestUpdate` at unlock, so the site cannot tell the wallet was locked.
- Timeouts: a page that stops waiting never cancels the review; the review window is 5 minutes, then `expired` with `USER_REJECTED`; final records live 24 hours; the chain watch stops after 10 minutes with `watching: false`.
- Limits: over 20 requests a second a page gets `RATE_LIMITED` for each extra one, never silence; an open request over the site cap gets `RATE_LIMIT_EXCEEDED`. The cap is 8; a wallet with a lower one (0xio Desktop keeps 3) declares it as `features.openRequestCap`.
- Pacing: the suite polls `request_status` every 500 ms (`statusPollMs`), inside the extension's 2 a second per origin, and waits up to 10 s (`settleTimeoutMs`) for a state.
- Page close: an unanswered review closes (`rejected`, nothing signed); an approved request finishes and the reloaded page reads it.
- `cancel_request`: closes only the site's own unanswered review; an approved one is unchanged.

The digest that decides "same request" is sha256 of `{ method, network, params }` in canonical JSON (keys sorted by code point, no whitespace). `network` is the network the request carries (`network` on Desktop frames) and `null` on channels without one (the extension and app postMessage channel); `vectors.json` has the exact bytes.
