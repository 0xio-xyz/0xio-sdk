import { EventEmitter } from './events';
import { ExtensionCommunicator } from './communication';
import {
  Balance,
  ConnectionInfo,
  ConnectOptions,
  ContractCallData,
  ContractViewCallData,
  NetworkInfo,
  SDKConfig,
  TransactionData,
  TransactionResult,
  TransactionHistory,
  PrivateBalanceInfo,
  PrivateTransferData,
  PendingPrivateTransfer,
  ErrorCode,
  ZeroXIOWalletError,
  ConnectEvent,
  DisconnectEvent,
  AccountChangedEvent,
  BalanceChangedEvent,
  NetworkChangedEvent
} from './types';
import { getNetworkConfig, createDefaultBalance, validateBalance, validateNetworkInfo } from './config';
import { createLogger, isValidAddress, isValidAmount, deriveOctraAddress } from './utils';

export class ZeroXIOWallet extends EventEmitter {
  private communicator: ExtensionCommunicator;
  private config: SDKConfig;
  private connectionInfo: ConnectionInfo = { isConnected: false };
  private isInitialized = false;
  private _initPromise: Promise<boolean> | null = null;
  // session version — stale write detection
  private _sessionVersion = 0;
  private logger: ReturnType<typeof createLogger>;

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
      this.config.adapter
    );

    this.logger.log('Wallet instance created with config:', this.config);
  }

  async initialize(): Promise<boolean> {
    if (this.isInitialized) {
      return true;
    }

    if (this._initPromise) {
      return this._initPromise;
    }

    this._initPromise = (async () => {
      try {
        const communicationReady = await this.communicator.initialize();
        if (!communicationReady) {
          throw new ZeroXIOWalletError(
            ErrorCode.EXTENSION_NOT_FOUND,
            'Failed to establish communication with 0xio Wallet extension'
          );
        }

        await this.communicator.sendRequest('register_dapp', {
          appName: this.config.appName,
          appDescription: this.config.appDescription,
          appVersion: this.config.appVersion,
          appUrl: typeof window !== 'undefined' ? window.location.origin : undefined,
          appIcon: this.config.appIcon,
          requiredPermissions: this.config.requiredPermissions,
          networkId: this.config.networkId
        });

        this.setupExtensionEventListeners();

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

  isReady(): boolean {
    return this.isInitialized && this.communicator.isExtensionAvailable();
  }

  async connect(options: ConnectOptions = {}): Promise<ConnectEvent> {
    this.ensureInitialized();

    try {
      this.logger.log('Attempting to connect with options:', options);

      // filter to declared perms only — accept both RFC 'permissions' and legacy 'requestPermissions'
      const declaredPermissions = this.config.requiredPermissions || [];
      const requestedPerms = options.permissions ?? options.requestPermissions;
      const requestedPermissions = requestedPerms
        ? requestedPerms.filter(p => declaredPermissions.includes(p))
        : declaredPermissions;

      const result = await this.communicator.sendRequest('connect', {
        permissions: requestedPermissions,
        networkId: options.networkId || this.config.networkId
      });

      // verify pubkey→addr binding
      if (result.publicKey && result.address) {
        try {
          const derived = await deriveOctraAddress(result.publicKey);
          if (derived !== result.address) {
            throw new ZeroXIOWalletError(
              ErrorCode.UNKNOWN_ERROR,
              'Address-key binding verification failed — the reported public key does not derive to the reported address'
            );
          }
        } catch (e) {
          if (e instanceof ZeroXIOWalletError) throw e;
          this.logger.warn('Address derivation check skipped (crypto unavailable):', e);
        }
      }

      // Use networkInfo from extension response — validate before caching.
      const networkInfo = validateNetworkInfo(result.networkInfo)
        ?? (result.networkId ? getNetworkConfig(result.networkId) : null);

      if (!networkInfo) {
        throw new ZeroXIOWalletError(
          ErrorCode.NETWORK_ERROR,
          'Wallet did not return valid network metadata.'
        );
      }
      const permissions = result.permissions || [];

      // Update connection info — including permissions
      this.connectionInfo = {
        isConnected: true,
        address: result.address,
        publicKey: result.publicKey,
        balance: result.balance,
        networkInfo,
        connectedAt: Date.now(),
        permissions
      };

      const connectEvent: ConnectEvent = {
        address: result.address,
        publicKey: result.publicKey,
        balance: result.balance,
        networkInfo,
        permissions
      };

      // Emit connect event
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

  /**
   * Disconnect from wallet
   */
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

  /**
   * Check if connected to wallet
   */
  isConnected(): boolean {
    return this.connectionInfo.isConnected;
  }

  /**
   * Get current connection info
   */
  getConnectionInfo(): ConnectionInfo {
    return { ...this.connectionInfo };
  }

  /**
   * Check connection status with extension
   */
  async getConnectionStatus(): Promise<ConnectionInfo> {
    this.ensureInitialized();

    try {
      const sv = this._sessionVersion;
      const result = await this.communicator.sendRequest('getConnectionStatus');

      // skip if session changed mid-flight
      if (this._sessionVersion !== sv) return { ...this.connectionInfo };

      if (result.isConnected && result.address) {
        // verify pubkey→addr binding
        if (result.publicKey) {
          try {
            const derived = await deriveOctraAddress(result.publicKey);
            if (derived !== result.address) {
              this.logger.warn('Address-key binding mismatch on session restore — ignoring stale session');
              this.connectionInfo = { isConnected: false };
              return { ...this.connectionInfo };
            }
          } catch (e) {
            this.logger.warn('Address derivation check skipped (crypto unavailable):', e);
          }
        }

        // validate untrusted balance/networkInfo before caching
        const balanceInfo = validateBalance(result.balance) ?? createDefaultBalance();
        const networkInfo = validateNetworkInfo(result.networkInfo)
          ?? (result.networkId ? getNetworkConfig(result.networkId) : null);

        if (!networkInfo) {
          this.logger.warn('getConnectionStatus: wallet returned no network metadata — returning cached state');
          return this.connectionInfo;
        }

        const wasConnected = this.connectionInfo.isConnected;
        const permissions = result.permissions || [];

        // preserve existing connectedAt
        const connectedAt = this.connectionInfo.connectedAt || result.connectedAt || Date.now();

        this.connectionInfo = {
          isConnected: true,
          address: result.address,
          publicKey: result.publicKey,
          balance: balanceInfo,
          networkInfo,
          connectedAt,
          permissions
        };

        this.logger.log('Discovered existing connection:', { address: result.address, network: networkInfo.id });

        // only emit on disconnected→connected transition
        if (!wasConnected) {
          const connectEvent: ConnectEvent = {
            address: result.address,
            publicKey: result.publicKey,
            balance: balanceInfo,
            networkInfo,
            permissions
          };

          this.emit('connect', connectEvent);
        }
      } else {
        // No existing connection
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
   * Switch the extension's active network (e.g. 'mainnet' → 'devnet').
   * Works silently — no popup, no user confirmation needed.
   * The extension broadcasts 'networkChanged' event to all connected dApps.
   */
  async switchNetwork(networkId: string): Promise<{ network: string; switched: boolean }> {
    this.ensureConnected();

    try {
      const sv = this._sessionVersion;
      const result = await this.communicator.sendRequest('switch_network', { networkId });
      this.logger.log(`Network switch result:`, result);

      // skip if session changed mid-flight
      if (this._sessionVersion !== sv) return { network: result.network || networkId, switched: result.switched ?? false };

      if (result.switched) {
        // Update internal state
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

  /**
   * Get the extension's current network ID ('mainnet' or 'devnet')
   */
  getNetworkId(): string | null {
    return this.connectionInfo.networkInfo?.id || null;
  }

  getAddress(): string | null {
    return this.connectionInfo.address || null;
  }

  async getBalance(forceRefresh = false): Promise<Balance> {
    this.ensureConnected();

    try {
      const address = this.getAddress();
      if (!address) {
        throw new ZeroXIOWalletError(ErrorCode.INVALID_ADDRESS, 'No address found');
      }

      // Fetch balance from extension (bypasses CORS, has access to private balance)
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

      // skip if session changed mid-flight
      if (this._sessionVersion !== sv) return result;

      if (this.connectionInfo.balance) {
        const previousBalance = this.connectionInfo.balance;
        this.connectionInfo.balance = result;

        // emit on total or pub/priv split change
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

      // skip if session changed mid-flight
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

  async sendTransaction(txData: TransactionData): Promise<TransactionResult> {
    this.ensureConnected();

    if (!isValidAddress(txData.to)) {
      throw new ZeroXIOWalletError(ErrorCode.INVALID_ADDRESS, 'Invalid recipient address');
    }
    if (!isValidAmount(txData.amount)) {
      throw new ZeroXIOWalletError(ErrorCode.TRANSACTION_FAILED, 'Invalid transaction amount');
    }
    if (txData.message && txData.message.length > 1000) {
      throw new ZeroXIOWalletError(ErrorCode.TRANSACTION_FAILED, 'Transaction message too long (max 1,000 characters)');
    }

    try {
      // log non-sensitive only
      this.logger.log('Sending transaction:', { to: txData.to });

      const result = await this.communicator.sendRequest('send_transaction', txData);

      this.logger.log('Transaction result:', result);

      // Refresh balance after successful transaction (accept RFC 'accepted' or legacy 'success')
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

  /**
   * Sign a transaction without broadcasting it (RFC-O-1 octra_signTransaction).
   * Returns the signed transaction object for manual submission via submitTransaction().
   */
  async signTransaction(txData: TransactionData): Promise<{ signedTx: any }> {
    this.ensureConnected();

    if (!isValidAddress(txData.to)) {
      throw new ZeroXIOWalletError(ErrorCode.INVALID_ADDRESS, 'Invalid recipient address');
    }
    if (!isValidAmount(txData.amount)) {
      throw new ZeroXIOWalletError(ErrorCode.TRANSACTION_FAILED, 'Invalid transaction amount');
    }
    if (txData.message && txData.message.length > 1000) {
      throw new ZeroXIOWalletError(ErrorCode.TRANSACTION_FAILED, 'Transaction message too long (max 1,000 characters)');
    }

    try {
      this.logger.log('Requesting transaction signature:', { to: txData.to });
      const result = await this.communicator.sendRequest('sign_transaction', txData);
      return result;
    } catch (error) {
      if (error instanceof ZeroXIOWalletError) throw error;
      throw new ZeroXIOWalletError(ErrorCode.SIGNATURE_FAILED, 'Failed to sign transaction', error);
    }
  }

  /**
   * Broadcast a pre-signed transaction (RFC-O-1 octra_submitTransaction).
   * Use after signTransaction() to submit the signed tx to the network.
   */
  async submitTransaction(signedTx: any): Promise<TransactionResult> {
    this.ensureConnected();

    if (!signedTx || typeof signedTx !== 'object') {
      throw new ZeroXIOWalletError(ErrorCode.TRANSACTION_FAILED, 'signedTx must be an object');
    }

    try {
      this.logger.log('Submitting pre-signed transaction');
      const result = await this.communicator.sendRequest('broadcast_only', { signedTx });
      return result;
    } catch (error) {
      if (error instanceof ZeroXIOWalletError) throw error;
      throw new ZeroXIOWalletError(ErrorCode.TRANSACTION_FAILED, 'Failed to submit transaction', error);
    }
  }

  /**
   * Call a smart contract method (state-changing).
   * The extension builds, signs, and submits the transaction via octra_submit.
   */
  async callContract(callData: ContractCallData): Promise<TransactionResult> {
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
    if (callData.amount != null) {
      this.assertExactOCTAmount(callData.amount, 'Contract call amount');
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
      // log non-sensitive only
      this.logger.log('Calling contract:', { contract: callData.contract, method: callData.method });

      const result = await this.communicator.sendRequest('call_contract', {
        contract: callData.contract,
        method: callData.method,
        params: callData.params,
        amount: callData.amount != null ? String(callData.amount) : '0',
        ou: callData.ou != null ? String(callData.ou) : '10000',
      });

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

  /**
   * Read-only contract view call (no signing, no approval popup).
   * Use this to query contract state without submitting a transaction.
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
      // log non-sensitive only
      this.logger.log('Contract view call:', { contract: viewData.contract, method: viewData.method });

      const result = await this.communicator.sendRequest('contract_call_view', {
        contract: viewData.contract,
        method: viewData.method,
        params: viewData.params,
        // only include caller if explicit
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

  /**
   * Read contract storage by key.
   */
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

  /**
   * Get transaction history
   */
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
      throw new ZeroXIOWalletError(
        ErrorCode.PERMISSION_DENIED,
        'Failed to get private balance info',
        error
      );
    }
  }

  /**
   * Encrypt public balance to private
   */
  async encryptBalance(amount: string | number): Promise<TransactionResult> {
    this.ensureConnected();
    this.assertExactOCTAmount(amount, 'Encrypt amount');

    if (!isValidAmount(amount)) {
      throw new ZeroXIOWalletError(ErrorCode.TRANSACTION_FAILED, 'Invalid amount');
    }

    try {
      const result = await this.communicator.sendRequest('encrypt_balance', { amount });

      // Refresh balance after encryption
      setTimeout(() => {
        this.getBalance(true).catch(() => { });
      }, 1000);

      return result;
    } catch (error) {
      throw new ZeroXIOWalletError(
        ErrorCode.TRANSACTION_FAILED,
        'Failed to encrypt balance',
        error
      );
    }
  }

  /**
   * Decrypt private balance to public
   */
  async decryptBalance(amount: string | number): Promise<TransactionResult> {
    this.ensureConnected();
    this.assertExactOCTAmount(amount, 'Decrypt amount');

    if (!isValidAmount(amount)) {
      throw new ZeroXIOWalletError(ErrorCode.TRANSACTION_FAILED, 'Invalid amount');
    }

    try {
      const result = await this.communicator.sendRequest('decrypt_balance', { amount });

      // Refresh balance after decryption
      setTimeout(() => {
        this.getBalance(true).catch(() => { });
      }, 1000);

      return result;
    } catch (error) {
      throw new ZeroXIOWalletError(
        ErrorCode.TRANSACTION_FAILED,
        'Failed to decrypt balance',
        error
      );
    }
  }

  /**
   * Send a private (encrypted) transfer to another address.
   * The extension builds the PVAC ciphertext subtraction + range proof + zero proof,
   * then submits the encrypted transaction to the network. The recipient's encrypted
   * balance is updated by the node using re-encryption under their public key.
   * Requires 'private_transfers' permission.
   * @since 2.6.0
   */
  async sendPrivateTransfer(transferData: PrivateTransferData): Promise<TransactionResult> {
    this.ensureConnected();

    if (!isValidAddress(transferData.to)) {
      throw new ZeroXIOWalletError(ErrorCode.INVALID_ADDRESS, 'Invalid recipient address');
    }
    if (!isValidAmount(transferData.amount)) {
      throw new ZeroXIOWalletError(ErrorCode.TRANSACTION_FAILED, 'Invalid transfer amount');
    }
    this.assertExactOCTAmount(transferData.amount, 'Transfer amount');
    // bound msg size
    if (transferData.message && transferData.message.length > 1000) {
      throw new ZeroXIOWalletError(ErrorCode.TRANSACTION_FAILED, 'Transfer message too long (max 1,000 characters)');
    }

    try {
      const result = await this.communicator.sendRequest('send_private_transfer', transferData);

      // Refresh balance after transfer (accept RFC 'accepted' or legacy 'success')
      if (result.accepted ?? result.success) {
        setTimeout(() => {
          this.getBalance(true).catch(() => { });
        }, 1000);
      }

      return result;
    } catch (error) {
      throw new ZeroXIOWalletError(
        ErrorCode.TRANSACTION_FAILED,
        'Failed to send private transfer',
        error
      );
    }
  }

  /**
   * Get pending private transfers that can be claimed by this wallet.
   * Returns transfers where the connected address is the recipient.
   * @since 2.6.0
   */
  async getPendingPrivateTransfers(): Promise<PendingPrivateTransfer[]> {
    this.ensureConnected();

    try {
      const result = await this.communicator.sendRequest('get_pending_private_transfers');
      return result;
    } catch (error) {
      throw new ZeroXIOWalletError(
        ErrorCode.NETWORK_ERROR,
        'Failed to get pending private transfers',
        error
      );
    }
  }

  /**
   * Claim a pending private transfer, adding it to the wallet's encrypted balance.
   * @since 2.6.0
   */
  async claimPrivateTransfer(transferId: string): Promise<TransactionResult> {
    this.ensureConnected();

    // validate transfer ID
    if (!transferId || typeof transferId !== 'string') {
      throw new ZeroXIOWalletError(ErrorCode.TRANSACTION_FAILED, 'Invalid transfer ID');
    }

    try {
      const result = await this.communicator.sendRequest('claim_private_transfer', {
        transferId
      });

      // Refresh balance after claiming (accept RFC 'accepted' or legacy 'success')
      if (result.accepted ?? result.success) {
        setTimeout(() => {
          this.getBalance(true).catch(() => { });
        }, 1000);
      }

      return result;
    } catch (error) {
      throw new ZeroXIOWalletError(
        ErrorCode.TRANSACTION_FAILED,
        'Failed to claim private transfer',
        error
      );
    }
  }

  /**
   * Sign an arbitrary message with the wallet's private key
   * The user will be prompted to approve the signature request in the extension
   * @param message - The message to sign (non-empty string)
   * @returns Promise resolving to the base64-encoded Ed25519 signature
   * @throws ZeroXIOWalletError with code SIGNATURE_FAILED if signing fails
   * @example
   * ```typescript
   * const signature = await wallet.signMessage('Hello, 0xio!');
   * console.log('Signature:', signature);
   * ```
   */
  async signMessage(message: string): Promise<string> {
    this.ensureConnected();

    // Validate input
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
      const result = await this.communicator.sendRequest('signMessage', { message });

      // Extension returns { signature: string }
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
   * Sign a domain-separated authentication message.
   * Unlike `signMessage()`, this prepends a standard header that binds the signature
   * to the calling service and a one-time nonce, preventing cross-service replay attacks.
   *
   * @param service - Identifies the relying service (e.g. 'MyDApp' or 'api.mydapp.com')
   * @param nonce   - Unique one-time value — use a server-generated UUID or challenge
   * @returns Promise resolving to the base64-encoded Ed25519 signature
   */
  async signAuthMessage(service: string, nonce: string): Promise<string> {
    this.ensureConnected();

    if (!service || typeof service !== 'string') {
      throw new ZeroXIOWalletError(ErrorCode.SIGNATURE_FAILED, 'Service name is required');
    }
    if (!nonce || typeof nonce !== 'string') {
      throw new ZeroXIOWalletError(ErrorCode.SIGNATURE_FAILED, 'Nonce is required');
    }

    const origin = typeof window !== 'undefined' ? window.location.origin : 'unknown';
    const domainSeparated =
      `0xio auth\nService: ${service}\nNonce: ${nonce}\nOrigin: ${origin}`;

    return this.signMessage(domainSeparated);
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

    this.logger.log('Extension event listeners setup complete');
  }

  private handleAccountChanged(data: { address: string; balance?: Balance; publicKey?: string }): void {
    ++this._sessionVersion;
    const previousAddress = this.connectionInfo.address;

    this.connectionInfo.address = data.address;
    // clear stale pubkey on acct change
    this.connectionInfo.publicKey = data.publicKey;
    if (data.balance) {
      const validated = validateBalance(data.balance);
      if (validated) {
        this.connectionInfo.balance = validated;
      } else {
        this.connectionInfo.balance = undefined;  // clear stale balance
      }
    }

    const accountChangedEvent: AccountChangedEvent = {
      previousAddress,
      newAddress: data.address,
      publicKey: data.publicKey,
      balance: data.balance ?? this.connectionInfo.balance!
    };

    this.emit('accountChanged', accountChangedEvent);

    this.logger.log('Account changed:', { newAddress: accountChangedEvent.newAddress });
  }

  private handleNetworkChanged(data: { networkInfo: NetworkInfo }): void {
    const previousNetwork = this.connectionInfo.networkInfo;

    // validate networkInfo — drop invalid
    const networkInfo = validateNetworkInfo(data.networkInfo);
    if (!networkInfo) {
      this.logger.warn('Received invalid networkInfo in networkChanged event, ignoring');
      return;
    }
    this.connectionInfo.networkInfo = networkInfo;

    // invalidate balance on network change
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

    // Refresh balance after transaction confirmation
    setTimeout(() => {
      this.getBalance(true).catch(() => { });
    }, 2000);

    this.logger.log('Transaction confirmed:', data.txHash);
  }

  /**
   * Reject numeric amounts that cannot be represented exactly in micro-OCT.
   * e.g. 0.1 + 0.2 = 0.30000000000000004 — the extension would sign the wrong value.
   * String amounts bypass this check (caller is responsible for correctness).
   */
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
    ++this._sessionVersion;

    this.logger.log('SDK cleanup complete');
  }
}