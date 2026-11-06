/** What the SDK hands `postRequest` for every outbound call. */
export interface AdapterRequest {
  /** Correlates the response. */
  id: string;
  method: string;
  params: unknown;
  timestamp: number;
  /** Old wallets ignore it. @since 2.12.0 */
  v?: 2;
  /** Review methods only. @since 2.12.0 */
  rid?: string;
}

/** A response (`requestId` set) or a push event (`eventType` set). */
export interface AdapterIncomingMessage {
  /** The `id` of the request it answers. */
  requestId?: string;
  /** Required when `requestId` is set. */
  success?: boolean;
  data?: unknown;
  error?: { code: string; message: string; status?: string; details?: unknown };
  /** Protocol 2 error answers carry these at the top level too. @since 2.12.0 */
  rid?: string;
  status?: string;
  eventType?: string;
  eventData?: unknown;
}

/**
 * The wallet specific layer: detection, sending and listening. Lifecycle, timeouts, retries, rate
 * limits and event routing stay in the SDK core.
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
  /** Machine readable id, such as '0xio'. */
  readonly name: string;

  /** Shown in error messages. */
  readonly displayName: string;

  /** True when the wallet is present in the page; polled by the SDK. */
  detect(): boolean;

  postRequest(request: AdapterRequest): void;

  /** Only for wallets with an iframe bridge; called when a trusted parent origin exists. */
  postRequestToParent?(request: AdapterRequest, parentOrigin: string): void;

  /**
   * @param handler  Receives responses and push events
   * @param options  Extra trusted parent origins
   * @returns        A teardown function, called on cleanup()
   */
  listen(
    handler: (msg: AdapterIncomingMessage) => void,
    options?: { trustedParentOrigins?: string[] }
  ): () => void;

  /** Calls `onReady` when the wallet signals; without it the SDK polls `detect()` every 2 s. */
  listenForReady?(onReady: () => void): () => void;
}
