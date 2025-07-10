const FyersOrderSocket = require("fyers-api-v3").fyersOrderSocket;
const User = require('../models/User');
const LoggerService = require('./loggerService');

class FyersWebSocketService {
  constructor() {
    this.fyersOrderSocket = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectInterval = 5000; // 5 seconds
    this.io = null;
    this.shouldReconnect = true; // Flag to control reconnection
    this.isConnecting = false; // Prevent multiple simultaneous connections
    this.connectionPromise = null; // Track ongoing connection attempts
  }

  /**
   * Get singleton instance
   */
  static getInstance() {
    if (!this.instance) {
      this.instance = new FyersWebSocketService();
    }
    return this.instance;
  }

  /**
   * Initialize the WebSocket service with Socket.IO instance
   * @param {Object} io - Socket.IO instance
   */
  initialize(io) {
    this.io = io;
    LoggerService.info('FyersWebSocketService', 'WebSocket service initialized');
  }

  /**
   * Start the WebSocket connection
   * @returns {Promise<boolean>} Success status
   */
  async startConnection() {
    // Prevent multiple simultaneous connection attempts
    if (this.isConnecting) {
      LoggerService.info('FyersWebSocketService', 'Connection already in progress, waiting...');
      return this.connectionPromise;
    }

    if (this.isConnected) {
      LoggerService.info('FyersWebSocketService', 'WebSocket already connected');
      return true;
    }

    try {
      this.isConnecting = true;
      this.connectionPromise = this._startConnectionInternal();
      return await this.connectionPromise;
    } finally {
      this.isConnecting = false;
      this.connectionPromise = null;
    }
  }

  /**
   * Internal connection method
   */
  async _startConnectionInternal() {
    try {
      // Check if WebSocket should be active before starting
      const shouldBeActive = await this.shouldBeActive();
      if (!shouldBeActive) {
        LoggerService.info('FyersWebSocketService', 'No active monitoring detected. WebSocket will not start.');
        return false;
      }

      // Find a user with a valid Fyers access token
      const user = await User.findOne({
        'fyers.connected': true,
        'fyers.accessToken': { $exists: true, $ne: null }
      });

      if (!user || !user.fyers || !user.fyers.accessToken) {
        LoggerService.warn('FyersWebSocketService', 'No user with valid Fyers access token found. WebSocket will not start.');
        return false;
      }

      const accessToken = user.fyers.accessToken;
      LoggerService.info('FyersWebSocketService', `Starting WebSocket with access token from user: ${user._id}`);

      this.shouldReconnect = true; // Enable reconnection
      return this.connectWithToken(accessToken);
    } catch (error) {
      LoggerService.error('FyersWebSocketService', 'Error starting WebSocket connection:', error);
      return false;
    }
  }

  /**
   * Connect to Fyers WebSocket with a specific access token
   */
  connectWithToken(accessToken) {
    if (!accessToken) {
      LoggerService.error('FyersWebSocketService', 'No access token provided for WebSocket connection');
      return false;
    }

    if (this.fyersOrderSocket) {
      LoggerService.info('FyersWebSocketService', 'WebSocket already running, disconnecting first');
      this.disconnect();
    }

    try {
      LoggerService.info('FyersWebSocketService', 'Creating new Fyers WebSocket connection...');
      
      // Ensure token is in correct format (appId:accessToken)
      let formattedToken = accessToken;
      if (!accessToken.includes(':')) {
        // If token doesn't contain ':', add the app ID
        const appId = process.env.FYERS_APP_ID || 'XJFL311ATX-100';
        formattedToken = `${appId}:${accessToken}`;
        LoggerService.info('FyersWebSocketService', `Formatted token with app ID: ${appId}`);
      }
      
      this.fyersOrderSocket = new FyersOrderSocket(formattedToken);

      this.fyersOrderSocket.on('connect', () => {
        LoggerService.success('FyersWebSocketService', 'Fyers order WebSocket connected successfully');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        
        // Subscribe to order updates, trades, and positions
        try {
          this.fyersOrderSocket.subscribe([
            this.fyersOrderSocket.orderUpdates,
            this.fyersOrderSocket.tradeUpdates,
            this.fyersOrderSocket.positionUpdates
          ]);
          LoggerService.info('FyersWebSocketService', 'Subscribed to order, trade, and position updates');
        } catch (subscribeError) {
          LoggerService.error('FyersWebSocketService', 'Error subscribing to updates:', subscribeError);
        }
      });

      this.fyersOrderSocket.on('orders', async (msg) => {
        // Broadcast order updates to all connected clients
        if (msg && msg.orders && this.io) {
          this.io.emit('orderUpdate', msg.orders);
          LoggerService.debug('FyersWebSocketService', 'Order update sent to clients:', msg.orders);
          
          // Process order status updates for monitoring
          try {
            await this.processOrderStatusUpdates(msg.orders);
          } catch (error) {
            LoggerService.error('FyersWebSocketService', 'Error processing order status updates:', error);
          }
        }
      });

      // Add position updates handler
      this.fyersOrderSocket.on('positions', async (msg) => {
        LoggerService.info('FyersWebSocketService', 'Position update received from Fyers:', msg);
        
        if (msg && msg.positions && this.io) {
          this.io.emit('positionUpdate', msg.positions);
          LoggerService.debug('FyersWebSocketService', 'Position update sent to clients:', msg.positions);
          
          // Process position updates for monitoring
          try {
            await this.processPositionUpdates(msg.positions);
          } catch (error) {
            LoggerService.error('FyersWebSocketService', 'Error processing position updates:', error);
          }
        }
      });

      // Add trade updates handler
      this.fyersOrderSocket.on('trades', async (msg) => {
        LoggerService.info('FyersWebSocketService', 'Trade update received from Fyers:', msg);
        
        if (msg && msg.trades && this.io) {
          this.io.emit('tradeUpdate', msg.trades);
          LoggerService.debug('FyersWebSocketService', 'Trade update sent to clients:', msg.trades);
          
          // Process trade updates for monitoring
          try {
            await this.processTradeUpdates(msg.trades);
          } catch (error) {
            LoggerService.error('FyersWebSocketService', 'Error processing trade updates:', error);
          }
        }
      });

      this.fyersOrderSocket.on('error', (err) => {
        LoggerService.error('FyersWebSocketService', 'WebSocket error:', err);
        this.isConnected = false;
        
        // Handle specific error types
        if (err.message && err.message.includes('403')) {
          LoggerService.error('FyersWebSocketService', '403 Forbidden - Token may be invalid or expired');
          this.shouldReconnect = false; // Stop reconnection for 403 errors
        } else if (err.message && err.message.includes('401')) {
          LoggerService.error('FyersWebSocketService', '401 Unauthorized - Token authentication failed');
          this.shouldReconnect = false; // Stop reconnection for 401 errors
        }
      });

      this.fyersOrderSocket.on('close', () => {
        LoggerService.warn('FyersWebSocketService', 'WebSocket closed. Attempting to reconnect...');
        this.isConnected = false;
        this.handleReconnect();
      });

      // Enable auto-reconnect only if shouldReconnect is true
      try {
        if (this.shouldReconnect) {
        this.fyersOrderSocket.autoreconnect(6);
        }
        this.fyersOrderSocket.connect();
        LoggerService.info('FyersWebSocketService', 'WebSocket connection initiated');
      } catch (connectError) {
        LoggerService.error('FyersWebSocketService', 'Error initiating WebSocket connection:', connectError);
        return false;
      }

      return true;
    } catch (error) {
      LoggerService.error('FyersWebSocketService', 'Error creating WebSocket connection:', error);
      return false;
    }
  }

  /**
   * Handle reconnection logic
   */
  async handleReconnect() {
    // Check if reconnection should be attempted
    if (!this.shouldReconnect) {
      LoggerService.info('FyersWebSocketService', 'Reconnection disabled - no active monitoring');
      return;
    }

    // Check if WebSocket should still be active
    const shouldBeActive = await this.shouldBeActive();
    if (!shouldBeActive) {
      LoggerService.info('FyersWebSocketService', 'No active monitoring detected. Stopping reconnection attempts.');
      this.shouldReconnect = false;
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      LoggerService.error('FyersWebSocketService', 'Max reconnection attempts reached. Stopping reconnection.');
      this.shouldReconnect = false;
      return;
    }

    this.reconnectAttempts++;
    LoggerService.info('FyersWebSocketService', `Reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);

    setTimeout(async () => {
      // Check again before attempting reconnection
      if (!this.shouldReconnect) {
        LoggerService.info('FyersWebSocketService', 'Reconnection disabled during timeout');
        return;
      }

      try {
        // Try to get a fresh access token from the database
        const user = await User.findOne({
          'fyers.connected': true,
          'fyers.accessToken': { $exists: true, $ne: null }
        });

        if (user && user.fyers && user.fyers.accessToken) {
          LoggerService.info('FyersWebSocketService', 'Attempting reconnection with fresh token');
          this.connectWithToken(user.fyers.accessToken);
        } else {
          LoggerService.warn('FyersWebSocketService', 'No valid access token found for reconnection');
        }
      } catch (error) {
        LoggerService.error('FyersWebSocketService', 'Error during reconnection:', error);
      }
    }, this.reconnectInterval);
  }

  /**
   * Disconnect the WebSocket
   */
  disconnect() {
    this.shouldReconnect = false; // Disable reconnection
    if (this.fyersOrderSocket) {
      try {
        this.fyersOrderSocket.disconnect();
        this.fyersOrderSocket = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        LoggerService.info('FyersWebSocketService', 'WebSocket disconnected');
      } catch (error) {
        LoggerService.error('FyersWebSocketService', 'Error disconnecting WebSocket:', error);
      }
    }
  }

  /**
   * Stop reconnection attempts (called when monitoring stops)
   */
  stopReconnection() {
    this.shouldReconnect = false;
    LoggerService.info('FyersWebSocketService', 'Reconnection attempts stopped');
  }

  /**
   * Get connection status
   */
  getConnectionStatus() {
    return {
      isConnected: this.isConnected,
      reconnectAttempts: this.reconnectAttempts,
      maxReconnectAttempts: this.maxReconnectAttempts,
      shouldReconnect: this.shouldReconnect
    };
  }

  /**
   * Check if WebSocket should be active based on monitoring status
   * Only start when there's active monitoring or active positions
   */
  async shouldBeActive() {
    try {
      const TradingState = require('../models/TradingState');
      
      // Check for active monitoring (most important - if monitoring is on, we need WebSocket)
      const activeMonitoring = await TradingState.findOne({
        'tradeExecutionState.isMonitoring': true
      });
      
      if (activeMonitoring) {
        LoggerService.debug('FyersWebSocketService', 'WebSocket should be active: Active monitoring detected');
        return true;
      }
      
      // Check for active positions (need WebSocket to track position updates)
      const activePositions = await TradingState.findOne({
        'activePositions': { $exists: true, $ne: [] }
      });
      
      if (activePositions) {
        LoggerService.debug('FyersWebSocketService', 'WebSocket should be active: Active positions detected');
        return true;
      }
      
      // Check for pending orders (need WebSocket to track order status)
      const pendingOrders = await TradingState.findOne({
        'monitoredSymbols.orderId': { $exists: true, $ne: null }
      });
      
      if (pendingOrders) {
        LoggerService.debug('FyersWebSocketService', 'WebSocket should be active: Pending orders detected');
        return true;
      }
      
      // No active monitoring, positions, or pending orders - WebSocket not needed
      LoggerService.debug('FyersWebSocketService', 'WebSocket should NOT be active: No monitoring, positions, or pending orders');
      return false;
    } catch (error) {
      LoggerService.error('FyersWebSocketService', 'Error checking if WebSocket should be active:', error);
      return false;
    }
  }

  /**
   * Restart the WebSocket connection (useful when a user updates their token)
   */
  async restart() {
    LoggerService.info('FyersWebSocketService', 'Restarting WebSocket connection');
    this.disconnect();
    return await this.startConnection();
  }

  /**
   * Process order status updates and notify monitoring service
   * @param {Array|Object} orders - Array of order updates from Fyers or single order object
   */
  async processOrderStatusUpdates(orders) {
    try {
      const { MonitoringService } = require('./monitoringService');
      const TradingState = require('../models/TradingState');
      const TradeLog = require('../models/TradeLog');
      
      // Ensure orders is always an array
      const ordersArray = Array.isArray(orders) ? orders : [orders];
      
      for (const order of ordersArray) {
        if (!order.id || !order.status) {
          continue;
        }
        
        LoggerService.debug('FyersWebSocketService', `Processing order status update: ${order.id} -> ${order.status}`);
        
        // Extract remarks and other details from Fyers order
        const fyersRemarks = order.remarks || order.message || order.rejectionReason || '';
        const fyersOrderStatus = order.status;
        const fyersOrderId = order.id;
        
        // Update existing trade logs with Fyers remarks (don't create new ones)
        try {
          const updatedLogs = await TradeLog.updateMany(
            { orderId: order.id },
            {
              $set: {
                fyersOrderStatus: fyersOrderStatus,
                fyersRemarks: fyersRemarks,
                status: this.mapFyersStatusToTradeLogStatus(fyersOrderStatus),
                remarks: fyersRemarks || this.getDefaultRemarks(fyersOrderStatus)
              }
            }
          );
          
          if (updatedLogs.modifiedCount > 0) {
            LoggerService.info('FyersWebSocketService', `Updated ${updatedLogs.modifiedCount} trade logs with Fyers remarks for order ${order.id}`);
          } else {
            LoggerService.warn('FyersWebSocketService', `No existing trade log found for order ${order.id} - will be created by monitoring service`);
          }
        } catch (logError) {
          LoggerService.error('FyersWebSocketService', 'Error updating trade logs with Fyers remarks:', logError);
        }
        
        // Find all users who might have this order
        const states = await TradingState.find({
          'monitoredSymbols.orderId': order.id
        });
        
        for (const state of states) {
          const symbol = state.monitoredSymbols.find(s => s.orderId === order.id);
          if (symbol) {
            LoggerService.info('FyersWebSocketService', `Updating order status for ${symbol.symbol}: ${order.status} - Remarks: ${fyersRemarks}`);
            // Pass tradedPrice to monitoring service if FILLED
            if (this.mapFyersStatusToTradeLogStatus(order.status) === 'FILLED' && order.tradedPrice) {
              await MonitoringService.handleOrderStatusUpdate(order.id, order.status, state.userId, fyersRemarks, order.tradedPrice);
            } else {
              await MonitoringService.handleOrderStatusUpdate(order.id, order.status, state.userId, fyersRemarks);
            }
          }
        }
      }
    } catch (error) {
      LoggerService.error('FyersWebSocketService', 'Error processing order status updates:', error);
    }
  }

  /**
   * Map Fyers order status to TradeLog status
   * @param {string|number} fyersStatus - Fyers order status (can be string or number)
   * @returns {string} TradeLog status
   */
  mapFyersStatusToTradeLogStatus(fyersStatus) {
    // Handle numeric status codes from Fyers API
    // Fyers Status Codes: 1=Cancelled, 2=Traded/Filled, 3=For future use, 4=Transit, 5=Rejected, 6=Pending
    const numericStatusMap = {
      1: 'CANCELLED',
      2: 'FILLED',
      3: 'PENDING', // For future use
      4: 'PENDING', // Transit
      5: 'REJECTED',
      6: 'PENDING'
    };
    
    // Handle string statuses
    const stringStatusMap = {
      'FILLED': 'FILLED',
      'REJECTED': 'REJECTED',
      'CANCELLED': 'CANCELLED',
      'PENDING': 'PENDING',
      'PARTIALLY_FILLED': 'PARTIALLY_FILLED',
      'MODIFIED': 'MODIFIED',
      'TRANSIT': 'PENDING'
    };
    
    // Check if it's a numeric status
    if (typeof fyersStatus === 'number') {
      return numericStatusMap[fyersStatus] || 'PENDING';
    }
    
    // Check if it's a string status
    return stringStatusMap[fyersStatus] || 'PENDING';
  }

  /**
   * Get default remarks based on order status
   * @param {string} status - Order status
   * @returns {string} Default remarks
   */
  getDefaultRemarks(status) {
    const remarksMap = {
      'FILLED': 'Order executed successfully',
      'REJECTED': 'Order rejected by exchange',
      'CANCELLED': 'Order cancelled',
      'PENDING': 'Order pending execution',
      'PARTIALLY_FILLED': 'Order partially filled',
      'MODIFIED': 'Order modified'
    };
    
    return remarksMap[status] || 'Order status updated';
  }

  /**
   * Process position updates from Fyers and sync with app positions
   * @param {Array|Object} positions - Array of position updates from Fyers or single position object
   */
  async processPositionUpdates(positions) {
    try {
      const { MonitoringService } = require('./monitoringService');
      const TradingState = require('../models/TradingState');
      const User = require('../models/User');
      
      // Ensure positions is always an array
      const positionsArray = Array.isArray(positions) ? positions : [positions];
      
      LoggerService.info('FyersWebSocketService', `Processing ${positionsArray.length} position updates from Fyers`);
      
      // Get all users with active monitoring
      const users = await User.find({
        'fyers.connected': true,
        'fyers.accessToken': { $exists: true, $ne: null }
      });
      
      for (const user of users) {
        try {
          const state = await TradingState.findOne({ userId: user._id });
          if (!state) continue;
          
          // Sync Fyers positions with app positions
          await this.syncFyersPositionsWithApp(user._id, positionsArray, state);
        } catch (userError) {
          LoggerService.error('FyersWebSocketService', `Error processing positions for user ${user._id}:`, userError);
        }
      }
    } catch (error) {
      LoggerService.error('FyersWebSocketService', 'Error processing position updates:', error);
    }
  }

  /**
   * Sync Fyers positions with app positions
   * @param {string} userId - User ID
   * @param {Array} fyersPositions - Array of Fyers positions
   * @param {Object} state - Trading state
   */
  async syncFyersPositionsWithApp(userId, fyersPositions, state) {
    try {
      const { MonitoringService } = require('./monitoringService');
      
      for (const fyersPosition of fyersPositions) {
        if (!fyersPosition.symbol || !fyersPosition.netQty || fyersPosition.netQty === 0) {
          continue; // Skip positions with no quantity
        }
        
        LoggerService.info('FyersWebSocketService', `Syncing Fyers position: ${fyersPosition.symbol} - Qty: ${fyersPosition.netQty}, Avg: ${fyersPosition.netAvg}`);
        
        // Check if this position exists in app's active positions
        const existingPosition = state.activePositions.find(p => p.symbol === fyersPosition.symbol);
        
        if (existingPosition) {
          // Update existing position with real Fyers data
          await TradingState.updateOne(
            { userId, 'activePositions.symbol': fyersPosition.symbol },
            {
              $set: {
                'activePositions.$.currentPrice': fyersPosition.netAvg,
                'activePositions.$.boughtPrice': fyersPosition.netAvg, // Use Fyers avg price
                'activePositions.$.quantity': Math.abs(fyersPosition.netQty),
                'activePositions.$.pnl': fyersPosition.unrealized_profit || 0,
                'activePositions.$.pnlPercentage': fyersPosition.unrealized_profit ? 
                  (fyersPosition.unrealized_profit / (Math.abs(fyersPosition.netQty) * fyersPosition.netAvg)) * 100 : 0,
                'activePositions.$.lastUpdate': new Date()
              }
            }
          );
          
          LoggerService.info('FyersWebSocketService', `Updated existing position for ${fyersPosition.symbol} with Fyers data`);
        } else {
          // Create new position from Fyers data
          const newPosition = {
            id: `${fyersPosition.symbol}-${Date.now()}`,
            symbol: fyersPosition.symbol,
            type: fyersPosition.netQty > 0 ? 'LONG' : 'SHORT',
            lots: Math.floor(Math.abs(fyersPosition.netQty) / 75), // Assuming 75 lot size
            quantity: Math.abs(fyersPosition.netQty),
            boughtPrice: fyersPosition.netAvg,
            currentPrice: fyersPosition.netAvg,
            target: fyersPosition.netAvg + 50, // Default target
            stopLoss: fyersPosition.netAvg - 30, // Default stop loss
            initialStopLoss: fyersPosition.netAvg - 30,
            useTrailingStoploss: false,
            trailingX: 20,
            trailingY: 15,
            status: 'Active',
            timestamp: new Date(),
            tradingMode: 'LIVE',
            orderType: 'MARKET',
            productType: fyersPosition.productType || 'INTRADAY',
            buyOrderId: null,
            sellOrderId: null,
            slOrder: null,
            reEntryCount: 0,
            pnl: fyersPosition.unrealized_profit || 0,
            pnlPercentage: fyersPosition.unrealized_profit ? 
              (fyersPosition.unrealized_profit / (Math.abs(fyersPosition.netQty) * fyersPosition.netAvg)) * 100 : 0,
            hmaValue: fyersPosition.netAvg,
            index: { name: 'NIFTY', lotSize: 75 },
            slStopPrice: null,
            slModifications: [],
            invested: Math.abs(fyersPosition.netQty) * fyersPosition.netAvg,
            source: 'FYERS_SYNC' // Mark as synced from Fyers
          };
          
          await TradingState.updateOne(
            { userId },
            { $push: { activePositions: newPosition } }
          );
          
          LoggerService.info('FyersWebSocketService', `Created new position for ${fyersPosition.symbol} from Fyers data`);
        }
      }
    } catch (error) {
      LoggerService.error('FyersWebSocketService', 'Error syncing Fyers positions with app:', error);
    }
  }

  /**
   * Process trade updates from Fyers
   * @param {Array|Object} trades - Array of trade updates from Fyers or single trade object
   */
  async processTradeUpdates(trades) {
    try {
      const { MonitoringService } = require('./monitoringService');
      const TradingState = require('../models/TradingState');
      const TradeLog = require('../models/TradeLog');
      
      // Ensure trades is always an array
      const tradesArray = Array.isArray(trades) ? trades : [trades];
      
      LoggerService.info('FyersWebSocketService', `Processing ${tradesArray.length} trade updates from Fyers`);
      
      for (const trade of tradesArray) {
        if (!trade.symbol || !trade.tradedQty) {
          continue;
        }
        
        LoggerService.info('FyersWebSocketService', `Trade executed: ${trade.symbol} - Qty: ${trade.tradedQty}, Price: ${trade.tradePrice}`);
        
        // Update trade logs with Fyers trade data
        try {
          const updatedLogs = await TradeLog.updateMany(
            { 
              symbol: trade.symbol,
              orderNumber: trade.orderNumber,
              status: { $in: ['PENDING', 'PARTIALLY_FILLED'] }
            },
            {
              $set: {
                status: 'FILLED',
                fillPrice: trade.tradePrice,
                fillQuantity: trade.tradedQty,
                fillTime: new Date(trade.orderDateTime),
                fyersTradeNumber: trade.tradeNumber,
                fyersTradePrice: trade.tradePrice,
                fyersTradeQty: trade.tradedQty,
                remarks: `Filled at ${trade.tradePrice} via Fyers`
              }
            }
          );
          
          if (updatedLogs.modifiedCount > 0) {
            LoggerService.info('FyersWebSocketService', `Updated ${updatedLogs.modifiedCount} trade logs with Fyers trade data`);
          }
        } catch (logError) {
          LoggerService.error('FyersWebSocketService', 'Error updating trade logs with Fyers trade data:', logError);
        }
      }
    } catch (error) {
      LoggerService.error('FyersWebSocketService', 'Error processing trade updates:', error);
    }
  }

  /**
   * Manually sync positions from Fyers API
   * @param {string} userId - User ID to sync positions for
   * @returns {Promise<Object>} Sync result
   */
  async syncPositionsFromFyersAPI(userId) {
    try {
      const User = require('../models/User');
      const TradingState = require('../models/TradingState');
      const axios = require('axios');
      
      // Get user with Fyers token
      const user = await User.findById(userId);
      if (!user || !user.fyers || !user.fyers.accessToken) {
        throw new Error('No valid Fyers access token found');
      }
      
      // Get positions from Fyers API
      const accessToken = user.fyers.accessToken;
      const appId = process.env.FYERS_APP_ID || 'XJFL311ATX-100';
      const formattedToken = accessToken.includes(':') ? accessToken : `${appId}:${accessToken}`;
      
      const response = await axios.get('https://api.fyers.in/api/v2/positions', {
        headers: {
          'Authorization': formattedToken
        }
      });
      
      if (response.data && response.data.s === 'ok' && response.data.positions) {
        LoggerService.info('FyersWebSocketService', `Retrieved ${response.data.positions.length} positions from Fyers API`);
        
        const state = await TradingState.findOne({ userId });
        if (state) {
          await this.syncFyersPositionsWithApp(userId, response.data.positions, state);
          return { success: true, positionsCount: response.data.positions.length };
        }
      } else {
        LoggerService.warn('FyersWebSocketService', 'No positions found in Fyers API response');
        return { success: true, positionsCount: 0 };
      }
    } catch (error) {
      LoggerService.error('FyersWebSocketService', 'Error syncing positions from Fyers API:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Periodic check to ensure WebSocket is only active when needed
   * This method is deprecated - WebSocket management is now handled by monitoring service
   */
  async periodicStatusCheck() {
    LoggerService.info('FyersWebSocketService', 'Periodic status check deprecated - WebSocket management handled by monitoring service');
  }
}

// Create a singleton instance
const fyersWebSocketService = FyersWebSocketService.getInstance();

module.exports = { fyersWebSocketService }; 