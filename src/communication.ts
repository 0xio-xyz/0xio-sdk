/**
 * 0xio Wallet SDK - Extension Communication Module
 *
 * @fileoverview Manages secure communication between the SDK and browser extension.
 * Implements message passing, request/response handling, rate limiting, and origin validation
 * to ensure secure wallet interactions.
 *
 * @module communication
 * @version 2.7.0
 * @license MIT
 */

import {
  ExtensionRequest,
  ExtensionResponse,
  ErrorCode,
  ZeroXIOWalletError
} from './types';
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
  }>();

  private isInitialized = false;
  private logger: ReturnType<typeof createLogger>;
  private extensionDetectionInterval: ReturnType<typeof setInterval> | null = null;
  private isExtensionAvailableState = false;
  private trustedOrigins: string[] = [];
  private _parentOrigin: string | null = null;

  /** Pluggable transport — defaults to the 0xio postMessage protocol. */
  private adapter: WalletTransportAdapter;
  /** Teardown fn returned by adapter.listen() */
  private _adapterTeardown: (() => void) | null = null;
  /** Teardown fn returned by adapter.listenForReady() */
  private _adapterReadyTeardown: (() => void) | null = null;

  /**
   * Set when a trusted walletReady has been received from window.parent.
   * The polling fallback must NOT clear this flag.
   */
  private _parentTrusted = false;

  /** walletReady postMessage listener stored for cleanup */
  private _walletReadyMessageListener: ((e: MessageEvent) => void) | null = null;

  /**
   * In-flight interactive request lock.
   * Methods that open approval popups are serialized — only one at a time.
   */
  private _interactiveInFlight = false;

  private readonly MAX_CONCURRENT_REQUESTS = 50;
  private readonly RATE_LIMIT_WINDOW = 1000;
  private readonly MAX_REQUESTS_PER_WINDOW = 20;
  private requestTimestamps: number[] = [];

  constructor(debug = false, trustedOrigins: string[] = [], adapter?: WalletTransportAdapter) {
    super(debug);
    this.logger = createLogger('ExtensionCommunicator', debug);
    this.trustedOrigins = trustedOrigins;
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
      const available = await this.waitForExtensionAvailability(10000);

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

  // Methods that trigger user-facing popups — NEVER retry these.
  // Retrying sends a second request while the first popup is still open,
  // causing double popups where the second tx fails (stale nonce/state).
  private static readonly NO_RETRY_METHODS = new Set([
    'connect', 'send_transaction', 'call_contract', 'signMessage',
    'sign_transaction', 'broadcast_only',
    'send_private_transfer', 'claim_private_transfer',
    'encrypt_balance', 'decrypt_balance',
  ]);

  private static readonly INTERACTIVE_METHODS = ExtensionCommunicator.NO_RETRY_METHODS;

  async sendRequest<T = any>(
    method: string,
    params: any = {},
    timeout = 30000
  ): Promise<T> {
    const isInteractive = ExtensionCommunicator.NO_RETRY_METHODS.has(method);
    const maxRetries = isInteractive ? 0 : 1;
    const effectiveTimeout = isInteractive ? Math.max(timeout, 180000) : timeout;
    return this.sendRequestWithRetry(method, params, maxRetries, effectiveTimeout);
  }

  async sendRequestWithRetry<T = any>(
    method: string,
    params: any = {},
    maxRetries = 3,
    timeout = 30000
  ): Promise<T> {
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
    if (isInteractive) {
      if (this._interactiveInFlight) {
        throw new ZeroXIOWalletError(
          ErrorCode.RATE_LIMIT_EXCEEDED,
          'Another approval popup is already open. Please wait for it to complete.'
        );
      }
      this._interactiveInFlight = true;
    }

    this.checkRateLimit();

    try {
      return await retry(async () => {
        const requestId = this.generateRequestId();
        const request: ExtensionRequest = {
          id: requestId,
          method,
          params,
          timestamp: Date.now()
        };

        this.logger.log(`Sending request (${method}):`, { id: requestId });

        return new Promise<T>((resolve, reject) => {
          const timeoutHandle = setTimeout(() => {
            const pending = this.pendingRequests.get(requestId);
            if (pending) {
              this.pendingRequests.delete(requestId);
              reject(new ZeroXIOWalletError(
                ErrorCode.NETWORK_ERROR,
                `Request timeout after ${timeout}ms`,
                { method, requestId, retryCount: pending.retryCount }
              ));
            }
          }, timeout);

          this.pendingRequests.set(requestId, {
            resolve,
            reject,
            timeout: timeoutHandle,
            retryCount: 0
          });

          // Wrap postMessage so a DataCloneError cleans up the pending entry
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
      if (isInteractive) {
        this._interactiveInFlight = false;
      }
    }
  }

  private setupMessageListener(): void {
    if (typeof window === 'undefined') return;

    this._adapterTeardown = this.adapter.listen(
      (msg) => {
        if (msg.requestId !== undefined) {
          // response — map AdapterIncomingMessage → ExtensionResponse shape
          if (this.pendingRequests.has(msg.requestId)) {
            this.handleExtensionResponse({
              id: msg.requestId,
              success: msg.success ?? false,
              data: msg.data,
              error: msg.error as any,
              timestamp: Date.now(),
            });
          }
        } else if (msg.eventType) {
          this.handleExtensionEvent({ type: msg.eventType, data: msg.eventData });
        }
      },
      { trustedParentOrigins: this.trustedOrigins }
    );

    this.logger.log(`Message listener setup complete (adapter: ${this.adapter.name})`);
  }

  // only forward known event types
  private static readonly VALID_EVENT_TYPES = new Set<string>([
    'connect', 'disconnect', 'accountChanged', 'balanceChanged',
    'networkChanged', 'transactionConfirmed', 'permissionsChanged', 'message',
    'error', 'extensionLocked', 'extensionUnlocked'
  ]);

  private handleExtensionEvent(event: any): void {
    if (!event?.type || !ExtensionCommunicator.VALID_EVENT_TYPES.has(event.type)) {
      this.logger.warn(`Received unknown event type from bridge: ${event?.type}`);
      return;
    }
    this.logger.log('Received extension event:', event.type);
    this.emit(event.type, event.data);
  }

  private handleExtensionResponse(response: ExtensionResponse): void {
    this.logger.log(`Received response:`, { id: response.id, success: response.success });

    const pending = this.pendingRequests.get(response.id);
    if (!pending) {
      this.logger.warn(`Received response for unknown request ID: ${response.id}`);
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(response.id);

    // Require strict boolean true — "false" string or other truthy values are failures
    if (response.success === true) {
      pending.resolve(response.data);
    } else {
      const error = response.error;
      if (error) {
        // Handle both object {code, message} and legacy plain-string error formats
        const isObj = error !== null && typeof error === 'object';
        const code: ErrorCode = isObj && error.code ? error.code : ErrorCode.UNKNOWN_ERROR;
        const message: string = isObj
          ? (error.message ?? 'Unknown error')
          : (typeof error === 'string' ? error : 'Unknown error');
        const enhancedError = new ZeroXIOWalletError(
          code,
          message,
          // Redact bridge-supplied error details; only keep non-sensitive metadata
          { requestId: response.id, retryCount: pending.retryCount, timestamp: Date.now() }
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
    // Parent bridge (iframe/desktop mode) — only when a trusted origin is established.
    // Sending with '*' would leak method + params to any intercepting frame.
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

    // Trim expired timestamps — cap array size to prevent unbounded growth in idle tabs
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
    // Crypto API unavailable — throw rather than produce a guessable ID that
    // could allow response spoofing via a known requestId.
    throw new ZeroXIOWalletError(
      ErrorCode.UNKNOWN_ERROR,
      'Cryptographic random number generation is not available in this environment'
    );
  }

  private startExtensionDetection(): void {
    if (typeof window === 'undefined') return;

    // Adapter-provided wallet-ready events (e.g. '0xioWalletReady', 'exampleWalletReady')
    if (this.adapter.listenForReady) {
      this._adapterReadyTeardown = this.adapter.listenForReady(() => {
        this.logger.log(`Received wallet-ready event (adapter: ${this.adapter.name})`);
        this.isExtensionAvailableState = true;
      });
    }

    // walletReady via postMessage (desktop/mobile iframe bridge) — store ref for cleanup
    this._walletReadyMessageListener = (event: MessageEvent) => {
      if (event.data?.source !== '0xio-sdk-bridge' || event.data?.event?.type !== 'walletReady') {
        return;
      }

      const isSameOrigin = event.origin === window.location.origin;
      const isLocalhost = event.origin.startsWith('http://localhost:') || event.origin.startsWith('http://127.0.0.1:');
      const isTauri = event.origin === 'tauri://localhost' || event.origin === 'https://tauri.localhost';
      const isTrustedOrigin = this.trustedOrigins.includes(event.origin) || isTauri || isLocalhost;

      // In iframe mode, only trust the actual parent window
      const inIframe = window.parent !== window;
      if (inIframe && event.source !== window.parent) {
        this.logger.warn(`Ignored walletReady from non-parent source in iframe mode`);
        return;
      }

      if (isSameOrigin || isTrustedOrigin) {
        this.logger.log('Received walletReady via postMessage from trusted origin');
        this.isExtensionAvailableState = true;
        this._parentTrusted = true; // Mark parent-bridge readiness separately

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
      this.logger.log('Running inside a frame — waiting for trusted walletReady signal');
    }

    this.checkExtensionAvailability();

    this.extensionDetectionInterval = setInterval(() => {
      this.checkExtensionAvailability();
    }, 2000);
  }

  private checkExtensionAvailability(): void {
    // If parent-bridge readiness was established via a trusted walletReady handshake,
    // preserve that state — the polling fallback (detectExtensionSignals) does not
    // consider the iframe parent signal and would incorrectly flip state back
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

      const cleanup = () => {
        clearInterval(checkInterval);
        adapterReadyTeardown?.();
      };

      const onReady = () => {
        if (resolved) return;
        resolved = true;
        this.isExtensionAvailableState = true;
        cleanup();
        resolve(true);
      };

      // Use adapter's listenForReady for fast resolution; polling is the fallback
      if (this.adapter.listenForReady) {
        adapterReadyTeardown = this.adapter.listenForReady(onReady);
      }

      const checkInterval = setInterval(() => {
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

  /**
   * Clean up SDK resources.
   * After cleanup() the instance is terminal — do not call initialize() again.
   * Construct a new instance instead.
   */
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

    // Tear down adapter listeners (response/event + wallet-ready)
    this._adapterTeardown?.();
    this._adapterTeardown = null;
    this._adapterReadyTeardown?.();
    this._adapterReadyTeardown = null;

    // Remove walletReady postMessage listener (parent iframe bridge)
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
