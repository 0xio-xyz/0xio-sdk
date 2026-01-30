/**
 * 0xio Wallet SDK - Main Wallet Class
 * Primary interface for DApp developers to interact with 0xio Wallet
 */

import { EventEmitter } from './events';
import { ExtensionCommunicator } from './communication';
import {
  Balance,
  ConnectionInfo,
  ConnectOptions,
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
  BalanceChangedEvent,
  NetworkChangedEvent
} from './types';
import { getNetworkConfig, createDefaultBalance } from './config';
import { createLogger } from './utils';

export class ZeroXIOWallet extends EventEmitter {
  private communicator: ExtensionCommunicator;
  private config: SDKConfig;
  private connectionInfo: ConnectionInfo = { isConnected: false };
  private isInitialized = false;
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
    this.communicator = new ExtensionCommunicator(this.config.debug);

    this.logger.log('Wallet instance created with config:', this.config);
  }

  // ===================
  // INITIALIZATION
  // ===================

  /**
   * Initialize the SDK
   * Must be called before using any other methods
   */
  async initialize(): Promise<boolean> {
    if (this.isInitialized) {
      return true;
    }

    try {
      // Initialize extension communication
      const communicationReady = await this.communicator.initialize();
      if (!communicationReady) {
        throw new ZeroXIOWalletError(
          ErrorCode.EXTENSION_NOT_FOUND,
          'Failed to establish communication with 0xio Wallet extension'
        );
      }

      // Register this DApp with the extension
      await this.communicator.sendRequest('register_dapp', {
        appName: this.config.appName,
        appDescription: this.config.appDescription,
        appVersion: this.config.appVersion,
        appUrl: typeof window !== 'undefined' ? window.location.origin : undefined,
        appIcon: this.config.appIcon,
        requiredPermissions: this.config.requiredPermissions,
        networkId: this.config.networkId
      });

      // Setup event forwarding from extension
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
    }
  }

  /**
   * Check if SDK is initialized
   */
  isReady(): boolean {
    return this.isInitialized && this.communicator.isExtensionAvailable();
  }

  // ===================
  // CONNECTION MANAGEMENT
  // ===================

  /**
   * Connect to wallet
   */
  async connect(options: ConnectOptions = {}): Promise<ConnectEvent> {
    this.ensureInitialized();

    try {
      this.logger.log('Attempting to connect with options:', options);

      const result = await this.communicator.sendRequest('connect', {
        requestPermissions: options.requestPermissions || this.config.requiredPermissions,
        networkId: options.networkId || this.config.networkId
      });

      // Update connection info
      this.connectionInfo = {
        isConnected: true,
        address: result.address,
        publicKey: result.publicKey,
        balance: result.balance,
        networkInfo: result.networkInfo,
        connectedAt: Date.now()
      };

      const connectEvent: ConnectEvent = {
        address: result.address,
        publicKey: result.publicKey,
        balance: result.balance,
        networkInfo: result.networkInfo,
        permissions: result.permissions
      };

      // Emit connect event
      this.emit('connect', connectEvent);

      this.logger.log('Connected successfully:', connectEvent);

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
      const result = await this.communicator.sendRequest('getConnectionStatus');

      if (result.isConnected && result.address) {
        // Update internal state if we discover an existing connection
        const balanceInfo = createDefaultBalance(result.balance);
        const networkInfo = getNetworkConfig(this.config.networkId);

        this.connectionInfo = {
          isConnected: true,
          address: result.address,
          publicKey: result.publicKey,
          balance: balanceInfo,
          networkInfo,
          connectedAt: result.connectedAt || Date.now()
        };

        this.logger.log('Discovered existing connection:', this.connectionInfo);

        // Emit connect event to notify the wrapper
        const connectEvent: ConnectEvent = {
          address: result.address,
          balance: balanceInfo,
          networkInfo,
          permissions: result.permissions || []
        };

        this.emit('connect', connectEvent);
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

  // ===================
  // WALLET INFORMATION
  // ===================

  /**
   * Get current wallet address
   */
  getAddress(): string | null {
    return this.connectionInfo.address || null;
  }

  /**
   * Get current balance
   */
  async getBalance(forceRefresh = false): Promise<Balance> {
    this.ensureConnected();

    try {
      const address = this.getAddress();
      if (!address) {
        throw new Error('No address found');
      }

      // Fetch balance from extension (bypasses CORS, has access to private balance)
      let publicBalance = 0;
      let privateBalance = 0;

      const extResult = await this.communicator.sendRequest('getBalance', { forceRefresh });
      publicBalance = parseFloat(extResult.balance || '0');
      privateBalance = parseFloat(extResult.privateBalance || '0');

      this.logger.log('Balance fetched from extension:', { public: publicBalance, private: privateBalance });

      const result: Balance = {
        public: publicBalance,
        private: privateBalance,
        total: publicBalance + privateBalance,
        currency: 'OCT'
      };

      // Update cached balance
      if (this.connectionInfo.balance) {
        const previousBalance = this.connectionInfo.balance;
        this.connectionInfo.balance = result;

        // Emit balance changed event if different
        if (previousBalance.total !== result.total) {
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
      throw new ZeroXIOWalletError(
        ErrorCode.NETWORK_ERROR,
        'Failed to get balance',
        error
      );
    }
  }

  /**
   * Get network information
   */
  async getNetworkInfo(): Promise<NetworkInfo> {
    this.ensureInitialized();

    try {
      const result = await this.communicator.sendRequest('get_network_info');

      // Update cached network info
      if (this.connectionInfo.networkInfo) {
        const previousNetwork = this.connectionInfo.networkInfo;
        this.connectionInfo.networkInfo = result;

        // Emit network changed event if different
        if (previousNetwork.id !== result.id) {
          const networkChangedEvent: NetworkChangedEvent = {
            previousNetwork,
            newNetwork: result
          };

          this.emit('networkChanged', networkChangedEvent);
        }
      } else {
        this.connectionInfo.networkInfo = result;
      }

      return result;
    } catch (error) {
      throw new ZeroXIOWalletError(
        ErrorCode.NETWORK_ERROR,
        'Failed to get network info',
        error
      );
    }
  }

  // ===================
  // TRANSACTIONS
  // ===================

  /**
   * Send transaction
   */
  async sendTransaction(txData: TransactionData): Promise<TransactionResult> {
    this.ensureConnected();

    try {
      this.logger.log('Sending transaction:', txData);

      const result = await this.communicator.sendRequest('send_transaction', txData);

      this.logger.log('Transaction result:', result);

      // Refresh balance after successful transaction
      if (result.success) {
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

  // ===================
  // PRIVATE FEATURES
  // ===================

  /**
   * Get private balance information
   */
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
  async encryptBalance(amount: number): Promise<boolean> {
    this.ensureConnected();

    try {
      const result = await this.communicator.sendRequest('encrypt_balance', { amount });

      // Refresh balance after encryption
      setTimeout(() => {
        this.getBalance(true).catch(() => { });
      }, 1000);

      return result.success;
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
  async decryptBalance(amount: number): Promise<boolean> {
    this.ensureConnected();

    try {
      const result = await this.communicator.sendRequest('decrypt_balance', { amount });

      // Refresh balance after decryption
      setTimeout(() => {
        this.getBalance(true).catch(() => { });
      }, 1000);

      return result.success;
    } catch (error) {
      throw new ZeroXIOWalletError(
        ErrorCode.TRANSACTION_FAILED,
        'Failed to decrypt balance',
        error
      );
    }
  }

  /**
   * Send private transfer
   */
  async sendPrivateTransfer(transferData: PrivateTransferData): Promise<TransactionResult> {
    this.ensureConnected();

    try {
      const result = await this.communicator.sendRequest('send_private_transfer', transferData);

      // Refresh balance after transfer
      if (result.success) {
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
   * Get pending private transfers
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
   * Claim private transfer
   */
  async claimPrivateTransfer(transferId: string): Promise<TransactionResult> {
    this.ensureConnected();

    try {
      const result = await this.communicator.sendRequest('claim_private_transfer', {
        transferId
      });

      // Refresh balance after claiming
      if (result.success) {
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

  // ===================
  // MESSAGE SIGNING
  // ===================

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

  // ===================
  // PRIVATE METHODS
  // ===================

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
    // Listen for extension events through the communicator
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

    this.logger.log('Extension event listeners setup complete');
  }

  /**
   * Handle account changed event from extension
   */
  private handleAccountChanged(data: any): void {
    const previousAddress = this.connectionInfo.address;

    this.connectionInfo.address = data.address;
    if (data.balance) {
      this.connectionInfo.balance = data.balance;
    }

    const accountChangedEvent = {
      previousAddress,
      newAddress: data.address,
      balance: data.balance
    };

    this.emit('accountChanged', accountChangedEvent);

    this.logger.log('Account changed:', accountChangedEvent);
  }

  /**
   * Handle network changed event from extension
   */
  private handleNetworkChanged(data: any): void {
    const previousNetwork = this.connectionInfo.networkInfo;
    this.connectionInfo.networkInfo = data.networkInfo;

    const networkChangedEvent: NetworkChangedEvent = {
      previousNetwork,
      newNetwork: data.networkInfo
    };

    this.emit('networkChanged', networkChangedEvent);

    this.logger.log('Network changed:', networkChangedEvent);
  }

  /**
   * Handle balance changed event from extension
   */
  private handleBalanceChanged(data: any): void {
    const previousBalance = this.connectionInfo.balance;
    this.connectionInfo.balance = data.balance;

    const balanceChangedEvent: BalanceChangedEvent = {
      address: this.connectionInfo.address!,
      previousBalance,
      newBalance: data.balance
    };

    this.emit('balanceChanged', balanceChangedEvent);

    this.logger.log('Balance changed:', balanceChangedEvent);
  }

  /**
   * Handle extension locked event
   */
  private handleExtensionLocked(): void {
    this.connectionInfo = { isConnected: false };

    const disconnectEvent: DisconnectEvent = {
      reason: 'extension_locked'
    };

    this.emit('disconnect', disconnectEvent);

    this.logger.log('Extension locked - disconnected');
  }

  /**
   * Handle extension unlocked event
   */
  private handleExtensionUnlocked(): void {
    // Attempt to restore connection
    this.getConnectionStatus().catch(() => {
      this.logger.warn('Could not restore connection after unlock');
    });

    this.logger.log('Extension unlocked');
  }

  /**
   * Handle transaction confirmed event
   */
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

  // ===================
  // CLEANUP
  // ===================

  /**
   * Clean up SDK resources
   */
  cleanup(): void {
    this.communicator.cleanup();
    this.removeAllListeners();
    this.connectionInfo = { isConnected: false };
    this.isInitialized = false;

    this.logger.log('SDK cleanup complete');
  }
}