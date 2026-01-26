/**
 * 0xio Wallet SDK - Type Definitions
 * Comprehensive type system for 0xio wallet integration with Octra Network
 */

// Core wallet types
export interface WalletAddress {
  readonly address: string;
  readonly publicKey?: string;
}

export interface Balance {
  readonly public: number;
  readonly private?: number;
  readonly total: number;
  readonly currency: 'OCT';
}

export interface NetworkInfo {
  readonly id: string;
  readonly name: string;
  readonly rpcUrl: string;
  readonly explorerUrl?: string;
  readonly color: string;
  readonly isTestnet: boolean;
}

// Transaction types
export interface TransactionData {
  readonly to: string;
  readonly amount: number;
  readonly message?: string;
  readonly feeLevel?: 1 | 3; // 1 = standard, 3 = priority
  readonly isPrivate?: boolean;
}

export interface SignedTransaction {
  readonly from: string;
  readonly to_: string;
  readonly amount: string;
  readonly nonce: string;
  readonly ou: string;
  readonly timestamp: string;
  readonly message?: string;
  readonly signature: string;
  readonly public_key: string;
}

export interface TransactionResult {
  readonly txHash: string;
  readonly success: boolean;
  readonly message?: string;
  readonly explorerUrl?: string;
}

export interface TransactionHistory {
  readonly transactions: Transaction[];
  readonly totalCount: number;
  readonly page: number;
  readonly hasMore: boolean;
}

export interface Transaction {
  readonly hash: string;
  readonly from: string;
  readonly to: string;
  readonly amount: number;
  readonly fee: number;
  readonly timestamp: number;
  readonly status: 'pending' | 'confirmed' | 'failed';
  readonly message?: string;
  readonly blockHeight?: number;
}

// Connection types
export interface ConnectionInfo {
  isConnected: boolean;
  address?: string;
  balance?: Balance;
  networkInfo?: NetworkInfo;
  connectedAt?: number;
}

export interface ConnectOptions {
  readonly requestPermissions?: Permission[];
  readonly networkId?: string;
}

export type Permission =
  | 'read_address'
  | 'read_balance'
  | 'send_transactions'
  | 'sign_messages'
  | 'view_private_balance'
  | 'private_transfers';

// Event types
export type WalletEventType =
  | 'connect'
  | 'disconnect'
  | 'accountChanged'
  | 'balanceChanged'
  | 'networkChanged'
  | 'transactionConfirmed'
  | 'error'
  | 'extensionLocked'
  | 'extensionUnlocked';

export interface WalletEvent<T = any> {
  readonly type: WalletEventType;
  readonly data: T;
  readonly timestamp: number;
}

export interface ConnectEvent {
  readonly address: string;
  readonly balance: Balance;
  readonly networkInfo: NetworkInfo;
  readonly permissions: Permission[];
}

export interface DisconnectEvent {
  readonly reason: 'user_action' | 'extension_unavailable' | 'network_error' | 'extension_locked';
}

export interface AccountChangedEvent {
  readonly previousAddress?: string;
  readonly newAddress: string;
  readonly balance: Balance;
}

export interface BalanceChangedEvent {
  readonly address: string;
  readonly previousBalance: Balance | undefined;
  readonly newBalance: Balance;
}

export interface NetworkChangedEvent {
  readonly previousNetwork?: NetworkInfo;
  readonly newNetwork: NetworkInfo;
}

export interface TransactionConfirmedEvent {
  readonly transaction: Transaction;
}

export interface ErrorEvent {
  readonly code: ErrorCode;
  readonly message: string;
  readonly details?: any;
}

// Error types
export enum ErrorCode {
  EXTENSION_NOT_FOUND = 'EXTENSION_NOT_FOUND',
  CONNECTION_REFUSED = 'CONNECTION_REFUSED',
  USER_REJECTED = 'USER_REJECTED',
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  INVALID_ADDRESS = 'INVALID_ADDRESS',
  INVALID_AMOUNT = 'INVALID_AMOUNT',
  NETWORK_ERROR = 'NETWORK_ERROR',
  TRANSACTION_FAILED = 'TRANSACTION_FAILED',
  SIGNATURE_FAILED = 'SIGNATURE_FAILED',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  WALLET_LOCKED = 'WALLET_LOCKED',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

export class ZeroXIOWalletError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: any
  ) {
    super(message);
    this.name = 'ZeroXIOWalletError';
  }
}

// Private balance types
export interface PrivateBalanceInfo {
  readonly hasPrivateBalance: boolean;
  readonly encryptedAmount?: string;
  readonly canDecrypt: boolean;
}

export interface PrivateTransferData {
  readonly to: string;
  readonly amount: number;
  readonly message?: string;
}

export interface PendingPrivateTransfer {
  readonly id: string;
  readonly from: string;
  readonly encryptedAmount: string;
  readonly message?: string;
  readonly timestamp: number;
  readonly canClaim: boolean;
}

// SDK configuration
export interface SDKConfig {
  readonly appName: string;
  readonly appDescription?: string;
  readonly appVersion?: string;
  readonly appUrl?: string;
  readonly appIcon?: string;
  readonly requiredPermissions?: Permission[];
  readonly networkId?: string;
  readonly debug?: boolean;
}

// Extension communication types
export interface ExtensionRequest {
  readonly id: string;
  readonly method: string;
  readonly params: any;
  readonly timestamp: number;
}

export interface ExtensionResponse<T = any> {
  readonly id: string;
  readonly success: boolean;
  readonly data?: T;
  readonly error?: {
    code: ErrorCode;
    message: string;
    details?: any;
  };
  readonly timestamp: number;
}