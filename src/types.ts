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

export interface TransactionData {
  readonly to: string;
  /** Raw micro-OCT (1 OCT = 1000000), passed to the wallet unchanged. */
  readonly amount?: string | number;
  /** OCT, converted exactly (at most 6 decimals). Use this or `amount`, not both. */
  readonly amountOct?: string | number;
  readonly message?: string;
  /** 1 standard, 3 priority. */
  readonly feeLevel?: 1 | 3;
  readonly isPrivate?: boolean;
}

/** Flat, not nested: `[arg1, arg2]`, never `[[arg1, arg2]]`. Binary data as base64 strings. */
export type ContractParam = string | number | boolean;
export type ContractParams = ReadonlyArray<ContractParam>;

export interface ContractCallData {
  readonly contract: string;
  readonly method: string;
  /** Flat primitives, not array-wrapped; binary data as base64 strings. */
  readonly params: ContractParams;
  /** Raw micro-OCT to attach, passed unchanged; omit or '0' to attach nothing. */
  readonly amount?: string | number;
  /** OCT to attach, converted exactly. Use this or `amount`, not both. */
  readonly amountOct?: string | number;
  /** Operation units, default 10000; the review shows it as the fee. */
  readonly ou?: string | number;
}

export interface ContractDeployData {
  /** Strict base64, at most 512 KB decoded. */
  readonly bytecode: string;
  /** A JSON string or an array; at most 64 KB. */
  readonly params?: string | ContractParams;
  /** 1 to 50,000,000 OU; omit it and the wallet sets the live fee. */
  readonly ou?: string | number;
}

export interface ContractDeployResult {
  readonly txHash: string;
  readonly contractAddress: string;
}

export interface ContractViewCallData {
  readonly contract: string;
  readonly method: string;
  readonly params: ContractParams;
  /** Defaults to the connected wallet. */
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
  readonly hash?: string;
  readonly accepted?: boolean;
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
  /** Raw micro-OCT as the node returns it. */
  readonly amount: string | number;
  /** OCT as the node returns it. */
  readonly fee: string | number;
  readonly timestamp: number;
  readonly status: 'pending' | 'confirmed' | 'failed' | 'dropped';
  readonly finality?: TransactionFinality;
  readonly message?: string;
  readonly blockHeight?: number;
}

export interface ConnectionInfo {
  isConnected: boolean;
  address?: string;
  publicKey?: string;
  /**
   * `false` is a watch-only wallet, refused with `WATCH_ONLY` on every signing call. `undefined` is
   * unknown; a missing `publicKey` then hints at watch-only.
   * @since 2.10.0
   */
  canSign?: boolean;
  balance?: Balance;
  networkInfo?: NetworkInfo;
  connectedAt?: number;
  permissions?: Permission[];
}

export interface ConnectOptions {
  readonly permissions?: Permission[];
  /** @deprecated Use permissions */
  readonly requestPermissions?: Permission[];
  readonly networkId?: string;
}

export type Permission =
  | 'accounts'
  | 'public_transactions'
  | 'contract_views'
  | 'private_balance_read'
  | 'private_proofs'
  | 'private_claims'
  // Older names, mapped to the scopes above at connect
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
  | 'extensionUnlocked'
  /** A status change of a request this page sent. @since 2.12.0 */
  | 'requestUpdate'
  /** The browser's local network prompt is open during connect(). @since 2.12.0 */
  | 'connectProgress';

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
  MALFORMED_TRANSACTION = 'MALFORMED_TRANSACTION',
  SELF_TRANSFER = 'SELF_TRANSFER',
  SENDER_NOT_FOUND = 'SENDER_NOT_FOUND',
  INVALID_SIGNATURE = 'INVALID_SIGNATURE',
  DUPLICATE_TRANSACTION = 'DUPLICATE_TRANSACTION',
  NONCE_TOO_FAR = 'NONCE_TOO_FAR',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
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
  /** @since 2.10.0 */
  WATCH_ONLY = 'WATCH_ONLY',
  UNSUPPORTED_METHOD = 'UNSUPPORTED_METHOD',
  /** The site's network or wallet moved while the request waited for review. */
  NETWORK_CHANGED = 'NETWORK_CHANGED',
  /** The site uses another wallet than the one open in 0xio Desktop. */
  WALLET_CHANGED = 'WALLET_CHANGED',
  /** The wallet may still finish the request; never resend, ask `requestStatus`. @since 2.12.0 */
  STATUS_UNKNOWN = 'STATUS_UNKNOWN',
  /** The request id belongs to another request of this site. @since 2.12.0 */
  REQUEST_ID_REUSED = 'REQUEST_ID_REUSED',
  /** `wait: 'confirmed'` and the chain rejected or dropped the transaction. @since 2.12.0 */
  EXECUTION_FAILED = 'EXECUTION_FAILED',
  /** Another PVAC key is registered for this account; a key switch could strand its encrypted balance. @since 2.12.0 */
  PVAC_KEY_MISMATCH = 'PVAC_KEY_MISMATCH',
  /** This wallet's registration is submitted and not yet confirmed. @since 2.12.0 */
  REGISTRATION_PENDING = 'REGISTRATION_PENDING'
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

  /** Also in `details.requestId`. @since 2.12.0 */
  requestId?: string;
}

export interface PrivateBalanceInfo {
  readonly hasPrivateBalance: boolean;
  readonly encryptedAmount?: string;
  readonly canDecrypt: boolean;
}

export interface PrivateTransferData {
  readonly to: string;
  /** OCT; a string above 9 billion OCT avoids number precision loss. */
  readonly amount: string | number;
  /** Raw micro-OCT; when set, the wallet uses it and `amount` is display only. */
  readonly amountRaw?: string;
  /** Private transfers have no memo on chain; the wallet drops it. */
  readonly message?: string;
}

/** `status`, `view_pubkey` and `pvac` for an account that was already registered; a hash otherwise. */
export interface PrivateViewKeyRegistration {
  readonly status?: 'registered';
  readonly view_pubkey?: string;
  readonly pvac?: boolean;
  readonly hash?: string;
  readonly txHash?: string;
}

/** The 0xio extension fills `id` and `amount`; the other fields depend on the wallet. */
export interface PendingPrivateTransfer {
  readonly id: string;
  /** Raw micro-OCT. */
  readonly amount?: number | string;
  readonly from: string;
  readonly encryptedAmount: string;
  readonly message?: string;
  readonly timestamp: number;
  readonly canClaim: boolean;
}

export interface SDKConfig {
  readonly appName: string;
  readonly appDescription?: string;
  readonly appVersion?: string;
  readonly appUrl?: string;
  readonly appIcon?: string;
  readonly requiredPermissions?: Permission[];
  readonly networkId?: string;
  readonly debug?: boolean;
  /** Exact parent bridge origins; setting it turns off the implicit localhost trust. */
  readonly trustedParentOrigins?: string[];
  /**
   * Defaults to `ZeroXIOAdapter`.
   *
   * @example
   * import { QubitzAdapter } from '@0xio/sdk/supports/qubitz';
   * new ZeroXIOWallet({ appName: 'My DApp', adapter: QubitzAdapter });
   */
  readonly adapter?: import('./adapter').WalletTransportAdapter;
  /** Wait for a late wallet in ms. Default 300; 10 s stays in a frame or the 0xio app. @since 2.12.0 */
  readonly detectTimeoutMs?: number;
  /**
   * Try 0xio Desktop at `ws://127.0.0.1:19345` when no extension answers. Default true; never
   * outside a secure context (plain http only on localhost) or with another wallet's adapter.
   */
  readonly desktop?: boolean;
}

export type WalletTransportKind = 'extension' | 'desktop';

/** The 0xio app's browser speaks the extension channel but reports its own kind. */
export type WalletKind = 'extension' | 'desktop' | 'app-ios' | 'app-android' | 'app-expo';

export type WalletProtocolVersion = 1 | 2;

export interface WalletInfo {
  readonly kind: WalletKind;
  readonly version?: string;
  readonly protocol: WalletProtocolVersion;
  /** The SDK switches features on these, never on the version. */
  readonly capabilities: readonly string[];
}

export type RequestStatusValue =
  | 'pending'
  | 'review_open'
  | 'locked'
  | 'signing'
  | 'submitted'
  | 'confirmed'
  | 'completed'
  | 'failed'
  | 'rejected'
  | 'expired'
  | 'unknown';

export interface ContractReceiptEvent {
  readonly event: string;
  readonly values: unknown;
}

/** Octra's single call receipt carries no return value. */
export interface ContractReceipt {
  readonly contract: string;
  readonly method: string;
  readonly success: boolean;
  readonly effort?: number;
  readonly events: readonly ContractReceiptEvent[];
  readonly error?: unknown;
}

export interface RequestStatusError {
  readonly code: ErrorCode | string;
  readonly message: string;
  readonly stage: 'review' | 'submit' | 'execution';
}

export interface RequestStatus {
  readonly requestId: string;
  readonly status: RequestStatusValue;
  readonly method?: string;
  readonly network?: string;
  /** Only once the site is connected. */
  readonly address?: string;
  readonly hash?: string;
  readonly epoch?: number;
  readonly receipt?: ContractReceipt | null;
  readonly receiptUnavailable?: 'not_contract' | 'refused' | 'error';
  /** At most 4 KB. */
  readonly result?: unknown;
  readonly error?: RequestStatusError;
  /** False once the wallet stopped watching a `submitted` transaction. */
  readonly watching?: boolean;
  readonly seq: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface ReviewOptions {
  /** From `newRequestId()`, stored before the call so a reload can find the request. */
  readonly requestId?: string;
  /** Ends only the SDK's wait, never the review. A protocol 2 status change restarts it. */
  readonly timeoutMs?: number;
  readonly onStatus?: (status: RequestStatus) => void;
}

export interface WriteOptions extends ReviewOptions {
  /** Default `'submitted'`. */
  readonly wait?: 'submitted' | 'confirmed';
}

/** `requestStatus`, not `status`, so the wallet's own `status` field is left as sent. */
export interface WriteOutcome {
  readonly requestId: string;
  /** `completed` for a write that gives no hash. */
  readonly requestStatus: 'submitted' | 'confirmed' | 'completed';
  readonly epoch?: number;
  /** Null when the node gives none. */
  readonly receipt?: ContractReceipt | null;
  readonly receiptUnavailable?: 'not_contract' | 'refused' | 'error';
}

export interface WaitForRequestOptions {
  /** Default `'final'`. */
  readonly until?: 'submitted' | 'final';
  readonly timeoutMs?: number;
  readonly onStatus?: (status: RequestStatus) => void;
}

export interface PendingRequestInfo {
  readonly requestId: string;
  readonly method: string;
  readonly status: RequestStatusValue;
}

export type DesktopPresence = 'available' | 'unknown-until-connect' | 'not-running' | 'blocked' | 'not-allowed';

export interface DetectResult {
  readonly injected: { readonly kind: WalletKind; readonly version?: string; readonly protocol: WalletProtocolVersion } | null;
  readonly desktop: DesktopPresence;
  readonly mobile: boolean;
  /** Set on a phone with nothing injected. */
  readonly openInAppUrl: string | null;
  readonly next: 'connect' | 'install' | 'open-in-app';
}

export interface DetectOptions {
  /** Default 300. */
  readonly detectTimeoutMs?: number;
  /** False gives `desktop: 'not-allowed'`. */
  readonly desktop?: boolean;
}

export interface ConnectProgressEvent {
  readonly phase: 'local-network-prompt';
}

export interface ExtensionRequest {
  readonly id: string;
  readonly method: string;
  readonly params: any;
  readonly timestamp: number;
  /** Old wallets ignore it. @since 2.12.0 */
  readonly v?: 2;
  /** Review methods only. @since 2.12.0 */
  readonly rid?: string;
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