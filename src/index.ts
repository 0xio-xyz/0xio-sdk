/**
 * 0xio Wallet SDK - Main Entry Point
 * Official SDK for integrating with 0xio Wallet Extension
 *
 * @example
 * ```typescript
 * import { ZeroXIOWallet } from '@0xio/sdk';
 *
 * const wallet = new ZeroXIOWallet({
 *   appName: 'My DApp',
 *   appDescription: 'An awesome decentralized application',
 *   requiredPermissions: ['read_balance', 'send_transactions', 'sign_messages']
 * });
 *
 * await wallet.initialize();
 * await wallet.connect();
 *
 * const balance = await wallet.getBalance();
 * console.log('Balance:', balance.total, 'OCT');
 *
 * const signature = await wallet.signMessage('Hello, 0xio!');
 * console.log('Signature:', signature);
 * ```
 */

// Main exports
export { ZeroXIOWallet } from './wallet';
export { EventEmitter } from './events';
export { ExtensionCommunicator } from './communication';

// Type exports
export type {
  // Core types
  WalletAddress,
  Balance,
  NetworkInfo,
  ConnectionInfo,
  ConnectOptions,
  SDKConfig,

  // Transaction types
  TransactionData,
  SignedTransaction,
  TransactionFinality,
  TransactionResult,
  TransactionHistory,
  Transaction,

  // Event types
  WalletEventType,
  WalletEvent,
  ConnectEvent,
  DisconnectEvent,
  AccountChangedEvent,
  BalanceChangedEvent,
  NetworkChangedEvent,
  TransactionConfirmedEvent,
  ErrorEvent,

  // Private balance types
  PrivateBalanceInfo,
  PrivateTransferData,
  PendingPrivateTransfer,

  // Permission types
  Permission,

  // Communication types
  ExtensionRequest,
  ExtensionResponse
} from './types';

// Error exports
export { ErrorCode, ZeroXIOWalletError } from './types';

// Configuration exports
export {
  NETWORKS,
  DEFAULT_NETWORK_ID,
  SDK_CONFIG,
  getNetworkConfig,
  getAllNetworks,
  getDefaultNetwork,
  createDefaultBalance
} from './config';

// Utility exports
export {
  // Validation utilities
  isValidAddress,
  isValidAmount,
  isValidMessage,
  isValidFeeLevel,
  isValidNetworkId,

  // Formatting utilities
  formatOCT,
  formatOCT as formatZeroXIO,
  formatAddress,
  formatTimestamp,
  formatTxHash,

  // Conversion utilities
  toMicroOCT,
  toMicroOCT as toMicroZeroXIO,
  fromMicroOCT,
  fromMicroOCT as fromMicroZeroXIO,

  // Error utilities
  createErrorMessage,
  isErrorType,

  // Async utilities
  delay,
  retry,
  withTimeout,

  // Browser utilities
  isBrowser,
  checkBrowserSupport,

  // Development utilities
  generateMockData,
  createLogger
} from './utils';

// Version information
export const SDK_VERSION = '2.1.8';
export const MIN_EXTENSION_VERSION = '2.0.1';
export const SUPPORTED_EXTENSION_VERSIONS = '^2.0.1'; // Supports all versions >= 2.0.1

// Quick setup function for simple use cases
export async function createZeroXIOWallet(config: {
  appName: string;
  appDescription?: string;
  debug?: boolean;
  autoConnect?: boolean;
}) {
  const { ZeroXIOWallet } = await import('./wallet');

  const wallet = new ZeroXIOWallet({
    appName: config.appName,
    appDescription: config.appDescription,
    debug: config.debug || false
  });

  await wallet.initialize();

  if (config.autoConnect) {
    try {
      await wallet.connect();
    } catch (error) {
      if (config.debug) {
        // console.warn('[0xio SDK] Auto-connect failed:', error);
      }
      // Don't throw - let the app handle connection manually
    }
  }

  return wallet;
}

// Legacy alias for backward compatibility
export const createOctraWallet = createZeroXIOWallet;

// Browser detection and compatibility check
export function checkSDKCompatibility(): {
  compatible: boolean;
  issues: string[];
  recommendations: string[];
} {
  const issues: string[] = [];
  const recommendations: string[] = [];

  // Basic browser support check
  if (typeof window === 'undefined') {
    issues.push('Window object not available');
    recommendations.push('SDK must be used in a browser environment');
  }

  // Check for extension APIs
  if (typeof window !== 'undefined') {
    const win = window as any;
    if (!win.chrome || !win.chrome.runtime) {
      issues.push('Chrome extension APIs not available');
      recommendations.push('This SDK requires a Chromium-based browser (Chrome, Edge, Brave, etc.)');
    }
  }

  return {
    compatible: issues.length === 0,
    issues,
    recommendations
  };
}

// Development helpers
if (typeof window !== 'undefined') {
  // Expose SDK version for debugging (support both old and new naming)
  (window as any).__OCTRA_SDK_VERSION__ = SDK_VERSION;
  (window as any).__ZEROXIO_SDK_VERSION__ = SDK_VERSION;

  // Development mode detection
  const isDevelopment = process.env.NODE_ENV === 'development' ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname.includes('dev');

  if (isDevelopment) {
    // Set debug flag but don't automatically log
    (window as any).__OCTRA_SDK_DEBUG__ = true;
    (window as any).__ZEROXIO_SDK_DEBUG__ = true;

    // Expose debugging utilities (new branding)
    (window as any).__ZEROXIO_SDK_UTILS__ = {
      enableDebugMode: () => {
        (window as any).__ZEROXIO_SDK_DEBUG__ = true;
        (window as any).__OCTRA_SDK_DEBUG__ = true;
        console.log('[0xio SDK] Debug mode enabled');
      },
      disableDebugMode: () => {
        (window as any).__ZEROXIO_SDK_DEBUG__ = false;
        (window as any).__OCTRA_SDK_DEBUG__ = false;
        console.log('[0xio SDK] Debug mode disabled');
      },
      getSDKInfo: () => ({
        version: SDK_VERSION,
        minExtensionVersion: MIN_EXTENSION_VERSION,
        supportedExtensions: SUPPORTED_EXTENSION_VERSIONS,
        debugMode: !!(window as any).__ZEROXIO_SDK_DEBUG__,
        environment: isDevelopment ? 'development' : 'production'
      }),
      simulateExtensionEvent: (eventType: string, data: any) => {
        window.postMessage({
          source: '0xio-sdk-bridge',
          event: { type: eventType, data }
        }, '*');
        console.log('[0xio SDK] Simulated extension event:', eventType, data);
      },
      showWelcome: () => {
        console.log(`[0xio SDK] Development mode - SDK v${SDK_VERSION}`);
        console.log('[0xio SDK] Debug utilities available at window.__ZEROXIO_SDK_UTILS__');
      }
    };

    // Legacy alias for backward compatibility
    (window as any).__OCTRA_SDK_UTILS__ = (window as any).__ZEROXIO_SDK_UTILS__;

    // Only show welcome message if specifically requested or on localhost
    // if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    //   (window as any).__ZEROXIO_SDK_UTILS__.showWelcome();
    // }
  }
}