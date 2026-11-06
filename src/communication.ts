import {
  ExtensionRequest,
  ExtensionResponse,
  ErrorCode,
  WalletInfo,
  ZeroXIOWalletError
} from './types';
import {
  DEFAULT_DETECT_TIMEOUT_MS,
  HELLO_TIMEOUT_MS,
  RequestMeta,
  SUPPORTED_PROTOCOLS,
  guessWalletKind,
  isRequestId,
  isRequestStatusValue,
  parseWalletHello,
  walletSignals,
} from './lifecycle';
import { SDK_VERSION } from './version';
import type { WalletTransportAdapter } from './adapter';
import { createZeroXIOAdapter } from './supports/0xio';
import { retry, withTimeout, createLogger } from './utils';
import { EventEmitter } from './events';

export class ExtensionCommunicator extends EventEmitter {
  private pendingRequests = new Map<string, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
    retryCount: number;
    rid?: string;
    restart?: () => void;
  }>();

  private isInitialized = false;
  private logger: ReturnType<typeof createLogger>;
  private extensionDetectionInterval: ReturnType<typeof setInterval> | null = null;
  private isExtensionAvailableState = false;
  private trustedOrigins: string[] = [];
  private _parentOrigin: string | null = null;

  private adapter: WalletTransportAdapter;
  private _adapterTeardown: (() => void) | null = null;
  private _adapterReadyTeardown: (() => void) | null = null;

  /** The polling fallback must not clear this. */
  private _parentTrusted = false;

  private _walletReadyMessageListener: ((e: MessageEvent) => void) | null = null;

  /** One review at a time; the same request id re-attaches. */
  private _interactiveInFlight = false;
  private _interactiveRid: string | null = null;

  private _walletInfo: WalletInfo | null = null;
  private readonly detectTimeoutMs: number;

  private readonly MAX_CONCURRENT_REQUESTS = 50;
  private readonly RATE_LIMIT_WINDOW = 1000;
  private readonly MAX_REQUESTS_PER_WINDOW = 20;
  private requestTimestamps: number[] = [];

  constructor(
    debug = false,
    trustedOrigins: string[] = [],
    adapter?: WalletTransportAdapter,
    options: { detectTimeoutMs?: number } = {}
  ) {
    super(debug);
    this.logger = createLogger('ExtensionCommunicator', debug);
    this.trustedOrigins = trustedOrigins;
    this.detectTimeoutMs = Math.min(Math.max(options.detectTimeoutMs ?? DEFAULT_DETECT_TIMEOUT_MS, 0), 10000);
    this.adapter = adapter ?? createZeroXIOAdapter(trustedOrigins);
    this.setupMessageListener();
    this.startExtensionDetection();
  }

  setTrustedOrigins(origins: string[]): void {
    this.trustedOrigins = origins;
  }

  async initialize(): Promise<boolean> {
    if (this.isInitialized) {
      return true;
    }

    try {
      const available = await this.waitForExtensionAvailability(this.initialWaitMs());

      if (available) {
        await withTimeout(
          this.sendRequestWithRetry('ping', {}, 3, 2000),
          8000,
          'Extension ping timeout during initialization'
        );

        this.isInitialized = true;
        this.logger.log('Extension communication initialized successfully');
      } else {
        this.logger.error('Extension not available after waiting');
      }

      return this.isInitialized;
    } catch (error) {
      this.logger.error('Failed to initialize extension communication:', error);
      return false;
    }
  }

  isExtensionAvailable(): boolean {
    return this.isExtensionAvailableState && this.hasExtensionContext();
  }

  /** Inside a frame or the 0xio app's WebView the wallet may signal late, so 10 s stays there. */
  private initialWaitMs(): number {
    if (typeof window === 'undefined') return this.detectTimeoutMs;
    const win = window as any;
    const inFrame = win.parent !== undefined && win.parent !== window;
    return inFrame || win.ReactNativeWebView ? 10000 : this.detectTimeoutMs;
  }

  /** Sent once, never retried; any error reads as protocol 1. */
  async walletHello(): Promise<WalletInfo> {
    const signals = walletSignals();
    const fallbackKind = signals.announce?.kind ?? guessWalletKind('extension');
    let info: WalletInfo;
    try {
      const raw = await this.sendRequest(
        'wallet_hello',
        { sdk: SDK_VERSION, protocols: [...SUPPORTED_PROTOCOLS] },
        HELLO_TIMEOUT_MS
      );
      info = parseWalletHello(raw, fallbackKind);
    } catch {
      info = parseWalletHello({}, fallbackKind);
    }
    if (info.protocol === 1 && !info.version) {
      const version = signals.announce?.version ?? signals.readyVersion;
      if (version) info = Object.freeze({ ...info, version });
    }
    this._walletInfo = info;
    this.logger.log('Wallet protocol:', info.protocol, info.kind);
    return info;
  }

  get walletInfo(): WalletInfo | null {
    return this._walletInfo;
  }

  async queryRequestStatus(rid: string): Promise<unknown> {
    if (this._walletInfo?.protocol !== 2) {
      throw new ZeroXIOWalletError(ErrorCode.UNSUPPORTED_METHOD, 'This wallet keeps no request status');
    }
    return this.sendRequest('request_status', { rid }, 10000);
  }

  async cancelRequestOnWallet(rid: string): Promise<unknown> {
    if (this._walletInfo?.protocol !== 2) {
      throw new ZeroXIOWalletError(
        ErrorCode.UNSUPPORTED_METHOD,
        'This wallet cannot cancel a request from the site; close the review in the wallet'
      );
    }
    return this.sendRequest('cancel_request', { rid }, 10000);
  }

  touchRequest(rid: string): void {
    for (const pending of this.pendingRequests.values()) {
      if (pending.rid === rid) pending.restart?.();
    }
  }

  // A retry would open a second review while the first is still open.
  private static readonly NO_RETRY_METHODS = new Set([
    'connect', 'send_transaction', 'call_contract', 'deploy_contract', 'signMessage',
    'sign_transaction', 'broadcast_only',
    'send_private_transfer', 'claim_private_transfer',
    'encrypt_balance', 'decrypt_balance',
    'send_contract_transaction_sequence',
    // Offscreen cold init can exceed 30 s
    'register_private_view_key',
    'switch_network',
  ]);

  // Proofs and decrypts take 10 to 120 s; no review, so several may run at once.
  private static readonly LONG_COMPUTE_METHODS = new Set([
    'make_zero_proof', 'make_range_proof', 'decrypt_value',
    'get_private_balance', 'encrypt_value',
  ]);

  // An old wallet answers wallet_hello with an error; status queries repeat on the caller's clock.
  private static readonly SINGLE_SHOT_METHODS = new Set(['wallet_hello', 'request_status', 'cancel_request']);

  // Proofs run after the approval, minutes on a slow machine.
  private static readonly PROOF_METHODS = new Set(['send_private_transfer']);

  private static readonly INTERACTIVE_METHODS = ExtensionCommunicator.NO_RETRY_METHODS;

  async sendRequest<T = any>(
    method: string,
    params: any = {},
    timeout = 30000,
    meta?: RequestMeta
  ): Promise<T> {
    const longOrNoRetry =
      ExtensionCommunicator.NO_RETRY_METHODS.has(method) ||
      ExtensionCommunicator.LONG_COMPUTE_METHODS.has(method);
    const maxRetries = longOrNoRetry || ExtensionCommunicator.SINGLE_SHOT_METHODS.has(method) ? 0 : 1;
    const effectiveTimeout = ExtensionCommunicator.PROOF_METHODS.has(method)
      ? Math.max(timeout, 600000)
      : longOrNoRetry
        ? Math.max(timeout, 180000)
        : timeout;
    if (meta) {
      return this.sendRequestWithRetry(method, params, 0, meta.timeoutMs ?? effectiveTimeout, meta);
    }
    return this.sendRequestWithRetry(method, params, maxRetries, effectiveTimeout);
  }

  async sendRequestWithRetry<T = any>(
    method: string,
    params: any = {},
    maxRetries = 3,
    timeout = 30000,
    meta?: RequestMeta
  ): Promise<T> {
    const rid = meta && isRequestId(meta.rid) ? meta.rid : undefined;
    if (!this.hasExtensionContext()) {
      throw new ZeroXIOWalletError(
        ErrorCode.EXTENSION_NOT_FOUND,
        '0xio Wallet extension is not installed or available',
        { method, browserContext: this.getBrowserDiagnostics() }
      );
    }

    if (!this.isExtensionAvailableState) {
      await this.waitForExtensionAvailability(5000);

      if (!this.isExtensionAvailableState) {
        throw new ZeroXIOWalletError(
          ErrorCode.EXTENSION_NOT_FOUND,
          'Extension not available for communication',
          { method, extensionState: this.getExtensionDiagnostics() }
        );
      }
    }

    // Enforce one-at-a-time for interactive popup methods
    const isInteractive = ExtensionCommunicator.INTERACTIVE_METHODS.has(method);
    const reattach = isInteractive && this._interactiveInFlight && !!rid && rid === this._interactiveRid;
    const ownsLock = isInteractive && !reattach;
    if (ownsLock) {
      if (this._interactiveInFlight) {
        throw new ZeroXIOWalletError(
          ErrorCode.RATE_LIMIT_EXCEEDED,
          'Another approval popup is already open. Please wait for it to complete.',
          this._interactiveRid ? { reason: 'review_pending', requestId: this._interactiveRid } : undefined
        );
      }
      this._interactiveInFlight = true;
      this._interactiveRid = rid ?? null;
    }

    this.checkRateLimit();

    try {
      return await retry(async () => {
        const requestId = this.generateRequestId();
        const request: ExtensionRequest = {
          id: requestId,
          method,
          params,
          timestamp: Date.now(),
          v: 2,
          ...(rid ? { rid } : {})
        };

        this.logger.log(`Sending request (${method}):`, { id: requestId });

        return new Promise<T>((resolve, reject) => {
          // A lifecycle request keeps its review open; only the SDK stops waiting.
          const onTimeout = () => {
            const pending = this.pendingRequests.get(requestId);
            if (!pending) return;
            this.pendingRequests.delete(requestId);
            reject(rid
              ? new ZeroXIOWalletError(
                ErrorCode.STATUS_UNKNOWN,
                `No answer from the wallet after ${timeout}ms; the request may still finish`,
                { method, requestId: rid }
              )
              : new ZeroXIOWalletError(
                ErrorCode.NETWORK_ERROR,
                `Request timeout after ${timeout}ms`,
                { method, requestId, retryCount: pending.retryCount }
              ));
          };
          const timeoutHandle = setTimeout(onTimeout, timeout);

          const entry = {
            resolve,
            reject,
            timeout: timeoutHandle,
            retryCount: 0,
            rid,
            restart: () => {
              clearTimeout(entry.timeout);
              entry.timeout = setTimeout(onTimeout, timeout);
            }
          };
          this.pendingRequests.set(requestId, entry);

          // A DataCloneError must not leave the pending entry behind
          try {
            this.postMessageToExtension(request);
          } catch (cloneErr) {
            clearTimeout(timeoutHandle);
            this.pendingRequests.delete(requestId);
            reject(new ZeroXIOWalletError(
              ErrorCode.UNKNOWN_ERROR,
              'Request params are not serializable',
              { method, requestId }
            ));
          }
        });
      }, maxRetries, 1000);
    } finally {
      if (ownsLock) {
        this._interactiveInFlight = false;
        this._interactiveRid = null;
      }
    }
  }

  private setupMessageListener(): void {
    if (typeof window === 'undefined') return;

    this._adapterTeardown = this.adapter.listen(
      (msg) => {
        if (msg.requestId !== undefined) {
          if (this.pendingRequests.has(msg.requestId)) {
            this.handleExtensionResponse({
              id: msg.requestId,
              success: msg.success ?? false,
              data: msg.data,
              error: msg.error as any,
              timestamp: Date.now(),
            }, msg.status);
          }
        } else if (msg.eventType) {
          this.handleExtensionEvent({ type: msg.eventType, data: msg.eventData });
        }
      },
      { trustedParentOrigins: this.trustedOrigins }
    );

    this.logger.log(`Message listener setup complete (adapter: ${this.adapter.name})`);
  }

  private static readonly VALID_EVENT_TYPES = new Set<string>([
    'connect', 'disconnect', 'accountChanged', 'balanceChanged',
    'networkChanged', 'transactionConfirmed', 'transactionFailed', 'permissionsChanged', 'message',
    'error', 'extensionLocked', 'extensionUnlocked', 'requestUpdate'
  ]);

  private handleExtensionEvent(event: any): void {
    if (!event?.type || !ExtensionCommunicator.VALID_EVENT_TYPES.has(event.type)) {
      this.logger.warn(`Received unknown event type from bridge: ${event?.type}`);
      return;
    }
    this.logger.log('Received extension event:', event.type);
    this.emit(event.type, event.data);
  }

  private handleExtensionResponse(response: ExtensionResponse, topStatus?: unknown): void {
    this.logger.log(`Received response:`, { id: response.id, success: response.success });

    const pending = this.pendingRequests.get(response.id);
    if (!pending) {
      this.logger.warn(`Received response for unknown request ID: ${response.id}`);
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(response.id);

    // Strictly true: the string "false" is truthy
    if (response.success === true) {
      pending.resolve(response.data);
    } else {
      const error = response.error;
      if (error) {
        const isObj = error !== null && typeof error === 'object';
        const rawCode: string = isObj && error.code ? error.code : ErrorCode.UNKNOWN_ERROR;
        // RATE_LIMITED is the per second budget of a page, RATE_LIMIT_EXCEEDED the open request cap.
        const code = (rawCode === 'RATE_LIMITED' ? ErrorCode.RATE_LIMIT_EXCEEDED : rawCode) as ErrorCode;
        const reason = rawCode === 'RATE_LIMITED'
          ? 'requests_per_second'
          : rawCode === 'RATE_LIMIT_EXCEEDED' ? 'open_requests' : undefined;
        const message: string = isObj
          ? (error.message ?? 'Unknown error')
          : (typeof error === 'string' ? error : 'Unknown error');
        const rawStatus = isObj
          ? ((error as any).status ?? (error as any).details?.status ?? topStatus)
          : topStatus;
        const enhancedError = new ZeroXIOWalletError(
          code,
          message,
          // Bridge supplied details are redacted
          {
            requestId: response.id,
            retryCount: pending.retryCount,
            timestamp: Date.now(),
            ...(isRequestStatusValue(rawStatus) ? { status: rawStatus } : {}),
            ...(reason ? { reason } : {})
          }
        );
        pending.reject(enhancedError);
      } else {
        pending.reject(new ZeroXIOWalletError(
          ErrorCode.UNKNOWN_ERROR,
          'Unknown error occurred',
          { requestId: response.id, retryCount: pending.retryCount }
        ));
      }
    }
  }

  private postMessageToExtension(request: ExtensionRequest): void {
    this.adapter.postRequest(request);
    // Only to a trusted parent origin: '*' would leak method and params to any frame
    if (window.parent !== window && this._parentOrigin) {
      if (this.adapter.postRequestToParent) {
        this.adapter.postRequestToParent(request, this._parentOrigin);
      }
    }
  }

  private hasExtensionContext(): boolean {
    return typeof window !== 'undefined' &&
      typeof window.postMessage === 'function';
  }

  private checkRateLimit(): void {
    const now = Date.now();

    if (this.pendingRequests.size >= this.MAX_CONCURRENT_REQUESTS) {
      throw new ZeroXIOWalletError(
        ErrorCode.RATE_LIMIT_EXCEEDED,
        `Too many concurrent requests (max: ${this.MAX_CONCURRENT_REQUESTS})`
      );
    }

    this.requestTimestamps = this.requestTimestamps.filter(
      t => now - t < this.RATE_LIMIT_WINDOW
    );
    if (this.requestTimestamps.length > this.MAX_REQUESTS_PER_WINDOW) {
      this.requestTimestamps = this.requestTimestamps.slice(-this.MAX_REQUESTS_PER_WINDOW);
    }

    if (this.requestTimestamps.length >= this.MAX_REQUESTS_PER_WINDOW) {
      throw new ZeroXIOWalletError(
        ErrorCode.RATE_LIMIT_EXCEEDED,
        `Too many requests per second (max: ${this.MAX_REQUESTS_PER_WINDOW} per ${this.RATE_LIMIT_WINDOW}ms)`
      );
    }

    this.requestTimestamps.push(now);
  }

  private generateRequestId(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return `0xio-sdk-${crypto.randomUUID()}`;
    }
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const array = new Uint8Array(16);
      crypto.getRandomValues(array);
      const hex = Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
      return `0xio-sdk-${hex}`;
    }
    // A guessable id would let a page script spoof responses
    throw new ZeroXIOWalletError(
      ErrorCode.UNKNOWN_ERROR,
      'Cryptographic random number generation is not available in this environment'
    );
  }

  private startExtensionDetection(): void {
    if (typeof window === 'undefined') return;

    if (this.adapter.listenForReady) {
      this._adapterReadyTeardown = this.adapter.listenForReady(() => {
        this.logger.log(`Received wallet-ready event (adapter: ${this.adapter.name})`);
        this.isExtensionAvailableState = true;
      });
    }

    this._walletReadyMessageListener = (event: MessageEvent) => {
      if (event.data?.source !== '0xio-sdk-bridge' || event.data?.event?.type !== 'walletReady') {
        return;
      }

      const isSameOrigin = event.origin === window.location.origin;
      const isTauri = event.origin === 'tauri://localhost' || event.origin === 'https://tauri.localhost';
      const hasExplicitList = this.trustedOrigins.length > 0;
      // An explicit trustedParentOrigins list turns off implicit localhost trust
      const isLocalhostAllowed = !hasExplicitList &&
        (event.origin.startsWith('http://localhost:') || event.origin.startsWith('http://127.0.0.1:'));
      const isTrustedOrigin = this.trustedOrigins.includes(event.origin) || isTauri || isLocalhostAllowed;

      const inIframe = window.parent !== window;
      if (inIframe && event.source !== window.parent) {
        this.logger.warn(`Ignored walletReady from non-parent source in iframe mode`);
        return;
      }

      if (isSameOrigin || isTrustedOrigin) {
        this.logger.log('Received walletReady via postMessage from trusted origin');
        this.isExtensionAvailableState = true;
        this._parentTrusted = true;

        if (event.data.parentOrigin) {
          this._parentOrigin = event.data.parentOrigin;
        } else if (event.origin && event.origin !== 'null') {
          this._parentOrigin = event.origin;
        }
      } else {
        this.logger.warn(`Ignored walletReady from untrusted origin: ${event.origin}`);
      }
    };

    window.addEventListener('message', this._walletReadyMessageListener);

    if (window.parent !== window) {
      this.logger.log('Running inside a frame, waiting for the trusted walletReady signal');
    }

    this.checkExtensionAvailability();

    this.extensionDetectionInterval = setInterval(() => {
      this.checkExtensionAvailability();
    }, 2000);
  }

  private checkExtensionAvailability(): void {
    // Polling cannot see the parent bridge and would flip a trusted handshake back
    if (this._parentTrusted) {
      return;
    }

    const wasAvailable = this.isExtensionAvailableState;
    this.isExtensionAvailableState = this.hasExtensionContext() && this.detectExtensionSignals();

    if (!wasAvailable && this.isExtensionAvailableState) {
      this.logger.log('Extension became available');
    } else if (wasAvailable && !this.isExtensionAvailableState) {
      this.logger.warn('Extension became unavailable');
    }
  }

  private detectExtensionSignals(): boolean {
    return this.adapter.detect();
  }

  private async waitForExtensionAvailability(timeoutMs: number): Promise<boolean> {
    if (this.isExtensionAvailableState) {
      return true;
    }

    return new Promise((resolve) => {
      let resolved = false;
      const startTime = Date.now();
      let adapterReadyTeardown: (() => void) | null = null;
      // A protocol 2 wallet may announce synchronously inside listenForReady, before the poll starts.
      let checkInterval: ReturnType<typeof setInterval> | undefined;

      const cleanup = () => {
        if (checkInterval !== undefined) clearInterval(checkInterval);
        adapterReadyTeardown?.();
      };

      const onReady = () => {
        if (resolved) return;
        resolved = true;
        this.isExtensionAvailableState = true;
        cleanup();
        resolve(true);
      };

      if (this.adapter.listenForReady) {
        const teardown = this.adapter.listenForReady(onReady);
        if (resolved) {
          teardown();
          return;
        }
        adapterReadyTeardown = teardown;
      }

      checkInterval = setInterval(() => {
        if (resolved) return;

        if (this.isExtensionAvailableState) {
          resolved = true;
          cleanup();
          resolve(true);
          return;
        }

        if (Date.now() - startTime >= timeoutMs) {
          resolved = true;
          cleanup();
          resolve(false);
        }
      }, 100);
    });
  }

  private getBrowserDiagnostics(): any {
    if (typeof window === 'undefined') {
      return { environment: 'non-browser' };
    }
    const win = window as any;
    return {
      userAgent: navigator.userAgent,
      hasChrome: !!win.chrome,
      hasChromeRuntime: !!(win.chrome?.runtime),
      hasPostMessage: typeof window.postMessage === 'function',
      origin: window.location?.origin,
    };
  }

  private getExtensionDiagnostics(): any {
    return {
      initialized: this.isInitialized,
      available: this.isExtensionAvailableState,
      parentTrusted: this._parentTrusted,
      pendingRequests: this.pendingRequests.size,
      hasExtensionContext: this.hasExtensionContext(),
    };
  }

  /** Terminal: construct a new instance instead of calling initialize() again. */
  cleanup(): void {
    if (this.extensionDetectionInterval) {
      clearInterval(this.extensionDetectionInterval);
      this.extensionDetectionInterval = null;
    }

    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new ZeroXIOWalletError(ErrorCode.UNKNOWN_ERROR, 'SDK cleanup called'));
    }
    this.pendingRequests.clear();
    this.isInitialized = false;
    this.isExtensionAvailableState = false;
    this._parentTrusted = false;
    this._parentOrigin = null;
    this._interactiveInFlight = false;
    this._interactiveRid = null;

    this._adapterTeardown?.();
    this._adapterTeardown = null;
    this._adapterReadyTeardown?.();
    this._adapterReadyTeardown = null;

    if (typeof window !== 'undefined' && this._walletReadyMessageListener) {
      window.removeEventListener('message', this._walletReadyMessageListener);
      this._walletReadyMessageListener = null;
    }

    this.removeAllListeners();
    this.logger.log('Communication cleanup complete');
  }

  getDebugInfo(): {
    initialized: boolean;
    available: boolean;
    pendingRequests: number;
    hasExtensionContext: boolean;
    extensionDiagnostics: any;
  } {
    return {
      initialized: this.isInitialized,
      available: this.isExtensionAvailableState,
      pendingRequests: this.pendingRequests.size,
      hasExtensionContext: this.hasExtensionContext(),
      extensionDiagnostics: this.getExtensionDiagnostics()
    };
  }
}
