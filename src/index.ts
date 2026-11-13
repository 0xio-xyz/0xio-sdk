import { SDK_VERSION } from './version';

export { ZeroXIOWallet } from './wallet';
export { EventEmitter } from './events';
export { ExtensionCommunicator } from './communication';
export { DesktopTransport, canUseDesktopTransport, DESKTOP_WS_URL } from './desktop';

export { detectWallet, isMobileBrowser } from './detect';
export {
  WALLET_PROTOCOL,
  SUPPORTED_PROTOCOLS,
  WALLET_CAPABILITIES,
  WALLET_KINDS,
  ANNOUNCE_EVENT,
  ANNOUNCE_REQUEST_EVENT,
  LIFECYCLE_METHODS,
  TRANSACTION_METHODS,
  REQUEST_STATUSES,
  FINAL_REQUEST_STATUSES,
  REQUEST_STATUS_TRANSITIONS,
  WIRE_ERROR_CODES,
  LIFECYCLE_LIMITS,
  CONFIRM_WAIT_MS,
  STATUS_POLL_MS,
  DEFAULT_DETECT_TIMEOUT_MS,
  OPEN_IN_APP_URL,
  OPEN_IN_APP_SCHEME_URL,
  newRequestId,
  isRequestId,
  isFinalStatus,
  canTransition,
  canonicalJson,
  requestDigest,
  requestDigestInput,
  parseRequestStatus,
  openInAppUrl,
} from './lifecycle';
export type { WalletCapability, AnnounceDetail } from './lifecycle';

export type { WalletTransportAdapter, AdapterRequest, AdapterIncomingMessage } from './adapter';
export { ZeroXIOAdapter, createZeroXIOAdapter } from './supports/0xio';
export { OctraProviderAdapter, createOctraProviderAdapter } from './supports/octra-provider';
export { detectWalletAdapter, getAllAdapters } from './supports';

export {
  WALLET_PERMISSIONS,
  LEGACY_PERMISSION_MAP,
  toWalletPermissions,
  withLegacyAliases,
} from './permissions';
export type { WalletPermission } from './permissions';

export type {
  WalletAddress,
  Balance,
  NetworkInfo,
  ConnectionInfo,
  ConnectOptions,
  SDKConfig,
  WalletTransportKind,

  ContractParam,
  ContractParams,
  ContractCallData,
  ContractDeployData,
  ContractDeployResult,
  ContractViewCallData,
  TransactionData,
  SignedTransaction,
  TransactionFinality,
  TransactionResult,
  TransactionHistory,
  Transaction,

  WalletEventType,
  WalletEvent,
  ConnectEvent,
  DisconnectEvent,
  AccountChangedEvent,
  BalanceChangedEvent,
  NetworkChangedEvent,
  TransactionConfirmedEvent,
  ErrorEvent,

  PrivateBalanceInfo,
  PrivateTransferData,
  PendingPrivateTransfer,
  PrivateViewKeyRegistration,

  Permission,

  ExtensionRequest,
  ExtensionResponse,
  WalletKind,
  WalletProtocolVersion,
  WalletInfo,
  RequestStatusValue,
  RequestStatus,
  RequestStatusError,
  ContractReceipt,
  ContractReceiptEvent,
  ReviewOptions,
  WriteOptions,
  WriteOutcome,
  WaitForRequestOptions,
  PendingRequestInfo,
  DesktopPresence,
  DetectResult,
  DetectOptions,
  ConnectProgressEvent
} from './types';

export { ErrorCode, ZeroXIOWalletError } from './types';

export { ONS_SUFFIX, ONS_LIST_URL, onsContract, normalizeOnsName, isOnsName } from './supports/ons';
export type { ResolvedName } from './supports/ons';

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

export {
  isValidAddress,
  isValidAmount,
  isValidMessage,
  isValidFeeLevel,

  deriveOctraAddress,

  formatOCT,
  formatOCT as formatZeroXIO,
  formatAddress,
  formatTimestamp,
  formatTxHash,

  toMicroOCT,
  toMicroOCT as toMicroZeroXIO,
  octToMicro,
  fromMicroOCT,
  fromMicroOCT as fromMicroZeroXIO,

  createErrorMessage,
  isErrorType,

  delay,

  isBrowser,
  checkBrowserSupport,

  generateMockData,
  createLogger
} from './utils';

export {
  SIGNED_MESSAGE_PREFIX,
  SIGNED_MESSAGE_VERSION,
  getSignedMessageBytes,
  buildAuthMessage,
  verifyMessage
} from './signing';

export { SDK_VERSION };
export const MIN_EXTENSION_VERSION = '2.0.1';
export const MIN_EXTENSION_VERSION_DEVNET = '2.2.1';
export const SUPPORTED_EXTENSION_VERSIONS = '>=2.0.1';

export async function createZeroXIOWallet(config: {
  appName: string;
  appDescription?: string;
  debug?: boolean;
  autoConnect?: boolean;
  adapter?: import('./adapter').WalletTransportAdapter;
  desktop?: boolean;
}) {
  const { ZeroXIOWallet } = await import('./wallet');

  const wallet = new ZeroXIOWallet({
    appName: config.appName,
    appDescription: config.appDescription,
    debug: config.debug || false,
    ...(config.adapter ? { adapter: config.adapter } : {}),
    ...(config.desktop === false ? { desktop: false } : {}),
  });

  await wallet.initialize();

  if (config.autoConnect) {
    try {
      await wallet.connect();
    } catch {
      // connect() failures are left to the app
    }
  }

  return wallet;
}

export function checkSDKCompatibility(): {
  compatible: boolean;
  issues: string[];
  recommendations: string[];
} {
  const issues: string[] = [];
  const recommendations: string[] = [];

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

  if (issues.length === 0) {
    const win = window as any;
    const hasExtension = !!(win.wallet0xio || win.ZeroXIOWallet || win.chrome?.runtime?.id ||
      document.querySelector('meta[name="0xio-dapp"]') || document.querySelector('[data-0xio-sdk-bridge]'));
    const hasParentBridge = window.parent !== window;

    if (!hasExtension && !hasParentBridge) {
      recommendations.push(
        'No 0xio transport detected yet. Install the 0xio Wallet browser extension, ' +
        'open 0xio Desktop (reached directly from secure pages), ' +
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

if (typeof window !== 'undefined') {
  (window as any).__OCTRA_SDK_VERSION__ = SDK_VERSION;
  (window as any).__ZEROXIO_SDK_VERSION__ = SDK_VERSION;

  const isDevelopment = (typeof globalThis !== 'undefined' && (globalThis as any).process?.env?.NODE_ENV === 'development') ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1';

  if (isDevelopment) {
    (window as any).__OCTRA_SDK_DEBUG__ = true;
    (window as any).__ZEROXIO_SDK_DEBUG__ = true;

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
      showWelcome: () => {
        console.log(`[0xio SDK] Development mode - SDK v${SDK_VERSION}`);
        console.log('[0xio SDK] Debug utilities available at window.__ZEROXIO_SDK_UTILS__');
      }
    };

    (window as any).__OCTRA_SDK_UTILS__ = (window as any).__ZEROXIO_SDK_UTILS__;
  }
}