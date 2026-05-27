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

// Adapter exports — implement WalletTransportAdapter to add new wallet support
export type { WalletTransportAdapter, AdapterRequest, AdapterIncomingMessage } from './adapter';
export { ZeroXIOAdapter, createZeroXIOAdapter } from './supports/0xio';
export { OctraProviderAdapter, createOctraProviderAdapter } from './supports/octra-provider';
export { detectWalletAdapter, getAllAdapters } from './supports';

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
  ContractParam,
  ContractParams,
  ContractCallData,
  ContractViewCallData,
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
  createDefaultBalance,
  isValidNetworkId
} from './config';

// Utility exports
export {
  // Validation utilities
  isValidAddress,
  isValidAmount,
  isValidMessage,
  isValidFeeLevel,

  // Address derivation
  deriveOctraAddress,

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

  // Browser utilities
  isBrowser,
  checkBrowserSupport,

  // Development utilities
  generateMockData,
  createLogger
} from './utils';

// Version information
export const SDK_VERSION = '2.7.1';
export const MIN_EXTENSION_VERSION = '2.0.1'; // Mainnet Alpha
export const MIN_EXTENSION_VERSION_DEVNET = '2.2.1'; // Devnet (contract calls, privacy)
export const SUPPORTED_EXTENSION_VERSIONS = '^2.0.1'; // Supports all versions >= 2.0.1

// Quick setup function for simple use cases
export async function createZeroXIOWallet(config: {
  appName: string;
  appDescription?: string;
  debug?: boolean;
  autoConnect?: boolean;
  adapter?: import('./adapter').WalletTransportAdapter;
}) {
  const { ZeroXIOWallet } = await import('./wallet');

  const wallet = new ZeroXIOWallet({
    appName: config.appName,
    appDescription: config.appDescription,
    debug: config.debug || false,
    ...(config.adapter ? { adapter: config.adapter } : {}),
  });

  await wallet.initialize();

  if (config.autoConnect) {
    try {
      await wallet.connect();
    } catch {
      // Don't throw - let the app handle connection manually
    }
  }

  return wallet;
}


// Browser detection and compatibility check
export function checkSDKCompatibility(): {
  compatible: boolean;
  issues: string[];
  recommendations: string[];
} {
  const issues: string[] = [];
  const recommendations: string[] = [];

  // Hard blockers — SDK cannot function without these
  if (typeof window === 'undefined') {
    issues.push('Window object not available');
    recommendations.push('SDK must be used in a browser environment');
    return { compatible: false, issues, recommendations };
  }

  if (typeof window.postMessage !== 'function') {
    issues.push('postMessage API not available');
    recommendations.push('Your browser environment must support postMessage');
  }

  if (typeof window.addEventListener !== 'function') {
    issues.push('addEventListener not available');
  }

  if (typeof Promise === 'undefined') {
    issues.push('Promise not available');
  }

  // Informational: note which transport is likely active
  if (issues.length === 0) {
    const win = window as any;
    const hasExtension = !!(win.wallet0xio || win.ZeroXIOWallet || win.chrome?.runtime?.id ||
      document.querySelector('meta[name="0xio-dapp"]') || document.querySelector('[data-0xio-sdk-bridge]'));
    const hasParentBridge = window.parent !== window;

    if (!hasExtension && !hasParentBridge) {
      recommendations.push(
        'No 0xio transport detected yet. Install the 0xio Wallet browser extension, ' +
        'or run inside the 0xio Desktop/Mobile app iframe bridge.'
      );
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
  const isDevelopment = (typeof globalThis !== 'undefined' && (globalThis as any).process?.env?.NODE_ENV === 'development') ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1';

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
      // simulateExtensionEvent removed for security — could be exploited on staging builds
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