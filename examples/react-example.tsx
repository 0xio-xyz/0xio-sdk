/**
 * 0xio SDK - React Integration Example
 * Demonstrates how to integrate 0xio Wallet SDK with React applications
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  OctraWallet,
  createOctraWallet,
  Balance,
  TransactionResult,
  WalletEventType,
  ErrorCode,
  isErrorType
} from '@0xio/sdk';

// Types for our component state
interface WalletState {
  wallet: OctraWallet | null;
  isConnected: boolean;
  address: string;
  balance: Balance | null;
  networkName: string;
  isLoading: boolean;
  error: string | null;
}

// Transaction form data
interface TransactionForm {
  recipient: string;
  amount: string;
  message: string;
  feeLevel: 1 | 3;
}

// Main wallet integration component
const WalletIntegration: React.FC = () => {
  // Wallet state
  const [walletState, setWalletState] = useState<WalletState>({
    wallet: null,
    isConnected: false,
    address: '',
    balance: null,
    networkName: '',
    isLoading: true,
    error: null
  });

  // Transaction form state
  const [txForm, setTxForm] = useState<TransactionForm>({
    recipient: '',
    amount: '',
    message: '',
    feeLevel: 1
  });

  // Transaction status
  const [txStatus, setTxStatus] = useState<{
    isProcessing: boolean;
    lastResult: TransactionResult | null;
  }>({
    isProcessing: false,
    lastResult: null
  });

  // Refs for cleanup
  const walletRef = useRef<OctraWallet | null>(null);

  // Initialize wallet SDK
  useEffect(() => {
    let isComponentMounted = true;

    const initializeWallet = async () => {
      try {
        setWalletState(prev => ({ ...prev, isLoading: true, error: null }));

        // Create wallet instance
        const wallet = await createOctraWallet({
          appName: 'React DApp Example',
          appDescription: 'Example React application using 0xio SDK',
          debug: process.env.NODE_ENV === 'development',
          // Don't auto-connect - let user choose
          autoConnect: false
        });

        walletRef.current = wallet;

        // Setup event listeners
        setupEventListeners(wallet);

        // Check if already connected (from previous session)
        if (wallet.isConnected()) {
          const connectionInfo = wallet.getConnectionInfo();
          if (isComponentMounted) {
            setWalletState(prev => ({
              ...prev,
              wallet,
              isConnected: true,
              address: connectionInfo.address || '',
              balance: connectionInfo.balance || null,
              networkName: connectionInfo.networkInfo?.name || 'Unknown',
              isLoading: false
            }));
          }
        } else {
          if (isComponentMounted) {
            setWalletState(prev => ({
              ...prev,
              wallet,
              isLoading: false
            }));
          }
        }

      } catch (error) {
        console.error('Failed to initialize wallet:', error);
        if (isComponentMounted) {
          setWalletState(prev => ({
            ...prev,
            error: error instanceof Error ? error.message : 'Failed to initialize wallet',
            isLoading: false
          }));
        }
      }
    };

    initializeWallet();

    // Cleanup on unmount
    return () => {
      isComponentMounted = false;
      if (walletRef.current) {
        walletRef.current.cleanup();
      }
    };
  }, []);

  // Setup wallet event listeners
  const setupEventListeners = useCallback((wallet: OctraWallet) => {
    wallet.on('connect', (event) => {
      console.log('Wallet connected:', event);
      setWalletState(prev => ({
        ...prev,
        isConnected: true,
        address: event.address,
        balance: event.balance,
        networkName: event.networkInfo.name,
        error: null
      }));
    });

    wallet.on('disconnect', (event) => {
      console.log('Wallet disconnected:', event);
      setWalletState(prev => ({
        ...prev,
        isConnected: false,
        address: '',
        balance: null,
        networkName: '',
        error: null
      }));
    });

    wallet.on('balanceChanged', (event) => {
      console.log('Balance changed:', event);
      setWalletState(prev => ({
        ...prev,
        balance: event.newBalance
      }));
    });

    wallet.on('accountChanged', (event) => {
      console.log('Account changed:', event);
      setWalletState(prev => ({
        ...prev,
        address: event.newAddress,
        balance: event.balance
      }));
    });

    wallet.on('networkChanged', (event) => {
      console.log('Network changed:', event);
      setWalletState(prev => ({
        ...prev,
        networkName: event.newNetwork.name
      }));
    });

    wallet.on('error', (event) => {
      console.error('Wallet error:', event);
      setWalletState(prev => ({
        ...prev,
        error: event.message
      }));
    });
  }, []);

  // Connect to wallet
  const handleConnect = async () => {
    if (!walletState.wallet) return;

    try {
      setWalletState(prev => ({ ...prev, isLoading: true, error: null }));
      await walletState.wallet.connect({
        requestPermissions: ['read_balance', 'send_transactions']
      });
    } catch (error) {
      console.error('Connection failed:', error);
      let errorMessage = 'Failed to connect to wallet';


      if (isErrorType(error, ErrorCode.EXTENSION_NOT_FOUND)) {
        errorMessage = '0xio Wallet extension not found. Please install it first.';
      } else if (isErrorType(error, ErrorCode.USER_REJECTED)) {
        errorMessage = 'Connection was rejected. Please try again.';
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }
      
      setWalletState(prev => ({
        ...prev,
        error: errorMessage,
        isLoading: false
      }));
    }
  };

  // Disconnect from wallet
  const handleDisconnect = async () => {
    if (!walletState.wallet) return;

    try {
      await walletState.wallet.disconnect();
    } catch (error) {
      console.error('Disconnect failed:', error);
    }
  };

  // Refresh balance
  const handleRefreshBalance = async () => {
    if (!walletState.wallet || !walletState.isConnected) return;

    try {
      const balance = await walletState.wallet.getBalance(true);
      setWalletState(prev => ({ ...prev, balance }));
    } catch (error) {
      console.error('Failed to refresh balance:', error);
    }
  };

  // Handle transaction form changes
  const handleTxFormChange = (field: keyof TransactionForm, value: string | number) => {
    setTxForm(prev => ({
      ...prev,
      [field]: value
    }));
  };

  // Send transaction
  const handleSendTransaction = async () => {
    if (!walletState.wallet || !walletState.isConnected) return;

    const amount = parseFloat(txForm.amount);
    if (!txForm.recipient.trim() || !amount || amount <= 0) {
      setWalletState(prev => ({
        ...prev,
        error: 'Please fill in recipient address and valid amount'
      }));
      return;
    }

    try {
      setTxStatus(prev => ({ ...prev, isProcessing: true }));
      setWalletState(prev => ({ ...prev, error: null }));

      const result = await walletState.wallet.sendTransaction({
        to: txForm.recipient.trim(),
        amount: amount,
        message: txForm.message.trim() || undefined,
        feeLevel: txForm.feeLevel
      });

      setTxStatus(prev => ({
        ...prev,
        isProcessing: false,
        lastResult: result
      }));

      // Clear form on success
      if (result.success) {
        setTxForm({
          recipient: '',
          amount: '',
          message: '',
          feeLevel: 1
        });
      }

    } catch (error) {
      console.error('Transaction failed:', error);
      
      let errorMessage = 'Transaction failed';
      if (isErrorType(error, ErrorCode.INSUFFICIENT_BALANCE)) {
        errorMessage = 'Insufficient balance for this transaction';
      } else if (isErrorType(error, ErrorCode.INVALID_ADDRESS)) {
        errorMessage = 'Invalid recipient address';
      } else if (isErrorType(error, ErrorCode.USER_REJECTED)) {
        errorMessage = 'Transaction was rejected';
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }

      setWalletState(prev => ({ ...prev, error: errorMessage }));
      setTxStatus(prev => ({ ...prev, isProcessing: false }));
    }
  };

  // Render loading state
  if (walletState.isLoading && !walletState.wallet) {
    return (
      <div className="wallet-container">
        <div className="loading">
          <h2>Initializing 0xio SDK...</h2>
          <p>Please wait while we set up the wallet integration.</p>
        </div>
      </div>
    );
  }

  // Render error state
  if (walletState.error && !walletState.wallet) {
    return (
      <div className="wallet-container">
        <div className="error">
          <h2>SDK Initialization Failed</h2>
          <p>{walletState.error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="wallet-container">
      <h1>0xio Wallet Integration</h1>
      
      {/* Connection Status */}
      <div className={`status-card ${walletState.isConnected ? 'connected' : 'disconnected'}`}>
        <h3>Wallet Status</h3>
        {walletState.isConnected ? (
          <div>
            <p><strong>Address:</strong> <code>{walletState.address}</code></p>
            <p><strong>Balance:</strong> {walletState.balance?.total.toFixed(6) || '0'} OCT</p>
            <p><strong>Network:</strong> {walletState.networkName}</p>
            <div className="button-group">
              <button onClick={handleDisconnect} className="btn btn-warning">
                Disconnect
              </button>
              <button onClick={handleRefreshBalance} className="btn btn-secondary">
                Refresh Balance
              </button>
            </div>
          </div>
        ) : (
          <div>
            <p>Not connected to wallet</p>
            <button 
              onClick={handleConnect} 
              className="btn btn-primary"
              disabled={walletState.isLoading}
            >
              {walletState.isLoading ? 'Connecting...' : 'Connect Wallet'}
            </button>
          </div>
        )}
      </div>

      {/* Error Display */}
      {walletState.error && (
        <div className="error-card">
          <p>Error: {walletState.error}</p>
          <button 
            onClick={() => setWalletState(prev => ({ ...prev, error: null }))}
            className="btn btn-sm"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Transaction Section */}
      {walletState.isConnected && (
        <div className="transaction-section">
          <h3>Send Transaction</h3>
          
          <div className="form-group">
            <label htmlFor="recipient">Recipient Address:</label>
            <input
              type="text"
              id="recipient"
              value={txForm.recipient}
              onChange={(e) => handleTxFormChange('recipient', e.target.value)}
              placeholder="Enter recipient address"
              className="form-control"
            />
          </div>

          <div className="form-group">
            <label htmlFor="amount">Amount (OCT):</label>
            <input
              type="number"
              id="amount"
              step="0.000001"
              min="0"
              value={txForm.amount}
              onChange={(e) => handleTxFormChange('amount', e.target.value)}
              placeholder="0.000000"
              className="form-control"
            />
          </div>

          <div className="form-group">
            <label htmlFor="message">Message (Optional):</label>
            <input
              type="text"
              id="message"
              value={txForm.message}
              onChange={(e) => handleTxFormChange('message', e.target.value)}
              placeholder="Optional message"
              className="form-control"
              maxLength={280}
            />
          </div>

          <div className="form-group">
            <label htmlFor="fee-level">Fee Level:</label>
            <select
              id="fee-level"
              value={txForm.feeLevel}
              onChange={(e) => handleTxFormChange('feeLevel', parseInt(e.target.value) as 1 | 3)}
              className="form-control"
            >
              <option value={1}>Standard (1)</option>
              <option value={3}>Priority (3)</option>
            </select>
          </div>

          <button
            onClick={handleSendTransaction}
            disabled={txStatus.isProcessing || !txForm.recipient || !txForm.amount}
            className="btn btn-success"
          >
            {txStatus.isProcessing ? 'Sending...' : 'Send Transaction'}
          </button>

          {/* Transaction Result */}
          {txStatus.lastResult && (
            <div className={`transaction-result ${txStatus.lastResult.success ? 'success' : 'error'}`}>
              <h4>{txStatus.lastResult.success ? 'Transaction Sent' : 'Transaction Failed'}</h4>
              {txStatus.lastResult.success && (
                <p><strong>Hash:</strong> <code>{txStatus.lastResult.txHash}</code></p>
              )}
              <p><strong>Message:</strong> {txStatus.lastResult.message}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// CSS styles (in a real app, these would be in a CSS file)
const styles = `
.wallet-container {
  max-width: 800px;
  margin: 0 auto;
  padding: 20px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

.status-card {
  background: #f8f9fa;
  border: 1px solid #dee2e6;
  border-radius: 8px;
  padding: 20px;
  margin: 20px 0;
}

.status-card.connected {
  border-left: 4px solid #28a745;
  background: #d4edda;
}

.status-card.disconnected {
  border-left: 4px solid #ffc107;
  background: #fff3cd;
}

.error-card {
  background: #f8d7da;
  border: 1px solid #f5c6cb;
  border-radius: 8px;
  padding: 15px;
  margin: 15px 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.transaction-section {
  background: white;
  border: 1px solid #dee2e6;
  border-radius: 8px;
  padding: 20px;
  margin: 20px 0;
}

.form-group {
  margin-bottom: 15px;
}

.form-group label {
  display: block;
  margin-bottom: 5px;
  font-weight: 600;
}

.form-control {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #ced4da;
  border-radius: 4px;
  font-size: 14px;
}

.btn {
  padding: 10px 16px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  margin: 4px;
  transition: background-color 0.2s;
}

.btn-primary { background: #007bff; color: white; }
.btn-success { background: #28a745; color: white; }
.btn-warning { background: #ffc107; color: #212529; }
.btn-secondary { background: #6c757d; color: white; }
.btn-sm { padding: 6px 12px; font-size: 12px; }

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.button-group {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

.transaction-result {
  margin-top: 20px;
  padding: 15px;
  border-radius: 8px;
}

.transaction-result.success {
  background: #d4edda;
  border: 1px solid #c3e6cb;
}

.transaction-result.error {
  background: #f8d7da;
  border: 1px solid #f5c6cb;
}

.loading, .error {
  text-align: center;
  padding: 40px;
}

code {
  background: #e9ecef;
  padding: 2px 4px;
  border-radius: 3px;
  font-family: 'Monaco', 'Consolas', monospace;
  font-size: 12px;
}
`;

// Inject styles (in a real React app, you'd use CSS modules or styled-components)
if (typeof document !== 'undefined') {
  const styleSheet = document.createElement('style');
  styleSheet.textContent = styles;
  document.head.appendChild(styleSheet);
}

export default WalletIntegration;