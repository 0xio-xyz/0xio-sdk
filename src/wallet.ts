import { EventEmitter } from './events';
import { ExtensionCommunicator } from './communication';
import { DesktopFailure, DesktopTransport, canUseDesktopTransport, localNetworkPermission } from './desktop';
import { detectWallet } from './detect';
import {
  CONFIRM_WAIT_MS,
  FALLBACK_POLL,
  RequestMeta,
  RequestTracker,
  STATUS_POLL_MS,
  isFinalStatus,
  isLifecycleMethod,
  isRequestId,
  isRequestStatusValue,
  newRequestId,
  openInAppUrl,
  parseContractReceipt,
  parseRequestStatus,
  requestDigestInput,
  resultHash,
  resultHashes,
  statusRank,
  unknownRequestStatus,
} from './lifecycle';
import {
  Balance,
  ConnectionInfo,
  ConnectOptions,
  ContractCallData,
  ContractDeployData,
  ContractDeployResult,
  ContractViewCallData,
  NetworkInfo,
  SDKConfig,
  TransactionData,
  TransactionResult,
  TransactionHistory,
  PrivateBalanceInfo,
  PrivateTransferData,
  PendingPrivateTransfer,
  PrivateViewKeyRegistration,
  ErrorCode,
  ZeroXIOWalletError,
  ConnectEvent,
  DisconnectEvent,
  AccountChangedEvent,
  BalanceChangedEvent,
  NetworkChangedEvent,
  WalletTransportKind,
  WalletInfo,
  RequestStatus,
  ReviewOptions,
  WriteOptions,
  WriteOutcome,
  WaitForRequestOptions,
  PendingRequestInfo,
  DetectResult,
  ContractReceipt
} from './types';
import { getNetworkConfig, createDefaultBalance, validateBalance, validateNetworkInfo } from './config';
import { createLogger, isValidAddress, isValidAmount, deriveOctraAddress, octToMicro } from './utils';
import { toWalletPermissions, withLegacyAliases } from './permissions';
import { buildAuthMessage } from './signing';

const DEPLOY_MAX_CODE_BYTES = 512 * 1024;
const DEPLOY_MAX_OU = 50_000_000;

type Transport = Pick<ExtensionCommunicator, 'initialize' | 'isExtensionAvailable' | 'on' | 'cleanup'> & {
  sendRequest<T = any>(method: string, params?: any, timeout?: number, meta?: RequestMeta): Promise<T>;
} & Partial<{
  touchRequest(rid: string): void;
  walletHello(): Promise<WalletInfo>;
  queryRequestStatus(rid: string): Promise<unknown>;
  cancelRequestOnWallet(rid: string): Promise<unknown>;
}>;

type ConfirmFields = Pick<WriteOutcome, 'epoch' | 'receipt' | 'receiptUnavailable'>;

/** `rpc_call` answers that mean "never", not "not yet". */
const REFUSAL_CODES = new Set<string>([
  ErrorCode.METHOD_NOT_ALLOWED,
  ErrorCode.PERMISSION_DENIED,
  ErrorCode.UNSUPPORTED_METHOD,
  ErrorCode.NOT_AVAILABLE,
  ErrorCode.NOT_CONNECTED,
  ErrorCode.INVALID_PARAMS,
]);

function isRefusal(error: unknown): boolean {
  if (!(error instanceof ZeroXIOWalletError)) return false;
  if (REFUSAL_CODES.has(error.code)) return true;
  return error.code === ErrorCode.UNKNOWN_ERROR && /unknown method|unsupported|not supported|not allowed/i.test(error.message);
}

function primitiveDetails(details: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!details || typeof details !== 'object' || details instanceof Error) return out;
  for (const [k, v] of Object.entries(details)) {
    if (k === 'requestId' || k === 'status') continue;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
  }
  return out;
}

class Stopper {
  stopped = false;
  private timers = new Set<{ timer: ReturnType<typeof setTimeout>; done: (v: boolean) => void }>();

  wait(ms: number): Promise<boolean> {
    if (this.stopped) return Promise.resolve(false);
    return new Promise((resolve) => {
      const entry = {
        timer: setTimeout(() => {
          this.timers.delete(entry);
          resolve(!this.stopped);
        }, ms),
        done: resolve,
      };
      this.timers.add(entry);
    });
  }

  stop(): void {
    this.stopped = true;
    for (const t of this.timers) {
      clearTimeout(t.timer);
      t.done(false);
    }
    this.timers.clear();
  }
}

const DISCONNECT_REASONS = new Set<DisconnectEvent['reason']>([
  'user_action', 'extension_unavailable', 'network_error', 'extension_locked',
]);

const canSignOf = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;

/** Refusals that say what to change keep their code through the per-method wrapping. */
const KEPT_CODES = new Set<ErrorCode>([
  ErrorCode.WATCH_ONLY,
  ErrorCode.NOT_AVAILABLE,
  ErrorCode.UNSUPPORTED_METHOD,
  ErrorCode.NETWORK_CHANGED,
  ErrorCode.WALLET_CHANGED,
  ErrorCode.STATUS_UNKNOWN,
  ErrorCode.REQUEST_ID_REUSED,
  ErrorCode.EXECUTION_FAILED,
  ErrorCode.PVAC_KEY_MISMATCH,
  ErrorCode.REGISTRATION_PENDING,
]);

function rethrowWalletRefusal(error: unknown): void {
  if (error instanceof ZeroXIOWalletError && KEPT_CODES.has(error.code)) throw error;
}

function base64DecodedLength(value: string): number | null {
  if (!value || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  const pad = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return (value.length / 4) * 3 - pad;
}

export class ZeroXIOWallet extends EventEmitter {
  private communicator: Transport;
  private _transport: WalletTransportKind | null = null;
  private _desktopOnConnect = false;
  private _attachPromise: Promise<void> | null = null;
  private config: SDKConfig;
  private connectionInfo: ConnectionInfo = { isConnected: false };
  private isInitialized = false;
  private _initPromise: Promise<boolean> | null = null;
  private _sessionVersion = 0;
  private logger: ReturnType<typeof createLogger>;
  private _walletInfo: WalletInfo | null = null;
  private _requests: RequestTracker | undefined;

  constructor(config: SDKConfig) {
    super(config.debug);

    this.config = {
      ...config,
      appVersion: config.appVersion || '1.0.0',
      requiredPermissions: config.requiredPermissions || ['read_balance'],
      debug: config.debug || false
    };

    this.logger = createLogger('ZeroXIOWallet', this.config.debug || false);
    this.communicator = new ExtensionCommunicator(
      this.config.debug,
      this.config.trustedParentOrigins ?? [],
      this.config.adapter,
      { detectTimeoutMs: this.config.detectTimeoutMs }
    );

    this.logger.log('Wallet instance created with config:', this.config);
  }

  /**
   * @example
   * ```typescript
   * const wallet = new ZeroXIOWallet({
   *   appName: 'My DApp',
   *   requiredPermissions: ['accounts', 'public_transactions'],
   * });
   * try {
   *   await wallet.initialize();
   * } catch (error) {
   *   if (error instanceof ZeroXIOWalletError && error.code === ErrorCode.EXTENSION_NOT_FOUND) {
   *     console.log('No 0xio wallet');
   *   }
   * }
   * ```
   */
  async initialize(): Promise<boolean> {
    if (this.isInitialized) {
      return true;
    }

    if (this._initPromise) {
      return this._initPromise;
    }

    this._initPromise = (async () => {
      try {
        let communicationReady = await this.communicator.initialize();
        let transport: WalletTransportKind = 'extension';
        let desktopFailure: DesktopFailure = 'not-running';
        if (!communicationReady && this.desktopAllowed()) {
          const permission = await localNetworkPermission();
          if (permission === 'prompt') {
            // A socket now would show the browser's prompt to every visitor; connect() is a gesture
            this._desktopOnConnect = true;
            this.isInitialized = true;
            this.logger.log('No 0xio extension answered; 0xio Desktop will be tried on connect()');
            return true;
          }
          if (permission === 'denied') {
            desktopFailure = 'blocked';
          } else {
            const attached = await this.attachDesktop();
            if (attached === true) {
              transport = 'desktop';
              communicationReady = true;
            } else {
              desktopFailure = attached;
            }
          }
        }
        if (!communicationReady) {
          throw new ZeroXIOWalletError(
            ErrorCode.EXTENSION_NOT_FOUND,
            this.desktopAllowed()
              ? 'No 0xio wallet answered: install the 0xio extension or open 0xio Desktop'
              : 'Failed to establish communication with 0xio Wallet extension',
            { desktop: this.desktopAllowed() ? desktopFailure : 'not-allowed' }
          );
        }

        await this.registerWithTransport(transport);
        this.isInitialized = true;

        this.logger.log('SDK initialized successfully');

        return true;
      } catch (error) {
        this.logger.error('Failed to initialize:', error);

        if (error instanceof ZeroXIOWalletError) {
          throw error;
        }

        throw new ZeroXIOWalletError(
          ErrorCode.UNKNOWN_ERROR,
          'Failed to initialize SDK',
          error
        );
      } finally {
        this._initPromise = null;
      }
    })();

    return this._initPromise;
  }

  private async registerWithTransport(transport: WalletTransportKind): Promise<void> {
    await this.communicator.sendRequest('register_dapp', {
      appName: this.config.appName,
      appDescription: this.config.appDescription,
      appVersion: this.config.appVersion,
      appUrl: typeof window !== 'undefined' ? window.location.origin : undefined,
      appIcon: this.config.appIcon,
      requiredPermissions: toWalletPermissions(this.config.requiredPermissions),
      networkId: this.config.networkId
    });
    this.setupExtensionEventListeners();
    this._transport = transport;
    this._desktopOnConnect = false;
    this._walletInfo = this.communicator.walletHello ? await this.communicator.walletHello() : null;
  }

  private async attachDesktop(): Promise<true | DesktopFailure> {
    const desktop = new DesktopTransport({ debug: this.config.debug, networkId: this.config.networkId });
    desktop.on('connectProgress', (event) => this.emit('connectProgress', event.data));
    if (!(await desktop.initialize())) {
      const failure = desktop.lastFailure ?? 'not-running';
      desktop.cleanup();
      return failure;
    }
    this.communicator.cleanup();
    this.communicator = desktop;
    this.logger.log('No 0xio extension answered; using 0xio Desktop');
    return true;
  }

  private ensureTransportForConnect(): Promise<void> {
    if (this._transport || !this._desktopOnConnect) return Promise.resolve();
    if (!this._attachPromise) {
      this._attachPromise = (async () => {
        if (this.communicator.isExtensionAvailable() && await this.communicator.initialize()) {
          await this.registerWithTransport('extension');
          return;
        }
        const attached = await this.attachDesktop();
        if (attached !== true) {
          throw new ZeroXIOWalletError(
            ErrorCode.EXTENSION_NOT_FOUND,
            'No 0xio wallet answered: install the 0xio extension or open 0xio Desktop',
            { desktop: attached }
          );
        }
        await this.registerWithTransport('desktop');
      })().finally(() => {
        this._attachPromise = null;
      });
    }
    return this._attachPromise;
  }

  /** `'extension'` (or a parent bridge) or `'desktop'`; null before initialize and while `desktopAvailableOnConnect`. */
  get transport(): WalletTransportKind | null {
    return this._transport;
  }

  /** True while 0xio Desktop waits for connect(), because the browser would prompt first. */
  get desktopAvailableOnConnect(): boolean {
    return this._desktopOnConnect && !this._transport;
  }

  private desktopAllowed(): boolean {
    if (this.config.desktop === false) return false;
    if (this.config.adapter && this.config.adapter.name !== '0xio') return false;
    return canUseDesktopTransport();
  }

  isReady(): boolean {
    return this.isInitialized && this.communicator.isExtensionAvailable();
  }

  /**
   * The wallet behind the transport: kind, version, protocol and capabilities. Null until a
   * transport is chosen.
   * @since 2.12.0
   */
  get walletInfo(): WalletInfo | null {
    return this._walletInfo ?? null;
  }

  /**
   * The injected wallet, 0xio Desktop's presence and the next step, before any click and without
   * `initialize()`. Never shows a browser prompt.
   * @since 2.12.0
   * @example
   * ```typescript
   * const found = await wallet.detect();
   * if (found.next === 'open-in-app' && found.openInAppUrl) {
   *   console.log(found.openInAppUrl);
   * } else if (found.next === 'install') {
   *   console.log('No 0xio wallet');
   * }
   * ```
   */
  detect(): Promise<DetectResult> {
    return detectWallet({ detectTimeoutMs: this.config.detectTimeoutMs, desktop: this.desktopAllowed() });
  }

  /**
   * A request id to store before a call.
   * @since 2.12.0
   * @example
   * ```typescript
   * const requestId = wallet.newRequestId();
   * localStorage.setItem('send:mainnet:oct1...', requestId);
   * await wallet.sendTransaction({ to: 'oct1...', amountOct: '1' }, { requestId });
   * ```
   */
  newRequestId(): string {
    return newRequestId();
  }

  /**
   * A link that opens `url` (default: this page) in the 0xio app; `{ scheme: true }` gives the
   * `oxio://` form. Null for anything but https.
   * @since 2.12.0
   */
  openInAppUrl(url?: string, options?: { scheme?: boolean }): string | null {
    return openInAppUrl(url, options);
  }

  /**
   * Where a request stands. Protocol 1 wallets keep no record, so the SDK answers from this page's
   * own, which a reload loses.
   * @since 2.12.0
   * @example
   * ```typescript
   * const stored = localStorage.getItem('send:mainnet:oct1...');
   * if (stored) {
   *   const status = await wallet.requestStatus(stored);
   *   if (status.status === 'submitted') await wallet.waitForRequest(stored);
   * }
   * ```
   */
  async requestStatus(requestId: string): Promise<RequestStatus> {
    this.ensureInitialized();
    this.assertRequestId(requestId);
    if (this.speaks('request_status') && this.communicator.queryRequestStatus) {
      try {
        const answer = parseRequestStatus(await this.communicator.queryRequestStatus(requestId));
        if (answer && answer.requestId === requestId) {
          if (answer.status !== 'unknown') this.tracker.wallet(answer, true);
          return this.tracker.snapshot(requestId) ?? answer;
        }
      } catch (error) {
        this.logger.warn('request_status failed, answering from the SDK record:', error);
      }
    }
    return this.tracker.snapshot(requestId) ?? unknownRequestStatus(requestId);
  }

  /**
   * Resolves with the status once the request is final (or on chain with `until: 'submitted'`),
   * whatever the outcome.
   * @throws ZeroXIOWalletError with code STATUS_UNKNOWN when `timeoutMs` (default 10 minutes) runs out
   * @since 2.12.0
   * @example
   * ```typescript
   * const requestId = wallet.newRequestId();
   * try {
   *   await wallet.sendTransaction({ to: 'oct1...', amountOct: '1' }, { requestId });
   * } catch (error) {
   *   if (
   *     error instanceof ZeroXIOWalletError &&
   *     (error.code === ErrorCode.STATUS_UNKNOWN || error.code === ErrorCode.NETWORK_ERROR)
   *   ) {
   *     const final = await wallet.waitForRequest(requestId, { onStatus: (s) => console.log(s.status) });
   *     console.log(final.status, final.hash);
   *   }
   * }
   * ```
   */
  async waitForRequest(requestId: string, options: WaitForRequestOptions = {}): Promise<RequestStatus> {
    const current = await this.requestStatus(requestId);
    const until = options.until ?? 'final';
    const done = (s: RequestStatus) =>
      s.status === 'unknown' ||
      isFinalStatus(s.status) ||
      (until === 'submitted' && statusRank(s.status) >= statusRank('submitted'));
    if (done(current)) return current;
    const hashes = current.hash ? [current.hash] : [];
    return this.follow(requestId, current.method ?? '', hashes, done, options.timeoutMs ?? CONFIRM_WAIT_MS, options.onStatus);
  }

  /** Closes a review that was not approved yet; an approved request is unchanged. @since 2.12.0 */
  async cancelRequest(requestId: string): Promise<RequestStatus> {
    this.ensureInitialized();
    this.assertRequestId(requestId);
    if (!this.communicator.cancelRequestOnWallet) {
      throw new ZeroXIOWalletError(ErrorCode.UNSUPPORTED_METHOD, 'This wallet cannot cancel a request from the site');
    }
    const answer = parseRequestStatus(await this.communicator.cancelRequestOnWallet(requestId));
    if (answer && answer.requestId === requestId) this.tracker.wallet(answer);
    return this.tracker.snapshot(requestId) ?? answer ?? unknownRequestStatus(requestId);
  }

  /** The review of this page that blocks a new one and `switchNetwork`. @since 2.12.0 */
  pendingRequest(): PendingRequestInfo | null {
    const rec = this._requests?.inReview();
    if (!rec) return null;
    return { requestId: rec.status.requestId, method: rec.status.method ?? '', status: rec.status.status };
  }

  /**
   * @example
   * ```typescript
   * const { address, networkInfo, canSign } = await wallet.connect();
   * console.log(address, networkInfo.id, canSign);
   * ```
   */
  async connect(options: ConnectOptions & ReviewOptions = {}): Promise<ConnectEvent> {
    this.ensureInitialized();
    await this.ensureTransportForConnect();

    try {
      this.logger.log('Attempting to connect with options:', options);

      const declaredPermissions = this.config.requiredPermissions || [];
      const requestedPerms = options.permissions ?? options.requestPermissions;
      const requestedPermissions = requestedPerms
        ? requestedPerms.filter(p => declaredPermissions.includes(p))
        : declaredPermissions;

      const { data: result } = await this.review<any>('connect', {
        permissions: toWalletPermissions(requestedPermissions),
        networkId: options.networkId || this.config.networkId
      }, options);

      if (result.publicKey && result.address) {
        try {
          const derived = await deriveOctraAddress(result.publicKey);
          if (derived !== result.address) {
            throw new ZeroXIOWalletError(
              ErrorCode.UNKNOWN_ERROR,
              'Address-key binding verification failed: the reported public key does not derive to the reported address'
            );
          }
        } catch (e) {
          if (e instanceof ZeroXIOWalletError) throw e;
          this.logger.warn('Address derivation check skipped (crypto unavailable):', e);
        }
      }

      const networkInfo = validateNetworkInfo(result.networkInfo)
        ?? (result.networkId ? getNetworkConfig(result.networkId) : null);

      if (!networkInfo) {
        throw new ZeroXIOWalletError(
          ErrorCode.NETWORK_ERROR,
          'Wallet did not return valid network metadata.'
        );
      }
      const permissions = withLegacyAliases(result.permissions, requestedPermissions);

      const canSign = canSignOf(result.canSign);

      this.connectionInfo = {
        isConnected: true,
        address: result.address,
        publicKey: result.publicKey,
        canSign,
        balance: result.balance,
        networkInfo,
        connectedAt: Date.now(),
        permissions
      };

      const connectEvent: ConnectEvent = {
        address: result.address,
        publicKey: result.publicKey,
        canSign,
        balance: result.balance,
        networkInfo,
        permissions
      };

      this.emit('connect', connectEvent);

      this.logger.log('Connected successfully:', { address: connectEvent.address, network: networkInfo.id });

      return connectEvent;
    } catch (error) {
      this.logger.error('Connection failed:', error);

      if (error instanceof ZeroXIOWalletError) {
        throw error;
      }

      throw new ZeroXIOWalletError(
        ErrorCode.CONNECTION_REFUSED,
        'Failed to connect to wallet',
        error
      );
    }
  }

  async disconnect(): Promise<void> {
    this.ensureInitialized();

    try {
      await this.communicator.sendRequest('disconnect');

      ++this._sessionVersion;
      this.connectionInfo = { isConnected: false };

      const disconnectEvent: DisconnectEvent = {
        reason: 'user_action'
      };

      this.emit('disconnect', disconnectEvent);

      this.logger.log('Disconnected from wallet');
    } catch (error) {
      this.logger.error('Disconnect failed:', error);
      throw error;
    }
  }

  isConnected(): boolean {
    return this.connectionInfo.isConnected;
  }

  getConnectionInfo(): ConnectionInfo {
    return { ...this.connectionInfo };
  }

  async getConnectionStatus(): Promise<ConnectionInfo> {
    this.ensureInitialized();

    try {
      const sv = this._sessionVersion;
      const result = await this.communicator.sendRequest('getConnectionStatus');

      if (this._sessionVersion !== sv) return { ...this.connectionInfo };

      if (result.isConnected && result.address) {
        if (result.publicKey) {
          try {
            const derived = await deriveOctraAddress(result.publicKey);
            if (derived !== result.address) {
              this.logger.warn('Address-key binding mismatch on session restore, ignoring stale session');
              this.connectionInfo = { isConnected: false };
              return { ...this.connectionInfo };
            }
          } catch (e) {
            this.logger.warn('Address derivation check skipped (crypto unavailable):', e);
          }
        }

        const balanceInfo = validateBalance(result.balance) ?? createDefaultBalance();
        const networkInfo = validateNetworkInfo(result.networkInfo)
          ?? (result.networkId ? getNetworkConfig(result.networkId) : null);

        if (!networkInfo) {
          this.logger.warn('getConnectionStatus: wallet returned no network metadata, returning cached state');
          return this.connectionInfo;
        }

        const wasConnected = this.connectionInfo.isConnected;
        const permissions = withLegacyAliases(result.permissions, this.config.requiredPermissions);

        const connectedAt = this.connectionInfo.connectedAt || result.connectedAt || Date.now();

        const canSign = canSignOf(result.canSign);

        this.connectionInfo = {
          isConnected: true,
          address: result.address,
          publicKey: result.publicKey,
          canSign,
          balance: balanceInfo,
          networkInfo,
          connectedAt,
          permissions
        };

        this.logger.log('Discovered existing connection:', { address: result.address, network: networkInfo.id });

        if (!wasConnected) {
          const connectEvent: ConnectEvent = {
            address: result.address,
            publicKey: result.publicKey,
            canSign,
            balance: balanceInfo,
            networkInfo,
            permissions
          };

          this.emit('connect', connectEvent);
        }
      } else {
        this.connectionInfo = { isConnected: false };
      }

      return { ...this.connectionInfo };
    } catch (error) {
      this.logger.error('Failed to get connection status:', error);

      this.connectionInfo = { isConnected: false };
      return { ...this.connectionInfo };
    }
  }

  /**
   * The wallet asks the user first; refused while another review of this page waits.
   * @throws ZeroXIOWalletError with code USER_REJECTED when the user declines
   * @example
   * ```typescript
   * const { switched } = await wallet.switchNetwork('devnet');
   * if (switched) console.log(wallet.getNetworkId());
   * ```
   */
  async switchNetwork(networkId: string, options?: ReviewOptions): Promise<{ network: string; switched: boolean }> {
    this.ensureConnected();

    try {
      const sv = this._sessionVersion;
      const { data: result } = await this.review<any>('switch_network', { networkId }, options);
      this.logger.log(`Network switch result:`, result);

      if (this._sessionVersion !== sv) return { network: result.network || networkId, switched: result.switched ?? false };

      if (result.switched) {
        const networkInfo = getNetworkConfig(networkId);
        if (this.connectionInfo.isConnected) {
          this.connectionInfo.networkInfo = networkInfo;
        }
      }

      return { network: result.network || networkId, switched: result.switched ?? false };
    } catch (error) {
      this.logger.error('Failed to switch network:', error);
      throw error;
    }
  }

  getNetworkId(): string | null {
    return this.connectionInfo.networkInfo?.id || null;
  }

  /**
   * @example
   * ```typescript
   * await wallet.connect();
   * const address = wallet.getAddress();
   * ```
   */
  getAddress(): string | null {
    return this.connectionInfo.address || null;
  }

  /**
   * `false` is a watch-only wallet; `undefined` when not connected or not reported, and a missing
   * public key then hints at watch-only.
   * @since 2.10.0
   * @example
   * ```typescript
   * const canSign = wallet.canSign() ?? !!wallet.getConnectionInfo().publicKey;
   * if (!canSign) console.log('Watch-only');
   * ```
   */
  canSign(): boolean | undefined {
    return this.connectionInfo.isConnected ? this.connectionInfo.canSign : undefined;
  }

  /** Base64 Ed25519 key of the connected account. */
  async getPublicKey(): Promise<string> {
    this.ensureConnected();
    if (this.connectionInfo.publicKey) return this.connectionInfo.publicKey;
    const result = await this.communicator.sendRequest('getPublicKey');
    const publicKey = result?.publicKey;
    if (typeof publicKey !== 'string' || !publicKey) {
      throw new ZeroXIOWalletError(ErrorCode.UNKNOWN_ERROR, 'Wallet did not return a public key');
    }
    this.connectionInfo.publicKey = publicKey;
    return publicKey;
  }

  /**
   * In OCT, for display.
   * @example
   * ```typescript
   * const balance = await wallet.getBalance(true);
   * console.log(balance.public, balance.currency);
   * ```
   */
  async getBalance(forceRefresh = false): Promise<Balance> {
    this.ensureConnected();

    try {
      const address = this.getAddress();
      if (!address) {
        throw new ZeroXIOWalletError(ErrorCode.INVALID_ADDRESS, 'No address found');
      }

      let publicBalance = 0;
      let privateBalance = 0;

      const sv = this._sessionVersion;
      const extResult = await this.communicator.sendRequest('getBalance', { forceRefresh });
      publicBalance = parseFloat(extResult.balance || '0');
      privateBalance = parseFloat(extResult.privateBalance || '0');

      this.logger.log('Balance fetched from extension:', { public: publicBalance });

      const result: Balance = {
        public: publicBalance,
        private: privateBalance,
        total: publicBalance + privateBalance,
        currency: 'OCT'
      };

      if (this._sessionVersion !== sv) return result;

      if (this.connectionInfo.balance) {
        const previousBalance = this.connectionInfo.balance;
        this.connectionInfo.balance = result;

        if (previousBalance.total !== result.total ||
            previousBalance.public !== result.public ||
            previousBalance.private !== result.private) {
          const balanceChangedEvent: BalanceChangedEvent = {
            address: this.connectionInfo.address!,
            previousBalance,
            newBalance: result
          };

          this.emit('balanceChanged', balanceChangedEvent);
        }
      } else {
        this.connectionInfo.balance = result;
      }

      return result;
    } catch (error) {
      if (error instanceof ZeroXIOWalletError) throw error;
      throw new ZeroXIOWalletError(
        ErrorCode.NETWORK_ERROR,
        'Failed to get balance',
        error
      );
    }
  }

  async getNetworkInfo(): Promise<NetworkInfo> {
    this.ensureInitialized();

    try {
      const sv = this._sessionVersion;
      const result = await this.communicator.sendRequest('get_network_info');

      const networkInfo = validateNetworkInfo(result);
      if (!networkInfo) {
        throw new ZeroXIOWalletError(ErrorCode.NETWORK_ERROR, 'Extension returned invalid network info');
      }

      if (this._sessionVersion !== sv) return networkInfo;

      if (this.connectionInfo.networkInfo) {
        const previousNetwork = this.connectionInfo.networkInfo;
        this.connectionInfo.networkInfo = networkInfo;

        if (previousNetwork.id !== networkInfo.id) {
          const networkChangedEvent: NetworkChangedEvent = {
            previousNetwork,
            newNetwork: networkInfo
          };

          this.emit('networkChanged', networkChangedEvent);
        }
      } else {
        this.connectionInfo.networkInfo = networkInfo;
      }

      return networkInfo;
    } catch (error) {
      if (error instanceof ZeroXIOWalletError) throw error;
      throw new ZeroXIOWalletError(
        ErrorCode.NETWORK_ERROR,
        'Failed to get network info',
        error
      );
    }
  }

  /**
   * @example
   * ```typescript
   * const requestId = wallet.newRequestId();
   * const result = await wallet.sendTransaction(
   *   { to: 'oct1...', amountOct: '1.5' },
   *   { requestId, wait: 'confirmed', onStatus: (s) => console.log(s.status) }
   * );
   * console.log(result.hash, result.requestStatus);
   * ```
   */
  async sendTransaction(txData: TransactionData, options?: WriteOptions): Promise<TransactionResult & WriteOutcome> {
    this.ensureConnected();

    if (!isValidAddress(txData.to)) {
      throw new ZeroXIOWalletError(ErrorCode.INVALID_ADDRESS, 'Invalid recipient address');
    }
    const amount = this.resolveRawAmount(txData.amount, txData.amountOct, 'Transaction amount');
    if (txData.message && txData.message.length > 1000) {
      throw new ZeroXIOWalletError(ErrorCode.TRANSACTION_FAILED, 'Transaction message too long (max 1,000 characters)');
    }

    try {
      this.logger.log('Sending transaction:', { to: txData.to });

      const { data, outcome } = await this.write<any>('send_transaction', { ...txData, amount }, options);
      const result = this.withOutcome(data, outcome);

      this.logger.log('Transaction result:', result);

      if (result.accepted ?? result.success) {
        setTimeout(() => {
          this.getBalance(true).catch(error => {
            this.logger.warn('Failed to refresh balance after transaction:', error);
          });
        }, 1000);
      }

      return result;
    } catch (error) {
      this.logger.error('Transaction failed:', error);

      if (error instanceof ZeroXIOWalletError) {
        throw error;
      }

      throw new ZeroXIOWalletError(
        ErrorCode.TRANSACTION_FAILED,
        'Failed to send transaction',
        error
      );
    }
  }

  /** Signs without broadcasting; submit the result with submitTransaction(). */
  async signTransaction(txData: TransactionData, options?: ReviewOptions): Promise<{ signedTx: any }> {
    this.ensureConnected();

    if (!isValidAddress(txData.to)) {
      throw new ZeroXIOWalletError(ErrorCode.INVALID_ADDRESS, 'Invalid recipient address');
    }
    const amount = this.resolveRawAmount(txData.amount, txData.amountOct, 'Transaction amount');
    if (txData.message && txData.message.length > 1000) {
      throw new ZeroXIOWalletError(ErrorCode.TRANSACTION_FAILED, 'Transaction message too long (max 1,000 characters)');
    }

    try {
      this.logger.log('Requesting transaction signature:', { to: txData.to });
      const { data: result } = await this.review<any>('sign_transaction', { ...txData, amount }, options);
      return result;
    } catch (error) {
      if (error instanceof ZeroXIOWalletError) throw error;
      throw new ZeroXIOWalletError(ErrorCode.SIGNATURE_FAILED, 'Failed to sign transaction', error);
    }
  }

  /** Broadcasts a transaction from signTransaction(). */
  async submitTransaction(signedTx: any, options?: WriteOptions): Promise<TransactionResult & WriteOutcome> {
    this.ensureConnected();

    if (!signedTx || typeof signedTx !== 'object') {
      throw new ZeroXIOWalletError(ErrorCode.TRANSACTION_FAILED, 'signedTx must be an object');
    }

    try {
      this.logger.log('Submitting pre-signed transaction');
      const { data, outcome } = await this.write<any>('broadcast_only', { signedTx }, options);
      return this.withOutcome(data, outcome);
    } catch (error) {
      if (error instanceof ZeroXIOWalletError) throw error;
      throw new ZeroXIOWalletError(ErrorCode.TRANSACTION_FAILED, 'Failed to submit transaction', error);
    }
  }

  /**
   * A state changing contract call, reviewed and signed in the wallet.
   * @example
   * ```typescript
   * const result = await wallet.callContract(
   *   { contract: 'oct1...', method: 'deposit', params: [], amountOct: '10' },
   *   { requestId: wallet.newRequestId(), wait: 'confirmed' }
   * );
   * console.log(result.receipt?.events);
   * ```
   */
  async callContract(callData: ContractCallData, options?: WriteOptions): Promise<TransactionResult & WriteOutcome> {
    this.ensureConnected();

    if (!isValidAddress(callData.contract)) {
      throw new ZeroXIOWalletError(ErrorCode.INVALID_ADDRESS, 'Invalid contract address');
    }
    if (!callData.method || typeof callData.method !== 'string') {
      throw new ZeroXIOWalletError(ErrorCode.TRANSACTION_FAILED, 'Contract method is required');
    }
    if (callData.method.length > 200) {
      throw new ZeroXIOWalletError(ErrorCode.TRANSACTION_FAILED, 'Contract method name too long (max 200 characters)');
    }
    if (callData.amount != null && callData.amountOct != null) {
      throw new ZeroXIOWalletError(ErrorCode.INVALID_AMOUNT, 'Contract call amount: pass amount or amountOct, not both');
    }
    if (callData.amount != null) {
      this.assertExactOCTAmount(callData.amount, 'Contract call amount');
    }
    if (callData.amountOct != null) {
      this.assertExactOCTAmount(callData.amountOct, 'Contract call amount');
    }
    try {
      if (JSON.stringify(callData.params).length > 65536) {
        throw new ZeroXIOWalletError(ErrorCode.TRANSACTION_FAILED, 'Contract params too large (max 64 KB)');
      }
    } catch (e) {
      if (e instanceof ZeroXIOWalletError) throw e;
      throw new ZeroXIOWalletError(ErrorCode.TRANSACTION_FAILED, 'Contract params are not serialisable');
    }

    try {
      this.logger.log('Calling contract:', { contract: callData.contract, method: callData.method });

      const { data, outcome } = await this.write<any>('call_contract', {
        contract: callData.contract,
        method: callData.method,
        params: callData.params,
        amount:
          callData.amountOct != null
            ? octToMicro(callData.amountOct)
            : callData.amount != null
              ? String(callData.amount)
              : '0',
        ou: callData.ou != null ? String(callData.ou) : '10000',
      }, options);
      const result = this.withOutcome(data, outcome);

      this.logger.log('Contract call result:', result);
      return result;
    } catch (error) {
      this.logger.error('Contract call failed:', error);

      if (error instanceof ZeroXIOWalletError) {
        throw error;
      }

      throw new ZeroXIOWalletError(
        ErrorCode.TRANSACTION_FAILED,
        'Failed to call contract',
        error
      );
    }
  }

  /** The review shows the code size, the contract address from the node, the params and the fee. */
  async deployContract(deployData: ContractDeployData, options?: WriteOptions): Promise<ContractDeployResult & WriteOutcome> {
    this.ensureConnected();

    const bytecode = deployData?.bytecode;
    const codeBytes = typeof bytecode === 'string' ? base64DecodedLength(bytecode) : null;
    if (!codeBytes) {
      throw new ZeroXIOWalletError(ErrorCode.INVALID_PARAMS, 'Contract bytecode must be non-empty base64');
    }
    if (codeBytes > DEPLOY_MAX_CODE_BYTES) {
      throw new ZeroXIOWalletError(ErrorCode.INVALID_PARAMS, 'Contract bytecode too large (max 512 KB)');
    }

    let params: string | undefined;
    if (deployData.params != null) {
      if (typeof deployData.params === 'string') {
        params = deployData.params;
      } else if (Array.isArray(deployData.params)) {
        try {
          params = JSON.stringify(deployData.params);
        } catch {
          throw new ZeroXIOWalletError(ErrorCode.INVALID_PARAMS, 'Constructor params are not serialisable');
        }
      } else {
        throw new ZeroXIOWalletError(ErrorCode.INVALID_PARAMS, 'Constructor params must be a JSON string or an array');
      }
      if (params.length > 65536) {
        throw new ZeroXIOWalletError(ErrorCode.INVALID_PARAMS, 'Constructor params too large (max 64 KB)');
      }
    }

    let ou: string | undefined;
    if (deployData.ou != null && deployData.ou !== '') {
      ou = String(deployData.ou).trim();
      if (!/^\d{1,8}$/.test(ou) || Number(ou) < 1 || Number(ou) > DEPLOY_MAX_OU) {
        throw new ZeroXIOWalletError(ErrorCode.INVALID_PARAMS, 'Deploy fee must be 1 to 50,000,000 OU');
      }
    }

    try {
      this.logger.log('Deploying contract:', { codeBytes });
      const payload: Record<string, unknown> = { bytecode };
      if (params) payload.params = params;
      if (ou) payload.ou = ou;
      const { data: result, outcome } = await this.write<any>('deploy_contract', payload, options);
      return this.withOutcome({
        txHash: result?.txHash ?? result?.hash,
        contractAddress: result?.contractAddress,
      }, outcome);
    } catch (error) {
      this.logger.error('Contract deploy failed:', error);
      if (error instanceof ZeroXIOWalletError) throw error;
      throw new ZeroXIOWalletError(ErrorCode.TRANSACTION_FAILED, 'Failed to deploy contract', error);
    }
  }

  /**
   * Read only; no review.
   * @example
   * ```typescript
   * const supply = await wallet.contractCallView({
   *   contract: 'oct1...',
   *   method: 'total_supply',
   *   params: [],
   * });
   * ```
   */
  async contractCallView(viewData: ContractViewCallData): Promise<any> {
    this.ensureInitialized();

    if (!isValidAddress(viewData.contract)) {
      throw new ZeroXIOWalletError(ErrorCode.INVALID_ADDRESS, 'Invalid contract address');
    }
    if (!viewData.method || typeof viewData.method !== 'string') {
      throw new ZeroXIOWalletError(ErrorCode.NETWORK_ERROR, 'Contract method is required');
    }
    if (viewData.method.length > 200) {
      throw new ZeroXIOWalletError(ErrorCode.NETWORK_ERROR, 'Contract method name too long (max 200 characters)');
    }
    try {
      if (JSON.stringify(viewData.params).length > 65536) {
        throw new ZeroXIOWalletError(ErrorCode.NETWORK_ERROR, 'Contract params too large (max 64 KB)');
      }
    } catch (e) {
      if (e instanceof ZeroXIOWalletError) throw e;
      throw new ZeroXIOWalletError(ErrorCode.NETWORK_ERROR, 'Contract params are not serialisable');
    }

    try {
      this.logger.log('Contract view call:', { contract: viewData.contract, method: viewData.method });

      const result = await this.communicator.sendRequest('contract_call_view', {
        contract: viewData.contract,
        method: viewData.method,
        params: viewData.params,
        ...(viewData.caller != null ? { caller: viewData.caller } : {}),
      });

      this.logger.log('Contract view result:', result);
      return result;
    } catch (error) {
      this.logger.error('Contract view call failed:', error);

      if (error instanceof ZeroXIOWalletError) {
        throw error;
      }

      throw new ZeroXIOWalletError(
        ErrorCode.NETWORK_ERROR,
        'Failed to call contract view',
        error
      );
    }
  }

  async getContractStorage(contract: string, key: string): Promise<string | null> {
    this.ensureInitialized();

    if (!isValidAddress(contract)) {
      throw new ZeroXIOWalletError(ErrorCode.INVALID_ADDRESS, 'Invalid contract address');
    }
    if (!key || typeof key !== 'string') {
      throw new ZeroXIOWalletError(ErrorCode.NETWORK_ERROR, 'Storage key is required');
    }
    if (key.length > 200) {
      throw new ZeroXIOWalletError(ErrorCode.NETWORK_ERROR, 'Storage key too long (max 200 characters)');
    }

    try {
      this.logger.log('Getting contract storage:', { contract, key });

      const result = await this.communicator.sendRequest('get_contract_storage', {
        contract,
        key,
      });

      return result;
    } catch (error) {
      this.logger.error('Get contract storage failed:', error);

      if (error instanceof ZeroXIOWalletError) {
        throw error;
      }

      throw new ZeroXIOWalletError(
        ErrorCode.NETWORK_ERROR,
        'Failed to get contract storage',
        error
      );
    }
  }

  async getTransactionHistory(page = 1, limit = 20): Promise<TransactionHistory> {
    this.ensureConnected();

    try {
      const result = await this.communicator.sendRequest('get_transaction_history', {
        page,
        limit
      });

      return result;
    } catch (error) {
      throw new ZeroXIOWalletError(
        ErrorCode.NETWORK_ERROR,
        'Failed to get transaction history',
        error
      );
    }
  }

  async getPrivateBalanceInfo(): Promise<PrivateBalanceInfo> {
    this.ensureConnected();

    try {
      const result = await this.communicator.sendRequest('get_private_balance_info');
      return result;
    } catch (error) {
      rethrowWalletRefusal(error);
      throw new ZeroXIOWalletError(
        ErrorCode.PERMISSION_DENIED,
        'Failed to get private balance info',
        error
      );
    }
  }

  /** @deprecated The 0xio extension answers NOT_AVAILABLE; users encrypt from its Privacy screen. */
  async encryptBalance(amount: string | number, options?: WriteOptions): Promise<TransactionResult & WriteOutcome> {
    this.ensureConnected();
    this.assertExactOCTAmount(amount, 'Encrypt amount');

    if (!isValidAmount(amount)) {
      throw new ZeroXIOWalletError(ErrorCode.TRANSACTION_FAILED, 'Invalid amount');
    }

    try {
      const { data, outcome } = await this.write<any>('encrypt_balance', { amount }, options);
      const result = this.withOutcome(data, outcome);

      setTimeout(() => {
        this.getBalance(true).catch(() => { });
      }, 1000);

      return result;
    } catch (error) {
      rethrowWalletRefusal(error);
      throw new ZeroXIOWalletError(
        ErrorCode.TRANSACTION_FAILED,
        'Failed to encrypt balance',
        error
      );
    }
  }

  /** @deprecated The 0xio extension answers NOT_AVAILABLE; users decrypt from its Privacy screen. */
  async decryptBalance(amount: string | number, options?: WriteOptions): Promise<TransactionResult & WriteOutcome> {
    this.ensureConnected();
    this.assertExactOCTAmount(amount, 'Decrypt amount');

    if (!isValidAmount(amount)) {
      throw new ZeroXIOWalletError(ErrorCode.TRANSACTION_FAILED, 'Invalid amount');
    }

    try {
      const { data, outcome } = await this.write<any>('decrypt_balance', { amount }, options);
      const result = this.withOutcome(data, outcome);

      setTimeout(() => {
        this.getBalance(true).catch(() => { });
      }, 1000);

      return result;
    } catch (error) {
      rethrowWalletRefusal(error);
      throw new ZeroXIOWalletError(
        ErrorCode.TRANSACTION_FAILED,
        'Failed to decrypt balance',
        error
      );
    }
  }

  /**
   * Needs the 'private_transfers' permission; proofs run in the wallet after the review.
   * @since 2.6.0
   * @example
   * ```typescript
   * const result = await wallet.sendPrivateTransfer(
   *   { to: 'oct1...', amount: '2.5' },
   *   { requestId: wallet.newRequestId(), onStatus: (s) => console.log(s.status) }
   * );
   * console.log(result.hash);
   * ```
   */
  async sendPrivateTransfer(transferData: PrivateTransferData, options?: WriteOptions): Promise<TransactionResult & WriteOutcome> {
    this.ensureConnected();

    if (!isValidAddress(transferData.to)) {
      throw new ZeroXIOWalletError(ErrorCode.INVALID_ADDRESS, 'Invalid recipient address');
    }
    if (!isValidAmount(transferData.amount)) {
      throw new ZeroXIOWalletError(ErrorCode.TRANSACTION_FAILED, 'Invalid transfer amount');
    }
    this.assertExactOCTAmount(transferData.amount, 'Transfer amount');
    if (transferData.message && transferData.message.length > 1000) {
      throw new ZeroXIOWalletError(ErrorCode.TRANSACTION_FAILED, 'Transfer message too long (max 1,000 characters)');
    }

    try {
      const { data, outcome } = await this.write<any>('send_private_transfer', {
        ...transferData,
        ...(transferData.amountRaw ? { amount_raw: transferData.amountRaw } : {}),
      }, options);
      const result = this.withOutcome(data, outcome);

      if (result.accepted ?? result.success) {
        setTimeout(() => {
          this.getBalance(true).catch(() => { });
        }, 1000);
      }

      return result;
    } catch (error) {
      rethrowWalletRefusal(error);
      throw new ZeroXIOWalletError(
        ErrorCode.TRANSACTION_FAILED,
        'Failed to send private transfer',
        error
      );
    }
  }

  /** Transfers the connected address can claim. @since 2.6.0 */
  async getPendingPrivateTransfers(): Promise<PendingPrivateTransfer[]> {
    this.ensureConnected();

    try {
      const result = await this.communicator.sendRequest('get_pending_private_transfers');
      return result;
    } catch (error) {
      rethrowWalletRefusal(error);
      throw new ZeroXIOWalletError(
        ErrorCode.NETWORK_ERROR,
        'Failed to get pending private transfers',
        error
      );
    }
  }

  /** @since 2.6.0 */
  async claimPrivateTransfer(transferId: string, options?: WriteOptions): Promise<TransactionResult & WriteOutcome> {
    this.ensureConnected();

    if (!transferId || typeof transferId !== 'string') {
      throw new ZeroXIOWalletError(ErrorCode.TRANSACTION_FAILED, 'Invalid transfer ID');
    }

    try {
      const { data, outcome } = await this.write<any>('claim_private_transfer', {
        transferId
      }, options);
      const result = this.withOutcome(data, outcome);

      if (result.accepted ?? result.success) {
        setTimeout(() => {
          this.getBalance(true).catch(() => { });
        }, 1000);
      }

      return result;
    } catch (error) {
      rethrowWalletRefusal(error);
      throw new ZeroXIOWalletError(
        ErrorCode.TRANSACTION_FAILED,
        'Failed to claim private transfer',
        error
      );
    }
  }

  /** Any wallet method, for primitives without a typed helper. @since 2.8.0 */
  async request<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (isLifecycleMethod(method)) {
      return (await this.review<T>(method, params)).data;
    }
    return this.communicator.sendRequest(method, params) as Promise<T>;
  }

  /** Read only node RPC; only the wallet's allow-listed methods. @since 2.8.0 */
  async rpcCall<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
    return this.communicator.sendRequest('rpc_call', { method, params }) as Promise<T>;
  }

  /** @since 2.8.0 */
  async getPrivateCapabilities(): Promise<{
    wallet: string;
    version: string;
    supports: Record<string, boolean>;
    methods: string[];
    required_permissions?: Record<string, string[]>;
  }> {
    return this.communicator.sendRequest('get_private_capabilities');
  }

  /** Read only; no review. @since 2.8.0 */
  async callContractView(params: { contract: string; method: string; params?: unknown[]; caller?: string }): Promise<unknown> {
    this.ensureConnected();
    return this.communicator.sendRequest('contract_call_view', params);
  }

  /** Keys stay in the wallet. @since 2.8.0 */
  async encryptValue(params: { value_raw: string; token?: string; owner?: string; asset?: string }): Promise<{ cipher: string; commitment?: string; encoding?: string }> {
    this.ensureConnected();
    return this.communicator.sendRequest('encrypt_value', params);
  }

  /** @since 2.8.0 */
  async decryptValue(params: { cipher: string; token?: string; owner?: string }): Promise<{ value_raw: string; display?: string; decimals?: number }> {
    this.ensureConnected();
    return this.communicator.sendRequest('decrypt_value', params);
  }

  /** Proves the cipher encrypts `value_raw`, default 0. @since 2.8.0 */
  async makeZeroProof(params: { cipher: string; value_raw?: string; token?: string; owner?: string }): Promise<{ proof: string; commitment?: string; blinding?: string; encoding?: string }> {
    this.ensureConnected();
    return this.communicator.sendRequest('make_zero_proof', params);
  }

  /** @since 2.8.0 */
  async makeRangeProof(params: { cipher: string; value_raw: string; token?: string; owner?: string; range?: { min_raw: string; max_raw: string } }): Promise<{ proof: string; encoding?: string }> {
    this.ensureConnected();
    return this.communicator.sendRequest('make_range_proof', params);
  }

  /** Decrypted inside the wallet. @since 2.8.0 */
  async getPrivateBalance(params: { address?: string; assets?: string[]; tokens?: string[]; include_claimable?: boolean } = {}): Promise<unknown> {
    this.ensureConnected();
    return this.communicator.sendRequest('get_private_balance', params);
  }

  /**
   * Makes the connected wallet able to receive and claim private transfers. A registered account
   * completes at once with nothing signed; otherwise one reviewed key switch pays the fee.
   * @throws ZeroXIOWalletError with code INVALID_PARAMS for another address, PVAC_KEY_MISMATCH when another
   *   key is registered, REGISTRATION_PENDING while one is unconfirmed, INSUFFICIENT_BALANCE below the fee
   * @since 2.8.0
   */
  async registerPrivateViewKey(params: { address: string }, options?: WriteOptions): Promise<PrivateViewKeyRegistration & WriteOutcome> {
    this.ensureConnected();
    const { data, outcome } = await this.write<any>('register_private_view_key', params, options);
    return this.withOutcome(data, outcome);
  }

  /** Submit an ordered multi-step public contract flow under one approval. @since 2.8.0 */
  async sendContractTransactionSequence(params: { sequence_id?: string; transactions: Array<{ contract: string; method: string; params?: unknown[]; amount?: string; ou?: string }> }, options?: WriteOptions): Promise<unknown> {
    this.ensureConnected();
    const { data, outcome } = await this.write<any>('send_contract_transaction_sequence', params, options);
    return this.withOutcome(data, outcome);
  }

  /**
   * The wallet signs the framed message (see `getSignedMessageBytes`), never the raw one.
   *
   * @param message - The message to sign (non-empty string)
   * @returns Promise resolving to the base64-encoded Ed25519 signature
   * @throws ZeroXIOWalletError with code SIGNATURE_FAILED if signing fails
   * @example
   * ```typescript
   * const signature = await wallet.signMessage('Hello, 0xio!');
   * const ok = await verifyMessage('Hello, 0xio!', signature, await wallet.getPublicKey());
   * ```
   */
  async signMessage(message: string, options?: ReviewOptions): Promise<string> {
    this.ensureConnected();

    if (!message || typeof message !== 'string') {
      throw new ZeroXIOWalletError(
        ErrorCode.SIGNATURE_FAILED,
        'Message must be a non-empty string'
      );
    }

    if (message.length > 10_000) {
      throw new ZeroXIOWalletError(
        ErrorCode.SIGNATURE_FAILED,
        'Message too long (max 10,000 characters)'
      );
    }

    try {
      this.logger.log('Requesting message signature for:', message.substring(0, 100) + (message.length > 100 ? '...' : ''));
      const { data: result } = await this.review<any>('signMessage', { message }, options);

      const signature = result?.signature || result;

      this.logger.log('Message signed successfully');
      return signature;
    } catch (error) {
      this.logger.error('Sign message failed:', error);

      if (error instanceof ZeroXIOWalletError) {
        throw error;
      }

      throw new ZeroXIOWalletError(
        ErrorCode.SIGNATURE_FAILED,
        'Failed to sign message',
        error
      );
    }
  }

  /**
   * Binds the signature to the service, the nonce and the page origin, so it cannot be replayed
   * against another service.
   *
   * @param service - Identifies the relying service (e.g. 'MyDApp' or 'api.mydapp.com')
   * @param nonce   - Unique one-time value. Use a server-generated UUID or challenge
   * @returns Promise resolving to the base64-encoded Ed25519 signature
   */
  async signAuthMessage(service: string, nonce: string, options?: ReviewOptions): Promise<string> {
    this.ensureConnected();

    if (!service || typeof service !== 'string') {
      throw new ZeroXIOWalletError(ErrorCode.SIGNATURE_FAILED, 'Service name is required');
    }
    if (!nonce || typeof nonce !== 'string') {
      throw new ZeroXIOWalletError(ErrorCode.SIGNATURE_FAILED, 'Nonce is required');
    }

    const origin = typeof window !== 'undefined' ? window.location.origin : 'unknown';
    return this.signMessage(buildAuthMessage(service, nonce, origin), options);
  }

  private get tracker(): RequestTracker {
    if (!this._requests) {
      this._requests = new RequestTracker((status) => this.emit('requestUpdate', status));
    }
    return this._requests;
  }

  private lifecycleActive(): boolean {
    return typeof this.communicator.touchRequest === 'function';
  }

  private speaks(capability: string): boolean {
    const info = this._walletInfo;
    return !!info && info.protocol === 2 && info.capabilities.includes(capability);
  }

  private assertRequestId(requestId: unknown): asserts requestId is string {
    if (!isRequestId(requestId)) {
      throw new ZeroXIOWalletError(
        ErrorCode.INVALID_PARAMS,
        'A request id is 32 lowercase hex characters; make one with newRequestId()'
      );
    }
  }

  private async review<T = any>(
    method: string,
    params: any,
    options: ReviewOptions = {}
  ): Promise<{ data: T; requestId: string }> {
    if (!this.lifecycleActive()) {
      return { data: await this.communicator.sendRequest<T>(method, params), requestId: '' };
    }
    const rid = options.requestId ?? newRequestId();
    this.assertRequestId(rid);
    const network = method === 'connect' || method === 'switch_network'
      ? (params?.networkId ?? null)
      : (this.getNetworkId() ?? this.config?.networkId ?? null);
    const key = requestDigestInput(method, params, network);
    const tracker = this.tracker;
    const known = tracker.get(rid);

    if (known) {
      if (known.key !== null && known.key !== key) {
        const err = new ZeroXIOWalletError(
          ErrorCode.REQUEST_ID_REUSED,
          'This request id belongs to another request; make a new id',
          { requestId: rid }
        );
        err.requestId = rid;
        throw err;
      }
      if (known.promise || known.outcome) {
        const stop = options.onStatus ? tracker.subscribe(rid, options.onStatus) : null;
        try {
          if (known.promise) return await known.promise as { data: T; requestId: string };
          if (known.outcome!.ok) return { data: known.outcome!.value, requestId: rid };
          throw known.outcome!.error;
        } finally {
          stop?.();
        }
      }
      if (!this.speaks('idempotent')) {
        // A protocol 1 wallet cannot recognise the id, so sending it again would open a new review.
        const err = new ZeroXIOWalletError(
          ErrorCode.STATUS_UNKNOWN,
          'This wallet cannot be asked again about this request; a new request id opens a new review',
          { requestId: rid, lastStatus: known.status.status }
        );
        err.requestId = rid;
        throw err;
      }
    }

    const busy = tracker.inReview(rid);
    if (busy) {
      throw new ZeroXIOWalletError(
        ErrorCode.RATE_LIMIT_EXCEEDED,
        'Another request from this page is waiting for review. Please wait for it to complete.',
        { reason: 'review_pending', requestId: busy.status.requestId, status: busy.status.status }
      );
    }

    const isNew = !known;
    const rec = tracker.begin(rid, method, key, network ?? undefined);
    const stopFollowing = options.onStatus ? tracker.subscribe(rid, options.onStatus) : null;
    if (isNew && options.onStatus) {
      try {
        options.onStatus(rec.status);
      } catch {
        // a site callback must not break the call
      }
    }
    const run = (async () => {
      try {
        const data = await this.communicator.sendRequest<T>(method, params, undefined, {
          rid,
          ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
        });
        const hash = resultHash(data);
        tracker.local(rid, hash ? { status: 'submitted', hash } : { status: 'completed' });
        rec.outcome = { ok: true, value: data };
        return { data, requestId: rid };
      } catch (error) {
        throw this.lifecycleError(rid, error);
      } finally {
        rec.promise = undefined;
      }
    })();
    rec.promise = run;
    try {
      return await run;
    } finally {
      stopFollowing?.();
    }
  }

  private lifecycleError(rid: string, error: unknown): ZeroXIOWalletError {
    const base = error instanceof ZeroXIOWalletError
      ? error
      : new ZeroXIOWalletError(ErrorCode.UNKNOWN_ERROR, error instanceof Error ? error.message : 'Request failed');
    const tracker = this.tracker;
    const current = tracker.snapshot(rid);
    const keep = primitiveDetails(base.details);
    let details: Record<string, unknown>;
    if (base.code === ErrorCode.STATUS_UNKNOWN) {
      details = { ...keep, requestId: rid, lastStatus: current?.status ?? 'pending' };
    } else if (base.code === ErrorCode.NETWORK_ERROR) {
      // The wallet may have the request and still finish it.
      details = { ...keep, requestId: rid, status: 'unknown' };
    } else {
      const wireStatus = isRequestStatusValue(base.details?.status) ? base.details.status : undefined;
      const status = base.code === ErrorCode.USER_REJECTED
        ? (wireStatus === 'expired' ? 'expired' : 'rejected')
        : 'failed';
      const stage = current?.status === 'signing' ? 'submit' : 'review';
      tracker.local(rid, status === 'failed'
        ? { status, error: { code: base.code, message: base.message.slice(0, 500), stage } }
        : { status });
      details = { ...keep, requestId: rid, status };
    }
    const out = new ZeroXIOWalletError(base.code, base.message, details);
    out.requestId = rid;
    const rec = tracker.get(rid);
    const now = tracker.snapshot(rid);
    if (rec && now && isFinalStatus(now.status)) rec.outcome = { ok: false, error: out };
    return out;
  }

  private async write<T = any>(
    method: string,
    params: any,
    options: WriteOptions = {}
  ): Promise<{ data: T; outcome?: WriteOutcome }> {
    const { data, requestId } = await this.review<T>(method, params, options);
    if (!requestId) return { data };
    const hashes = resultHashes(data);
    if (!hashes.length && this.tracker.snapshot(requestId)?.status === 'completed') {
      return { data, outcome: { requestId, requestStatus: 'completed' } };
    }
    if (options.wait !== 'confirmed') return { data, outcome: { requestId, requestStatus: 'submitted' } };
    const done = (s: RequestStatus) => isFinalStatus(s.status);
    const final = await this.follow(requestId, method, hashes, done, CONFIRM_WAIT_MS, options.onStatus);
    return { data, outcome: this.confirmedOutcome(final, hashes[hashes.length - 1]) };
  }

  private confirmedOutcome(final: RequestStatus, hash?: string): WriteOutcome {
    const requestId = final.requestId;
    if (final.status === 'confirmed' || final.status === 'completed') {
      return {
        requestId,
        requestStatus: 'confirmed',
        ...(final.epoch !== undefined ? { epoch: final.epoch } : {}),
        ...(final.receipt !== undefined ? { receipt: final.receipt } : {}),
        ...(final.receiptUnavailable ? { receiptUnavailable: final.receiptUnavailable } : {}),
      };
    }
    const reason = final.error?.message ?? final.status;
    const err = final.status === 'failed' && final.error?.stage === 'execution'
      ? new ZeroXIOWalletError(ErrorCode.EXECUTION_FAILED, `The chain did not execute the transaction: ${reason}`, {
        requestId,
        hash: final.hash ?? hash,
        reason,
      })
      : new ZeroXIOWalletError(
        (final.error?.code as ErrorCode) ?? ErrorCode.TRANSACTION_FAILED,
        final.error?.message ?? 'The transaction did not complete',
        { requestId, status: final.status }
      );
    err.requestId = requestId;
    throw err;
  }

  private follow(
    rid: string,
    method: string,
    hashes: string[],
    done: (s: RequestStatus) => boolean,
    timeoutMs: number,
    onStatus?: (s: RequestStatus) => void
  ): Promise<RequestStatus> {
    const tracker = this.tracker;
    const stopper = new Stopper();
    return new Promise<RequestStatus>((resolve, reject) => {
      let finished = false;
      let unsubscribe: () => void = () => {};
      const finish = (fn: () => void) => {
        if (finished) return;
        finished = true;
        clearTimeout(deadline);
        stopper.stop();
        unsubscribe();
        fn();
      };
      const deadline = setTimeout(() => {
        const last = tracker.snapshot(rid);
        const err = new ZeroXIOWalletError(
          ErrorCode.STATUS_UNKNOWN,
          'Stopped waiting; the wallet may still finish this request',
          { requestId: rid, lastStatus: last?.status ?? 'unknown', ...(last?.hash ? { hash: last.hash } : {}) }
        );
        err.requestId = rid;
        finish(() => reject(err));
      }, timeoutMs);
      const walletWatches = this.speaks('wait_confirmed');
      let chainStarted = false;
      const startChain = (s: RequestStatus | null) => {
        if (walletWatches || chainStarted || !s || s.status !== 'submitted') return;
        const onChain = hashes.length ? hashes : s.hash ? [s.hash] : [];
        if (!onChain.length) return;
        chainStarted = true;
        this.pollChain(rid, method || s.method || '', onChain, stopper).catch((error) => {
          finish(() => reject(error));
        });
      };
      const check = (s: RequestStatus | null) => {
        if (s && done(s)) finish(() => resolve(s));
        else startChain(s);
      };
      unsubscribe = tracker.subscribe(rid, (s) => {
        onStatus?.(s);
        check(s);
      });
      check(tracker.snapshot(rid));
      if (finished) return;
      if (this.speaks('request_status')) void this.pollStatus(rid, stopper);
    });
  }

  private async pollStatus(rid: string, stopper: Stopper): Promise<void> {
    let lastSeq = this.tracker.snapshot(rid)?.seq ?? 0;
    while (await stopper.wait(STATUS_POLL_MS)) {
      const seq = this.tracker.snapshot(rid)?.seq ?? 0;
      if (seq !== lastSeq) {
        lastSeq = seq;
        continue;
      }
      try {
        await this.requestStatus(rid);
      } catch {
        // the next round asks again
      }
      lastSeq = this.tracker.snapshot(rid)?.seq ?? 0;
    }
  }

  private async pollChain(rid: string, method: string, hashes: string[], stopper: Stopper): Promise<void> {
    const started = Date.now();
    const tracker = this.tracker;
    let epoch: number | undefined;
    for (const hash of hashes) {
      for (;;) {
        const every = Date.now() - started < FALLBACK_POLL.fastForMs ? FALLBACK_POLL.fastEveryMs : FALLBACK_POLL.slowEveryMs;
        if (!(await stopper.wait(every))) return;
        let tx: any;
        try {
          const res: any = await this.communicator.sendRequest('rpc_call', { method: 'octra_transaction', params: [hash] });
          tx = res && typeof res === 'object' && 'status' in res ? res : res?.result;
        } catch (error) {
          if (stopper.stopped) return;
          if (isRefusal(error)) {
            const err = new ZeroXIOWalletError(
              ErrorCode.UNSUPPORTED_METHOD,
              'This wallet cannot report confirmation; the transaction was submitted',
              { requestId: rid, hash, status: 'submitted' }
            );
            err.requestId = rid;
            throw err;
          }
          continue;
        }
        if (stopper.stopped) return;
        const status = tx?.status;
        if (status === 'confirmed') {
          if (typeof tx.epoch === 'number') epoch = tx.epoch;
          break;
        }
        if (status === 'rejected' || status === 'dropped') {
          const reason = String(tx?.error?.reason ?? tx?.error?.type ?? status).slice(0, 500);
          tracker.local(rid, {
            status: 'failed',
            hash,
            error: { code: ErrorCode.EXECUTION_FAILED, message: reason, stage: 'execution' },
          });
          return;
        }
      }
    }
    const receiptFields = method === 'call_contract' || method === 'deploy_contract'
      ? await this.readReceipt(hashes[hashes.length - 1])
      : {};
    if (stopper.stopped) return;
    tracker.local(rid, { status: 'confirmed', ...(epoch !== undefined ? { epoch } : {}), ...receiptFields });
  }

  private async readReceipt(hash: string): Promise<ConfirmFields> {
    try {
      const res: any = await this.communicator.sendRequest('rpc_call', { method: 'contract_receipt', params: [hash] });
      const receipt: ContractReceipt | null = parseContractReceipt(res && typeof res === 'object' && 'success' in res ? res : res?.result);
      return receipt ? { receipt } : { receipt: null, receiptUnavailable: 'error' };
    } catch (error) {
      const refused = isRefusal(error) || (error instanceof Error && /single scanner read/i.test(error.message));
      return { receipt: null, receiptUnavailable: refused ? 'refused' : 'error' };
    }
  }

  private withOutcome<T>(data: T, outcome?: WriteOutcome): T & WriteOutcome {
    if (!outcome || !data || typeof data !== 'object') return data as T & WriteOutcome;
    return { ...(data as object), ...outcome } as T & WriteOutcome;
  }

  private handleRequestUpdate(data: unknown): void {
    const update = parseRequestStatus(data);
    if (!update) return;
    if (this._requests?.wallet(update)) {
      this.communicator.touchRequest?.(update.requestId);
    }
  }

  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new ZeroXIOWalletError(
        ErrorCode.UNKNOWN_ERROR,
        'SDK not initialized. Call initialize() first.'
      );
    }
  }

  private ensureConnected(): void {
    this.ensureInitialized();

    if (!this.connectionInfo.isConnected) {
      throw new ZeroXIOWalletError(
        ErrorCode.CONNECTION_REFUSED,
        'Wallet not connected. Call connect() first.'
      );
    }
  }

  private setupExtensionEventListeners(): void {
    this.communicator.on('accountChanged', (event) => {
      this.handleAccountChanged(event.data);
    });

    this.communicator.on('networkChanged', (event) => {
      this.handleNetworkChanged(event.data);
    });

    this.communicator.on('balanceChanged', (event) => {
      this.handleBalanceChanged(event.data);
    });

    this.communicator.on('extensionLocked', () => {
      this.handleExtensionLocked();
    });

    this.communicator.on('extensionUnlocked', () => {
      this.handleExtensionUnlocked();
    });

    this.communicator.on('transactionConfirmed', (event) => {
      this.handleTransactionConfirmed(event.data);
    });

    this.communicator.on('transactionFailed', (event) => {
      this.emit('transactionFailed', event.data ?? event);
    });

    this.communicator.on('permissionsChanged', (event) => {
      const permissions = event.data ?? event;
      if (this.connectionInfo.isConnected) {
        this.connectionInfo.permissions = Array.isArray(permissions) ? permissions : [];
      }
      this.emit('permissionsChanged', permissions);
    });

    this.communicator.on('message', (event) => {
      this.emit('message', event.data ?? event);
    });

    this.communicator.on('disconnect', (event) => {
      this.handleWalletDisconnect(event.data);
    });

    this.communicator.on('requestUpdate', (event) => {
      this.handleRequestUpdate(event.data);
    });

    this.logger.log('Extension event listeners setup complete');
  }

  private handleAccountChanged(data: { address: string; balance?: Balance; publicKey?: string; canSign?: unknown }): void {
    ++this._sessionVersion;
    const previousAddress = this.connectionInfo.address;
    const canSign = canSignOf(data.canSign);

    this.connectionInfo.address = data.address;
    this.connectionInfo.publicKey = data.publicKey;
    this.connectionInfo.canSign = canSign;
    if (data.balance) {
      const validated = validateBalance(data.balance);
      if (validated) {
        this.connectionInfo.balance = validated;
      } else {
        this.connectionInfo.balance = undefined;
      }
    }

    const accountChangedEvent: AccountChangedEvent = {
      previousAddress,
      newAddress: data.address,
      publicKey: data.publicKey,
      canSign,
      balance: data.balance ?? this.connectionInfo.balance!
    };

    this.emit('accountChanged', accountChangedEvent);

    this.logger.log('Account changed:', { newAddress: accountChangedEvent.newAddress });
  }

  private handleNetworkChanged(data: { networkInfo: NetworkInfo }): void {
    const previousNetwork = this.connectionInfo.networkInfo;

    const networkInfo = validateNetworkInfo(data.networkInfo);
    if (!networkInfo) {
      this.logger.warn('Received invalid networkInfo in networkChanged event, ignoring');
      return;
    }
    this.connectionInfo.networkInfo = networkInfo;

    this.connectionInfo.balance = undefined;

    const networkChangedEvent: NetworkChangedEvent = {
      previousNetwork,
      newNetwork: networkInfo
    };

    this.emit('networkChanged', networkChangedEvent);

    this.logger.log('Network changed:', networkChangedEvent);
  }

  private handleBalanceChanged(data: { balance: Balance }): void {
    const balance = validateBalance(data.balance);
    if (!balance) {
      this.logger.warn('Received invalid balance in balanceChanged event, ignoring');
      return;
    }

    const previousBalance = this.connectionInfo.balance;
    this.connectionInfo.balance = balance;

    const balanceChangedEvent: BalanceChangedEvent = {
      address: this.connectionInfo.address!,
      previousBalance,
      newBalance: balance
    };

    this.emit('balanceChanged', balanceChangedEvent);

    this.logger.log('Balance changed:', { public: balance.public });
  }

  private handleExtensionLocked(): void {
    ++this._sessionVersion;
    this.connectionInfo = { isConnected: false };

    this.emit('extensionLocked', {});

    const disconnectEvent: DisconnectEvent = {
      reason: 'extension_locked'
    };

    this.emit('disconnect', disconnectEvent);

    this.logger.log('Extension locked - disconnected');
  }

  private handleWalletDisconnect(data: unknown): void {
    if (!this.connectionInfo.isConnected) return;
    ++this._sessionVersion;
    this.connectionInfo = { isConnected: false };
    const raw = (data as { reason?: unknown } | null)?.reason;
    const reason = DISCONNECT_REASONS.has(raw as DisconnectEvent['reason'])
      ? (raw as DisconnectEvent['reason'])
      : 'user_action';
    const disconnectEvent: DisconnectEvent = { reason };
    this.emit('disconnect', disconnectEvent);
    this.logger.log('Wallet disconnected:', reason);
  }

  private handleExtensionUnlocked(): void {
    this.emit('extensionUnlocked', {});
    this.getConnectionStatus().catch(() => {
      this.logger.warn('Could not restore connection after unlock');
    });

    this.logger.log('Extension unlocked');
  }

  private handleTransactionConfirmed(data: any): void {
    this.emit('transactionConfirmed', {
      txHash: data.txHash,
      transaction: data.transaction,
      confirmations: data.confirmations
    });

    setTimeout(() => {
      this.getBalance(true).catch(() => { });
    }, 2000);

    this.logger.log('Transaction confirmed:', data.txHash);
  }

  private resolveRawAmount(
    amount: string | number | undefined,
    amountOct: string | number | undefined,
    label: string
  ): string | number {
    if (amount != null && amountOct != null) {
      throw new ZeroXIOWalletError(ErrorCode.INVALID_AMOUNT, `${label}: pass amount or amountOct, not both`);
    }
    if (amountOct != null) {
      this.assertExactOCTAmount(amountOct, label);
      return octToMicro(amountOct);
    }
    if (amount == null || !isValidAmount(amount)) {
      throw new ZeroXIOWalletError(ErrorCode.TRANSACTION_FAILED, `Invalid ${label.toLowerCase()}`);
    }
    return amount;
  }

  /** 0.1 + 0.2 is 0.30000000000000004: the wallet would sign the wrong value. */
  private assertExactOCTAmount(amount: string | number, label: string): void {
    if (typeof amount === 'number') {
      const micro = Math.round(amount * 1_000_000);
      if (Math.abs(amount - micro / 1_000_000) > 1e-10) {
        const suggested = (micro / 1_000_000).toFixed(6);
        throw new ZeroXIOWalletError(
          ErrorCode.INVALID_AMOUNT,
          `${label} cannot be represented exactly in micro-OCT. ` +
          `Pass a string instead (e.g. "${suggested}").`
        );
      }
    }
  }

  cleanup(): void {
    this.communicator.cleanup();
    this.removeAllListeners();
    this.connectionInfo = { isConnected: false };
    this.isInitialized = false;
    this._initPromise = null;
    this._transport = null;
    this._desktopOnConnect = false;
    this._walletInfo = null;
    this._requests?.clear();
    ++this._sessionVersion;

    this.logger.log('SDK cleanup complete');
  }
}