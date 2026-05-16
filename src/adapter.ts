/**
 * 0xio SDK — Wallet Transport Adapter Interface
 *
 * Implement WalletTransportAdapter to add support for a new wallet without
 * touching any core SDK code. Drop the adapter file in src/supports/ and
 * pass it to ZeroXIOWallet via SDKConfig.adapter.
 *
 * @example
 * ```typescript
 * import { ZeroXIOWallet } from '@0xio/sdk';
 * import { QubitzAdapter } from '@0xio/sdk/supports/qubitz';
 *
 * const wallet = new ZeroXIOWallet({
 *   appName: 'My DApp',
 *   adapter: QubitzAdapter,
 * });
 * ```
 */

/**
 * Outbound request — the SDK passes this to adapter.postRequest() for every
 * outbound wallet call. Adapters translate this into their wallet-specific wire format.
 */
export interface AdapterRequest {
  /** Unique request ID (UUID). Used to correlate the response. */
  id: string;
  /** Method name, e.g. 'connect', 'sendTransaction', 'signMessage' */
  method: string;
  /** Method parameters */
  params: unknown;
  /** Unix timestamp (ms) when the request was created */
  timestamp: number;
}

/**
 * Normalized inbound message from a wallet.
 * Adapters translate their wallet-specific wire format into this structure
 * and pass it to the handler registered via listen().
 *
 * A message is either a response (requestId set) or a push event (eventType set).
 */
export interface AdapterIncomingMessage {
  // ---- Response fields (set when responding to a specific request) ----

  /** Must match the id from the outbound AdapterRequest */
  requestId?: string;
  /** Whether the request succeeded. Required when requestId is set. */
  success?: boolean;
  /** Response payload on success */
  data?: unknown;
  /** Structured error on failure */
  error?: { code: string; message: string; details?: unknown };

  // ---- Event fields (set for unsolicited push events from the wallet) ----

  /** Event type, e.g. 'connect', 'disconnect', 'accountChanged', 'balanceChanged' */
  eventType?: string;
  /** Event payload */
  eventData?: unknown;
}

/**
 * Wallet transport adapter.
 *
 * Encapsulates the entire wallet-specific communication layer:
 * - How to detect if the wallet is installed
 * - How to send requests (postRequest)
 * - How to receive responses and events (listen)
 *
 * Everything else — request lifecycle, timeouts, retries, rate limiting,
 * event routing — is handled by the SDK core and does not change per wallet.
 *
 * @example Minimal adapter for a hypothetical wallet
 * ```typescript
 * export const MyWalletAdapter: WalletTransportAdapter = {
 *   name: 'mywallet',
 *   displayName: 'My Wallet',
 *   detect: () => !!(window as any).myWallet,
 *   postRequest: (req) =>
 *     window.postMessage({ source: 'mywallet-request', ...req }, location.origin),
 *   listen: (handler) => {
 *     const fn = (e: MessageEvent) => {
 *       if (e.data?.source !== 'mywallet-response') return;
 *       handler({ requestId: e.data.id, success: e.data.ok, data: e.data.result });
 *     };
 *     window.addEventListener('message', fn);
 *     return () => window.removeEventListener('message', fn);
 *   },
 * };
 * ```
 */
export interface WalletTransportAdapter {
  /**
   * Machine-readable wallet identifier. Used in logs and adapter selection.
   * Examples: '0xio', 'qubitz', 'fhex'
   */
  readonly name: string;

  /**
   * Human-readable wallet name shown in error messages.
   * Examples: '0xio Wallet', 'Qubitz Wallet', 'FHEX Wallet'
   */
  readonly displayName: string;

  /**
   * Returns true when this wallet's extension / injected provider is present
   * in the current page context. Called periodically by the SDK to check availability.
   */
  detect(): boolean;

  /**
   * Send a request to the wallet.
   * Called once per outbound request — translate AdapterRequest into your
   * wallet's wire format and post it (window.postMessage, direct API call, etc.).
   */
  postRequest(request: AdapterRequest): void;

  /**
   * Optional: send the same request to a trusted parent frame (iframe/desktop bridge).
   * Only implement this if your wallet supports an embedded iframe bridge mode.
   * The SDK calls this when window.parent !== window and a trusted parent origin exists.
   */
  postRequestToParent?(request: AdapterRequest, parentOrigin: string): void;

  /**
   * Set up response and event listening.
   * The SDK calls this once during initialization. Normalise all incoming wallet
   * messages into AdapterIncomingMessage and pass them to handler.
   *
   * @param handler  Callback for responses and push events
   * @param options  SDK-level options, e.g. additional trusted parent origins
   * @returns        A teardown function — the SDK calls it on cleanup()
   */
  listen(
    handler: (msg: AdapterIncomingMessage) => void,
    options?: { trustedParentOrigins?: string[] }
  ): () => void;

  /**
   * Optional: register wallet-ready event listeners (e.g. 'myWalletReady' CustomEvent).
   * Called once during SDK init. When the wallet signals it is ready, call onReady().
   * Returns a cleanup function.
   *
   * If not implemented, the SDK falls back to polling detect() every 2 seconds.
   */
  listenForReady?(onReady: () => void): () => void;
}
