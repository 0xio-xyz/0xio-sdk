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
  readonly explorerAddressUrl?: string;
  readonly indexerUrl?: string;
  readonly supportsPrivacy: boolean;
  readonly color: string;
  readonly isTestnet: boolean;
}

// Transaction types
export interface TransactionData {
  readonly to: string;
  /**
   * Raw amount in micro-OCT (1 OCT = 1000000), passed to the wallet unchanged. This is what
   * the wallet and the RFC-O-1 provider expect. Prefer `amountOct` when you think in OCT.
   */
  readonly amount?: string | number;
  /** Amount in OCT. The SDK converts it to raw units exactly (at most 6 decimals). Use this or `amount`, not both. */
  readonly amountOct?: string | number;
  readonly message?: string;
  readonly feeLevel?: 1 | 3; // 1 = standard, 3 = priority
  readonly isPrivate?: boolean;
}

/**
 * Contract method arguments: flat array of AML-compatible values.
 * Supports primitives and base64-encoded binary data (e.g. FHE ciphers, proofs).
 * Use `[arg1, arg2]`, not `[[arg1, arg2]]`: flat, not nested.
 */
export type ContractParam = string | number | boolean;
export type ContractParams = ReadonlyArray<ContractParam>;

export interface ContractCallData {
  /** Contract address (oct-prefixed, 47 chars) */
  readonly contract: string;
  /** Contract method name (e.g. 'swap', 'open_private_account') */
  readonly method: string;
  /**
   * Method arguments: flat primitives, not array-wrapped.
   * For FHE/PVAC operations, encode binary data as base64 strings:
   * `[base64(pvacPubkey), base64(zeroCipher), base64(zeroProof)]`
   */
  readonly params: ContractParams;
  /**
   * Native value to attach, in raw micro-OCT (1 OCT = 1000000), passed to the wallet unchanged.
   * Omit or set '0' for calls that transfer nothing. Prefer `amountOct` when you think in OCT.
   */
  readonly amount?: string | number;
  /** Value to attach in OCT. The SDK converts it to raw units exactly. Use this or `amount`, not both. */
  readonly amountOct?: string | number;
  /**
   * Operation units / gas limit (default: 10000).
   * Higher values for complex contract operations.
   * The approval popup shows this as the fee, separate from `amount`.
   */
  readonly ou?: string | number;
}

export interface ContractDeployData {
  /** Contract bytecode as strict base64 (what octra_compileAml / octra_compileAssembly return). Max 512 KB decoded. */
  readonly bytecode: string;
  /** Constructor arguments: a JSON string or an array the SDK serializes. Max 64 KB. */
  readonly params?: string | ContractParams;
  /**
   * Fee in operation units, 1 to 50,000,000. Omit it and the wallet sets the live fee
   * (the node's recommendation for a deploy, never below the size-based minimum).
   */
  readonly ou?: string | number;
}

export interface ContractDeployResult {
  /** Hash of the deploy transaction. */
  readonly txHash: string;
  /** Address the node assigned to the contract, shown in the wallet's review. */
  readonly contractAddress: string;
}

export interface ContractViewCallData {
  /** Contract address (oct-prefixed, 47 chars) */
  readonly contract: string;
  /** Contract method name (e.g. 'balance_of', 'get_active_bin', 'is_paused') */
  readonly method: string;
  /** Method arguments: flat primitives, not array-wrapped */
  readonly params: ContractParams;
  /** Caller address for view context (defaults to connected wallet) */
  readonly caller?: string;
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

export type TransactionFinality = 'pending' | 'confirmed' | 'rejected' | 'dropped';

export interface TransactionResult {
  /** RFC-O-1 canonical hash field */
  readonly hash?: string;
  /** RFC-O-1 canonical accepted field */
  readonly accepted?: boolean;
  /** RFC-O-1 status field */
  readonly status?: TransactionFinality;
  /** @deprecated Use hash */
  readonly txHash?: string;
  /** @deprecated Use accepted */
  readonly success?: boolean;
  readonly finality?: TransactionFinality;
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
  /** Amount in raw micro-OCT as returned by the node (string or number depending on the wallet version). */
  readonly amount: string | number;
  /** Fee in OCT as returned by the node (may be string or number depending on extension version). */
  readonly fee: string | number;
  readonly timestamp: number;
  readonly status: 'pending' | 'confirmed' | 'failed' | 'dropped';
  readonly finality?: TransactionFinality;
  readonly message?: string;
  readonly blockHeight?: number;
}

// Connection types
export interface ConnectionInfo {
  isConnected: boolean;
  address?: string;
  publicKey?: string;
  /**
   * Whether the connected wallet can sign. `false` is a watch-only wallet: it connects and reads,
   * and every signing request is refused with `WATCH_ONLY`. `undefined` is unknown (an extension
   * older than 3.0.3 does not report it); a missing `publicKey` then hints at watch-only.
   * @since 2.10.0
   */
  canSign?: boolean;
  balance?: Balance;
  networkInfo?: NetworkInfo;
  connectedAt?: number;
  permissions?: Permission[];
}

export interface ConnectOptions {
  /** RFC-O-1 canonical field name */
  readonly permissions?: Permission[];
  /** @deprecated Use permissions */
  readonly requestPermissions?: Permission[];
  readonly networkId?: string;
}

export type Permission =
  // Wallet scope names (see WALLET_PERMISSIONS)
  | 'accounts'
  | 'public_transactions'
  | 'contract_views'
  | 'private_balance_read'
  | 'private_proofs'
  | 'private_claims'
  // Older SDK names, mapped to the scopes above at connect
  | 'read_address'
  | 'read_balance'
  | 'read_public_key'
  | 'send_transactions'
  | 'sign_messages'
  | 'contract_calls'
  | 'view_private_balance'
  | 'view_encrypted_balance'
  | 'private_transfers'
  | 'encrypt_balance'
  | 'decrypt_balance'
  | 'stealth_scan'
  | 'stealth_claim';

// Event types
export type WalletEventType =
  | 'connect'
  | 'disconnect'
  | 'accountChanged'
  | 'balanceChanged'
  | 'networkChanged'
  | 'transactionConfirmed'
  | 'transactionFailed'
  | 'permissionsChanged'
  | 'message'
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
  readonly publicKey: string | undefined;
  /** See `ConnectionInfo.canSign`. @since 2.10.0 */
  readonly canSign?: boolean;
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
  readonly publicKey?: string;
  /** Whether the new account can sign; see `ConnectionInfo.canSign`. @since 2.10.0 */
  readonly canSign?: boolean;
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
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
  // RPC error types from octra_submit and octra_submitBatch
  MALFORMED_TRANSACTION = 'MALFORMED_TRANSACTION',
  SELF_TRANSFER = 'SELF_TRANSFER',
  SENDER_NOT_FOUND = 'SENDER_NOT_FOUND',
  INVALID_SIGNATURE = 'INVALID_SIGNATURE',
  DUPLICATE_TRANSACTION = 'DUPLICATE_TRANSACTION',
  NONCE_TOO_FAR = 'NONCE_TOO_FAR',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  // Codes the 0xio wallet returns over the bridge
  NOT_CONNECTED = 'NOT_CONNECTED',
  INVALID_PARAMS = 'INVALID_PARAMS',
  METHOD_NOT_ALLOWED = 'METHOD_NOT_ALLOWED',
  NOT_AVAILABLE = 'NOT_AVAILABLE',
  PRIVATE_PROOF_FAILED = 'PRIVATE_PROOF_FAILED',
  PRIVATE_TRANSFER_FAILED = 'PRIVATE_TRANSFER_FAILED',
  CONTRACT_CALL_FAILED = 'CONTRACT_CALL_FAILED',
  SIGN_FAILED = 'SIGN_FAILED',
  RECIPIENT_NOT_REGISTERED = 'RECIPIENT_NOT_REGISTERED',
  DEPLOY_FAILED = 'DEPLOY_FAILED',
  DEPLOY_CHANGED = 'DEPLOY_CHANGED',
  /** The connected wallet is watch-only (no signing key). @since 2.10.0 */
  WATCH_ONLY = 'WATCH_ONLY',
  /** The wallet has no answer for this method (0xio Desktop: `get_pending_private_transfers`). */
  UNSUPPORTED_METHOD = 'UNSUPPORTED_METHOD',
  /** The site's network or wallet moved while the request waited for review. */
  NETWORK_CHANGED = 'NETWORK_CHANGED',
  /** A private method for a site that uses another wallet than the one open in 0xio Desktop. */
  WALLET_CHANGED = 'WALLET_CHANGED'
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
  /** Amount in OCT. Accepts string or number. Use string for amounts above 9 billion OCT to avoid JS number precision loss. */
  readonly amount: string | number;
  /** Exact amount in raw micro-OCT. When set, it is what the wallet uses; `amount` is then display only. */
  readonly amountRaw?: string;
  /** Not carried by the wallet today; private transfers have no memo on-chain. */
  readonly message?: string;
}

/**
 * A claimable stealth output as the wallet returns it. The 0xio extension fills `id` and
 * `amount` (raw micro-OCT) from the node; the other fields depend on the wallet.
 */
export interface PendingPrivateTransfer {
  readonly id: string;
  /** Raw micro-OCT, when the wallet exposes the amount. */
  readonly amount?: number | string;
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
  /**
   * Exact origins allowed as parent iframe bridge (e.g. 'https://app.example.com').
   * When set, only these origins (plus tauri://) are trusted: implicit localhost trust
   * is disabled. Leave unset for development (all localhost trusted by default).
   */
  readonly trustedParentOrigins?: string[];
  /**
   * Custom wallet transport adapter.
   * Defaults to ZeroXIOAdapter (0xio extension postMessage protocol).
   * Pass an adapter from src/supports/ to target a different wallet.
   *
   * @example
   * import { QubitzAdapter } from '@0xio/sdk/supports/qubitz';
   * new ZeroXIOWallet({ appName: 'My DApp', adapter: QubitzAdapter });
   */
  readonly adapter?: import('./adapter').WalletTransportAdapter;
  /**
   * Try 0xio Desktop directly (`ws://127.0.0.1:19345`) when no 0xio extension answers.
   * Default true. Never tried outside a browser, on a page that is not a secure context (plain
   * http works only on localhost), or with an adapter for another wallet.
   */
  readonly desktop?: boolean;
}

/** How the SDK reaches the wallet: the 0xio extension (or a parent bridge), or 0xio Desktop directly. */
export type WalletTransportKind = 'extension' | 'desktop';

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