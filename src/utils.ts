/**
 * 0xio Wallet SDK - Utilities
 * Helper functions for validation, formatting, and common operations
 */

import { ErrorCode, ZeroXIOWalletError } from './types';

// ===================
// VALIDATION UTILITIES
// ===================

/**
 * Validate wallet address for Octra blockchain
 */
export function isValidAddress(address: string): boolean {
  if (!address || typeof address !== 'string') {
    return false;
  }

  // Octra addresses should match the expected format
  // This is a basic validation - adjust based on actual Octra address format
  const addressRegex = /^[A-Za-z0-9]{20,64}$/;
  return addressRegex.test(address);
}

/**
 * Validate transaction amount
 */
export function isValidAmount(amount: number): boolean {
  return typeof amount === 'number' &&
    amount > 0 &&
    Number.isFinite(amount) &&
    amount <= Number.MAX_SAFE_INTEGER;
}

/**
 * Validate network ID
 */
export function isValidNetworkId(networkId: string): boolean {
  if (!networkId || typeof networkId !== 'string') {
    return false;
  }

  const validNetworks = ['mainnet', 'testnet', 'devnet'];
  return validNetworks.includes(networkId.toLowerCase());
}

/**
 * Validate transaction message
 */
export function isValidMessage(message: string): boolean {
  if (!message) {
    return true; // Empty messages are valid
  }

  if (typeof message !== 'string') {
    return false;
  }

  // Check length (adjust based on network limits)
  return message.length <= 280;
}

/**
 * Validate fee level
 */
export function isValidFeeLevel(feeLevel: number): boolean {
  return feeLevel === 1 || feeLevel === 3;
}

// ===================
// FORMATTING UTILITIES
// ===================

/**
 * Format OCT amount for display
 */
export function formatOCT(amount: number, decimals = 6): string {
  if (!isValidAmount(amount)) {
    return '0';
  }

  return amount.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals
  });
}

/**
 * Format address for display (truncated)
 */
export function formatAddress(address: string, prefixLength = 6, suffixLength = 4): string {
  if (!isValidAddress(address)) {
    return 'Invalid Address';
  }

  if (address.length <= prefixLength + suffixLength) {
    return address;
  }

  return `${address.slice(0, prefixLength)}...${address.slice(-suffixLength)}`;
}

/**
 * Format timestamp for display
 */
export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleString();
}

/**
 * Format transaction hash for display
 */
export function formatTxHash(hash: string, length = 12): string {
  if (!hash || typeof hash !== 'string') {
    return 'Invalid Hash';
  }

  if (hash.length <= length) {
    return hash;
  }

  const prefixLength = Math.ceil(length / 2);
  const suffixLength = Math.floor(length / 2);

  return `${hash.slice(0, prefixLength)}...${hash.slice(-suffixLength)}`;
}

// ===================
// CONVERSION UTILITIES
// ===================

/**
 * Convert OCT to micro OCT (for network transmission)
 */
export function toMicroOCT(amount: number): string {
  if (!isValidAmount(amount)) {
    throw new ZeroXIOWalletError(
      ErrorCode.INVALID_AMOUNT,
      'Invalid amount for conversion'
    );
  }

  // Assuming OCT has 6 decimal places like many cryptocurrencies
  const microOCT = Math.round(amount * 1_000_000);
  return microOCT.toString();
}

/**
 * Convert micro OCT to OCT (for display)
 */
export function fromMicroOCT(microAmount: string | number): number {
  const amount = typeof microAmount === 'string' ? parseInt(microAmount, 10) : microAmount;

  if (!Number.isFinite(amount) || amount < 0) {
    throw new ZeroXIOWalletError(
      ErrorCode.INVALID_AMOUNT,
      'Invalid micro OCT amount for conversion'
    );
  }

  return amount / 1_000_000;
}

// ===================
// ERROR UTILITIES
// ===================

/**
 * Create standardized error messages
 */
export function createErrorMessage(code: ErrorCode, context?: string): string {
  const baseMessages: Record<ErrorCode, string> = {
    [ErrorCode.EXTENSION_NOT_FOUND]: '0xio Wallet extension is not installed or enabled',
    [ErrorCode.CONNECTION_REFUSED]: 'Connection to wallet was refused',
    [ErrorCode.USER_REJECTED]: 'User rejected the request',
    [ErrorCode.INSUFFICIENT_BALANCE]: 'Insufficient balance for this transaction',
    [ErrorCode.INVALID_ADDRESS]: 'Invalid wallet address provided',
    [ErrorCode.INVALID_AMOUNT]: 'Invalid transaction amount',
    [ErrorCode.NETWORK_ERROR]: 'Network communication error',
    [ErrorCode.TRANSACTION_FAILED]: 'Transaction failed to process',
    [ErrorCode.SIGNATURE_FAILED]: 'Message signing failed or was rejected',
    [ErrorCode.PERMISSION_DENIED]: 'Permission denied for this operation',
    [ErrorCode.WALLET_LOCKED]: 'Wallet is locked, please unlock first',
    [ErrorCode.RATE_LIMIT_EXCEEDED]: 'Rate limit exceeded, please try again later',
    [ErrorCode.UNKNOWN_ERROR]: 'An unknown error occurred'
  };

  const baseMessage = baseMessages[code] || 'Unknown error';
  return context ? `${baseMessage}: ${context}` : baseMessage;
}

/**
 * Check if error is a specific type
 */
export function isErrorType(error: any, code: ErrorCode): boolean {
  return error instanceof ZeroXIOWalletError && error.code === code;
}

// ===================
// ASYNC UTILITIES
// ===================

/**
 * Create a promise that resolves after a delay
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry an async operation with exponential backoff
 */
export async function retry<T>(
  operation: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 1000
): Promise<T> {
  let lastError: Error;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;

      if (attempt === maxRetries) {
        break; // Last attempt failed
      }

      // Exponential backoff: 1s, 2s, 4s, etc.
      const delayMs = baseDelay * Math.pow(2, attempt);
      await delay(delayMs);
    }
  }

  throw lastError!;
}

/**
 * Timeout wrapper for promises
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage = 'Operation timed out'
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new ZeroXIOWalletError(
        ErrorCode.NETWORK_ERROR,
        timeoutMessage
      ));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]);
}

// ===================
// BROWSER UTILITIES
// ===================

/**
 * Check if running in browser environment
 */
export function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

/**
 * Check if browser supports required features
 */
export function checkBrowserSupport(): {
  supported: boolean;
  missingFeatures: string[];
} {
  const missingFeatures: string[] = [];

  if (!isBrowser()) {
    missingFeatures.push('Browser environment');
    return { supported: false, missingFeatures };
  }

  // Check for required browser APIs
  if (typeof window.postMessage !== 'function') {
    missingFeatures.push('PostMessage API');
  }

  if (typeof window.addEventListener !== 'function') {
    missingFeatures.push('Event Listeners');
  }

  if (typeof Promise === 'undefined') {
    missingFeatures.push('Promise support');
  }

  return {
    supported: missingFeatures.length === 0,
    missingFeatures
  };
}

// ===================
// DEVELOPMENT UTILITIES
// ===================

/**
 * Generate mock data for development/testing
 */
export function generateMockData() {
  return {
    address: 'OCT' + Math.random().toString(36).substr(2, 20).toUpperCase(),
    balance: {
      public: Math.floor(Math.random() * 10000),
      private: Math.floor(Math.random() * 1000),
      total: 0,
      currency: 'OCT' as const
    },
    networkInfo: {
      id: 'testnet',
      name: 'Octra Testnet',
      rpcUrl: 'https://testnet.octra.network',
      color: '#f59e0b',
      isTestnet: true
    }
  };
}

/**
 * Create development logger
 */
export function createLogger(prefix: string, debug: boolean) {
  const isDevelopment = typeof window !== 'undefined' && (
    process.env.NODE_ENV === 'development' ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname.includes('dev') ||
    (window as any).__OCTRA_SDK_DEBUG__
  );

  // Only enable logging in development mode AND when debug is explicitly enabled
  const shouldLog = debug && isDevelopment;

  return {
    log: (...args: any[]) => {
      if (shouldLog) {
        console.log(`[${prefix}]`, ...args);
      }
    },
    warn: (...args: any[]) => {
      if (shouldLog) {
        console.warn(`[${prefix}]`, ...args);
      }
    },
    error: (...args: any[]) => {
      // Always show errors in development, even without debug flag
      if (isDevelopment) {
        console.error(`[${prefix}]`, ...args);
      }
    },
    debug: (...args: any[]) => {
      if (shouldLog) {
        console.debug(`[${prefix}]`, ...args);
      }
    },
    table: (data: any) => {
      if (shouldLog) {
        console.log(`[${prefix}] Table data:`);
        console.table(data);
      }
    },
    group: (label: string) => {
      if (shouldLog) {
        console.group(`[${prefix}] ${label}`);
      }
    },
    groupEnd: () => {
      if (shouldLog) {
        console.groupEnd();
      }
    }
  };
}