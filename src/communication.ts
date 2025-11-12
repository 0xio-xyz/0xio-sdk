/**
 * 0xio Wallet SDK - Extension Communication Module
 *
 * @fileoverview Manages secure communication between the SDK and browser extension.
 * Implements message passing, request/response handling, rate limiting, and origin validation
 * to ensure secure wallet interactions.
 *
 * @module communication
 * @version 1.2.0
 * @license MIT
 */

import {
  ExtensionRequest,
  ExtensionResponse,
  ErrorCode,
  ZeroXIOWalletError
} from './types';
import { retry, withTimeout, createLogger } from './utils';
import { EventEmitter } from './events';

/**
 * ExtensionCommunicator - Manages communication with the 0xio Wallet browser extension
 *
 * @class
 * @extends EventEmitter
 *
 * @description
 * Handles all communication between the SDK and wallet extension including:
 * - Request/response message passing with origin validation
 * - Rate limiting to prevent DoS attacks
 * - Automatic retry logic with exponential backoff
 * - Extension detection and availability monitoring
 * - Cryptographically secure request ID generation
 *
 * @example
 * ```typescript
 * const communicator = new ExtensionCommunicator(true); // debug mode
 * await communicator.initialize();
 *
 * const response = await communicator.sendRequest('get_balance', {});
 * console.log(response);
 * ```
 */
export class ExtensionCommunicator extends EventEmitter {
  /** Legacy request counter (deprecated, kept for fallback) */
  private requestId = 0;

  /** Map of pending requests awaiting responses */
  private pendingRequests = new Map<string, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
    retryCount: number;
  }>();

  /** Initialization state flag */
  private isInitialized = false;

  /** Logger instance for debugging */
  private logger: ReturnType<typeof createLogger>;

  /** Interval handle for periodic extension detection */
  private extensionDetectionInterval: NodeJS.Timeout | null = null;

  /** Current extension availability state */
  private isExtensionAvailableState = false;

  // Rate limiting configuration
  /** Maximum number of concurrent pending requests */
  private readonly MAX_CONCURRENT_REQUESTS = 50;

  /** Time window for rate limiting (milliseconds) */
  private readonly RATE_LIMIT_WINDOW = 1000;

  /** Maximum requests allowed per time window */
  private readonly MAX_REQUESTS_PER_WINDOW = 20;

  /** Timestamps of recent requests for rate limiting */
  private requestTimestamps: number[] = [];

  /**
   * Creates a new ExtensionCommunicator instance
   *
   * @param {boolean} debug - Enable debug logging
   */
  constructor(debug = false) {
    super(debug);
    this.logger = createLogger('ExtensionCommunicator', debug);
    this.setupMessageListener();
    this.startExtensionDetection();
  }

  /**
   * Initialize communication with the wallet extension
   *
   * @description
   * Performs initial setup and verification:
   * 1. Waits for extension to become available
   * 2. Sends ping to verify communication
   * 3. Establishes message handlers
   *
   * Must be called before any other methods.
   *
   * @returns {Promise<boolean>} True if initialization succeeded, false otherwise
   * @throws {ZeroXIOWalletError} If extension is not available after timeout
   *
   * @example
   * ```typescript
   * const success = await communicator.initialize();
   * if (!success) {
   *   console.error('Failed to initialize wallet connection');
   * }
   * ```
   */
  async initialize(): Promise<boolean> {
    if (this.isInitialized) {
      return true;
    }

    try {
      // Wait for extension detection with timeout
      const available = await this.waitForExtensionAvailability(10000);
      
      if (available) {
        // Verify with ping
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

  /**
   * Check if extension is available
   */
  isExtensionAvailable(): boolean {
    return this.isExtensionAvailableState && this.hasExtensionContext();
  }

  /**
   * Send request to extension
   */
  async sendRequest<T = any>(
    method: string, 
    params: any = {}, 
    timeout = 30000
  ): Promise<T> {
    return this.sendRequestWithRetry(method, params, 1, timeout);
  }

  /**
   * Send request to extension with automatic retry logic
   */
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
        {
          method,
          params,
          browserContext: this.getBrowserDiagnostics()
        }
      );
    }

    if (!this.isExtensionAvailableState) {
      // Wait a bit for extension to become available
      await this.waitForExtensionAvailability(5000);
      
      if (!this.isExtensionAvailableState) {
        throw new ZeroXIOWalletError(
          ErrorCode.EXTENSION_NOT_FOUND,
          'Extension not available for communication',
          {
            method,
            params,
            extensionState: this.getExtensionDiagnostics()
          }
        );
      }
    }

    // ✅ SECURITY: Check rate limits before processing
    this.checkRateLimit();

    return retry(async () => {
      const requestId = this.generateRequestId();
      const request: ExtensionRequest = {
        id: requestId,
        method,
        params,
        timestamp: Date.now()
      };

      this.logger.log(`Sending request (${method}):`, { id: requestId, params });

      return new Promise<T>((resolve, reject) => {
        // Set up timeout
        const timeoutHandle = setTimeout(() => {
          const pending = this.pendingRequests.get(requestId);
          if (pending) {
            this.pendingRequests.delete(requestId);
            reject(new ZeroXIOWalletError(
              ErrorCode.NETWORK_ERROR,
              `Request timeout after ${timeout}ms`,
              { 
                method, 
                params, 
                requestId,
                retryCount: pending.retryCount,
                extensionState: this.getExtensionDiagnostics()
              }
            ));
          }
        }, timeout);

        // Store request handlers
        this.pendingRequests.set(requestId, {
          resolve,
          reject,
          timeout: timeoutHandle,
          retryCount: 0
        });

        // Send message to extension via content script bridge
        this.postMessageToExtension(request);
      });
    }, maxRetries, 1000);
  }

  /**
   * Setup message listener for responses from extension
   */
  private setupMessageListener(): void {
    if (typeof window === 'undefined') {
      return; // Not in browser environment
    }

    const allowedOrigin = window.location.origin;

    window.addEventListener('message', (event) => {
      // ✅ SECURITY: Validate origin first - critical security check
      if (event.origin !== allowedOrigin) {
        this.logger.warn('Blocked message from untrusted origin:', event.origin);
        return;
      }

      // Only accept messages from same window
      if (event.source !== window) {
        return;
      }

      // Check if it's a 0xio SDK response
      if (!event.data || event.data.source !== 'octra-sdk-bridge') {
        return;
      }

      // Handle different types of messages
      if (event.data.response) {
        // Regular request/response
        const response = event.data.response as ExtensionResponse;
        if (response && response.id) {
          this.handleExtensionResponse(response);
        }
      } else if (event.data.event) {
        // Event notification from extension
        this.handleExtensionEvent(event.data.event);
      }
    });

    this.logger.log('Message listener setup complete');
  }

  /**
   * Handle extension event
   */
  private handleExtensionEvent(event: any): void {
    this.logger.log('Received extension event:', event.type);
    
    // Forward the event to listeners
    this.emit(event.type, event.data);
  }

  /**
   * Handle response from extension
   */
  private handleExtensionResponse(response: ExtensionResponse): void {
    this.logger.log(`Received response:`, { id: response.id, success: response.success });

    const pending = this.pendingRequests.get(response.id);
    if (!pending) {
      this.logger.warn(`Received response for unknown request ID: ${response.id}`);
      return;
    }

    // Clear timeout and remove from pending
    clearTimeout(pending.timeout);
    this.pendingRequests.delete(response.id);

    // Handle response
    if (response.success) {
      pending.resolve(response.data);
    } else {
      const error = response.error;
      if (error) {
        const enhancedError = new ZeroXIOWalletError(
          error.code,
          error.message,
          {
            ...error.details,
            requestId: response.id,
            retryCount: pending.retryCount,
            timestamp: Date.now(),
            extensionState: this.getExtensionDiagnostics()
          }
        );
        pending.reject(enhancedError);
      } else {
        pending.reject(new ZeroXIOWalletError(
          ErrorCode.UNKNOWN_ERROR,
          'Unknown error occurred',
          {
            requestId: response.id,
            retryCount: pending.retryCount,
            extensionState: this.getExtensionDiagnostics()
          }
        ));
      }
    }
  }

  /**
   * Post message to extension via content script
   */
  private postMessageToExtension(request: ExtensionRequest): void {
    // ✅ SECURITY: Use specific origin instead of wildcard
    const targetOrigin = window.location.origin;
    window.postMessage({
      source: 'octra-sdk-request',
      request
    }, targetOrigin);
  }

  /**
   * Check if we're in a context that can communicate with extension
   */
  private hasExtensionContext(): boolean {
    return typeof window !== 'undefined' && 
           typeof window.postMessage === 'function';
  }

  /**
   * Check and enforce rate limits to prevent denial-of-service attacks
   *
   * @private
   * @throws {ZeroXIOWalletError} RATE_LIMIT_EXCEEDED if limits are exceeded
   *
   * @description
   * Implements two-tier rate limiting:
   * 1. Concurrent requests: Maximum 50 pending requests at once
   * 2. Request frequency: Maximum 20 requests per second
   *
   * Rate limiting protects both the SDK and extension from:
   * - Accidental infinite loops in dApp code
   * - Malicious DoS attacks
   * - Resource exhaustion
   *
   * @security Critical security function - enforces resource limits
   */
  private checkRateLimit(): void {
    const now = Date.now();

    // ✅ SECURITY: Check concurrent request limit
    if (this.pendingRequests.size >= this.MAX_CONCURRENT_REQUESTS) {
      throw new ZeroXIOWalletError(
        ErrorCode.RATE_LIMIT_EXCEEDED,
        `Too many concurrent requests (max: ${this.MAX_CONCURRENT_REQUESTS})`
      );
    }

    // ✅ SECURITY: Check requests per time window
    this.requestTimestamps = this.requestTimestamps.filter(
      t => now - t < this.RATE_LIMIT_WINDOW
    );

    if (this.requestTimestamps.length >= this.MAX_REQUESTS_PER_WINDOW) {
      throw new ZeroXIOWalletError(
        ErrorCode.RATE_LIMIT_EXCEEDED,
        `Too many requests per second (max: ${this.MAX_REQUESTS_PER_WINDOW} per ${this.RATE_LIMIT_WINDOW}ms)`
      );
    }

    this.requestTimestamps.push(now);
  }

  /**
   * Generate cryptographically secure unique request ID
   *
   * @private
   * @returns {string} A unique, unpredictable request identifier
   *
   * @description
   * Uses Web Crypto API for secure random ID generation:
   * 1. Primary: crypto.randomUUID() - UUID v4 format
   * 2. Fallback: crypto.getRandomValues() - 128-bit random hex
   * 3. Last resort: timestamp + counter (logs warning)
   *
   * Security importance:
   * - Prevents request ID prediction attacks
   * - Mitigates replay attacks
   * - Makes session hijacking more difficult
   *
   * @security Critical - IDs must be cryptographically unpredictable
   */
  private generateRequestId(): string {
    // ✅ SECURITY: Use crypto.randomUUID() for secure, unpredictable IDs
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return `octra-sdk-${crypto.randomUUID()}`;
    }

    // Fallback to crypto.getRandomValues for older browsers
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const array = new Uint8Array(16);
      crypto.getRandomValues(array);
      const hex = Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
      return `octra-sdk-${hex}`;
    }

    // Last resort fallback (not recommended for production)
    this.logger.warn('Crypto API not available, using less secure ID generation');
    return `octra-sdk-${++this.requestId}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Start continuous extension detection
   */
  private startExtensionDetection(): void {
    if (typeof window === 'undefined') return;

    // Initial check
    this.checkExtensionAvailability();

    // Set up periodic checks
    this.extensionDetectionInterval = setInterval(() => {
      this.checkExtensionAvailability();
    }, 2000);
  }

  /**
   * Check if extension is currently available
   */
  private checkExtensionAvailability(): void {
    const wasAvailable = this.isExtensionAvailableState;
    
    // Basic checks for extension context
    this.isExtensionAvailableState = this.hasExtensionContext() && this.detectExtensionSignals();
    
    if (!wasAvailable && this.isExtensionAvailableState) {
      this.logger.log('Extension became available');
    } else if (wasAvailable && !this.isExtensionAvailableState) {
      this.logger.warn('Extension became unavailable');
    }
  }

  /**
   * Detect extension signals/indicators
   */
  private detectExtensionSignals(): boolean {
    if (typeof window === 'undefined') return false;
    
    // Check for extension-injected indicators
    const win = window as any;
    
    // Look for common extension indicators
    return !!(
      win.__OCTRA_EXTENSION__ ||
      win.octraWallet ||
      (win.chrome?.runtime?.id) ||
      document.querySelector('meta[name=\"octra-extension\"]') ||
      document.querySelector('[data-octra-extension]')
    );
  }

  /**
   * Wait for extension to become available
   */
  private async waitForExtensionAvailability(timeoutMs: number): Promise<boolean> {
    if (this.isExtensionAvailableState) {
      return true;
    }

    return new Promise((resolve) => {
      const startTime = Date.now();
      const checkInterval = setInterval(() => {
        if (this.isExtensionAvailableState) {
          clearInterval(checkInterval);
          resolve(true);
          return;
        }

        if (Date.now() - startTime >= timeoutMs) {
          clearInterval(checkInterval);
          resolve(false);
        }
      }, 200);
    });
  }

  /**
   * Get browser diagnostics for error reporting
   */
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
      extensionDetection: {
        hasOctraExtension: !!win.__OCTRA_EXTENSION__,
        hasZeroXIOWallet: !!win.octraWallet,
        hasChromeRuntimeId: !!(win.chrome?.runtime?.id),
        hasMetaTag: !!document.querySelector('meta[name=\"octra-extension\"]'),
        hasDataAttribute: !!document.querySelector('[data-octra-extension]')
      }
    };
  }

  /**
   * Get extension state diagnostics
   */
  private getExtensionDiagnostics(): any {
    return {
      initialized: this.isInitialized,
      available: this.isExtensionAvailableState,
      pendingRequests: this.pendingRequests.size,
      hasExtensionContext: this.hasExtensionContext(),
      browserDiagnostics: this.getBrowserDiagnostics()
    };
  }

  /**
   * Cleanup pending requests
   */
  cleanup(): void {
    if (this.extensionDetectionInterval) {
      clearInterval(this.extensionDetectionInterval);
      this.extensionDetectionInterval = null;
    }

    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new ZeroXIOWalletError(
        ErrorCode.UNKNOWN_ERROR,
        'SDK cleanup called'
      ));
    }
    
    this.pendingRequests.clear();
    this.isInitialized = false;
    this.isExtensionAvailableState = false;
    
    // Call parent cleanup
    this.removeAllListeners();
    
    this.logger.log('Communication cleanup complete');
  }

  /**
   * Get debug information
   */
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