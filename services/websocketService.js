/**
 * WebSocket Service
 * Handles real-time data communication with clients
 */
const WebSocket = require('ws');
const { TradeService } = require('./tradeService');

class WebSocketService {
  constructor(server) {
    this.wss = new WebSocket.Server({ server });
    this.clients = new Map(); // Map of client connections: userId -> WebSocket
    this.subscriptions = new Map(); // Map of user subscriptions: userId -> Set of symbols
    this.fyersOrderSockets = new Map(); // Map of user Fyers order sockets: userId -> FyersOrderSocket
    
    this.initialize();
  }
  
  /**
   * Initialize WebSocket server
   */
  initialize() {
    this.wss.on('connection', (ws, req) => {
      console.log('[WebSocketService] New client connected');
      
      // Set initial state
      ws.isAlive = true;
      
      // Handle authentication
      ws.on('message', (message) => {
        try {
          // Try to parse as JSON, but handle binary data or invalid JSON gracefully
          let data;
          
          if (typeof message === 'string') {
            data = JSON.parse(message);
          } else if (Buffer.isBuffer(message)) {
            // Try to convert buffer to string and parse
            try {
              const stringMessage = message.toString('utf8');
              data = JSON.parse(stringMessage);
            } catch (err) {
              console.error('[WebSocketService] Error parsing binary message:', err);
              return this.sendError(ws, 'Invalid binary message format');
            }
          } else {
            console.error('[WebSocketService] Unknown message type:', typeof message);
            return this.sendError(ws, 'Unknown message type');
          }
          
          if (data.type === 'auth') {
            this.handleAuth(ws, data);
          } else if (data.type === 'subscribe') {
            this.handleSubscribe(ws, data);
          } else if (data.type === 'unsubscribe') {
            this.handleUnsubscribe(ws, data);
          } else if (data.type === 'ping') {
            this.handlePing(ws);
          }
        } catch (error) {
          console.error('[WebSocketService] Error handling message:', error);
          this.sendError(ws, 'Invalid message format');
        }
      });
      
      // Handle errors
      ws.on('error', (error) => {
        console.error('[WebSocketService] WebSocket error:', error);
        // Don't terminate the connection here, let the error event handler deal with it
      });
      
      // Handle pong messages to keep track of connection status
      ws.on('pong', () => {
        ws.isAlive = true;
      });
      
      // Handle disconnection
      ws.on('close', () => {
        console.log('[WebSocketService] Client disconnected');
        this.handleDisconnect(ws);
      });
      
      // Send welcome message
      this.safeSend(ws, {
        type: 'welcome',
        message: 'Connected to Victory WebSocket server'
      });
    });
    
    // Handle server errors
    this.wss.on('error', (error) => {
      console.error('[WebSocketService] WebSocket server error:', error);
    });
    
    // Start heartbeat to keep connections alive
    this.heartbeatInterval = setInterval(() => {
      this.wss.clients.forEach((client) => {
        if (client.isAlive === false) {
          console.log('[WebSocketService] Terminating inactive client');
          return client.terminate();
        }
        
        client.isAlive = false;
        
        try {
          client.ping();
        } catch (error) {
          console.error('[WebSocketService] Error sending ping:', error);
          client.terminate();
        }
      });
    }, 30000);
    
    console.log('[WebSocketService] WebSocket server initialized');
  }
  
  /**
   * Handle authentication
   * @param {WebSocket} ws - WebSocket connection
   * @param {Object} data - Authentication data
   */
  handleAuth(ws, data) {
    const { token } = data;
    
    if (!token) {
      return this.sendError(ws, 'Missing token');
    }
    
    try {
      // Decode the JWT to get the userId
      const jwt = require('jsonwebtoken');
      const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production';
      
      const decoded = jwt.verify(token, JWT_SECRET);
      const userId = decoded.userId; // This is the MongoDB ObjectId
      
      if (!userId) {
        console.error('[WebSocketService] JWT payload missing userId:', decoded);
        return this.sendError(ws, 'Invalid token: missing userId');
      }
      
      ws.userId = userId;
      ws.isAlive = true;
      
      // Store client connection
      this.clients.set(userId, ws);
      
      // Initialize subscriptions for this user
      if (!this.subscriptions.has(userId)) {
        this.subscriptions.set(userId, new Set());
      }
      
      console.log(`[WebSocketService] User ${userId} authenticated successfully`);
      
      // Send authentication success
      this.safeSend(ws, {
        type: 'auth',
        success: true,
        message: 'Authentication successful'
      });
      
      // Send any existing trading state
      this.sendTradingState(userId);
      
      // Initialize Fyers order WebSocket for this user
      this.initializeFyersOrderSocket(userId);
      
    } catch (error) {
      console.error('[WebSocketService] JWT verification failed:', error.message);
      return this.sendError(ws, 'Invalid token');
    }
  }
  
  /**
   * Handle subscription request
   * @param {WebSocket} ws - WebSocket connection
   * @param {Object} data - Subscription data
   */
  handleSubscribe(ws, data) {
    const { symbols } = data;
    const userId = ws.userId;
    
    if (!userId) {
      return this.sendError(ws, 'Not authenticated');
    }
    
    if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
      return this.sendError(ws, 'Invalid symbols');
    }
    
    // Get user's subscriptions
    const userSubscriptions = this.subscriptions.get(userId) || new Set();
    
    // Add new symbols
    symbols.forEach(symbol => userSubscriptions.add(symbol));
    
    // Update subscriptions
    this.subscriptions.set(userId, userSubscriptions);
    
    console.log(`[WebSocketService] User ${userId} subscribed to ${symbols.join(', ')}`);
    
    // Import MarketService here to avoid circular dependency
    const { MarketService } = require('./marketService');
    
    // Subscribe to market data if MarketService is available
    if (MarketService && typeof MarketService.subscribeToSymbols === 'function') {
      MarketService.subscribeToSymbols(symbols, userId).catch(err => {
        console.error('[WebSocketService] Error subscribing to symbols:', err);
      });
    }
  }
  
  /**
   * Handle unsubscribe request
   * @param {WebSocket} ws - WebSocket connection
   * @param {Object} data - Unsubscribe data
   */
  handleUnsubscribe(ws, data) {
    const { symbols } = data;
    const userId = ws.userId;
    
    if (!userId) {
      return this.sendError(ws, 'Not authenticated');
    }
    
    const userSubscriptions = this.subscriptions.get(userId);
    
    if (!userSubscriptions) {
      return;
    }
    
    // Import MarketService here to avoid circular dependency
    const { MarketService } = require('./marketService');
    
    if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
      // Unsubscribe from all
      userSubscriptions.clear();
      
      // Unsubscribe from market data if MarketService is available
      if (MarketService && typeof MarketService.unsubscribeFromAllSymbols === 'function') {
        MarketService.unsubscribeFromAllSymbols(userId).catch(err => {
          console.error('[WebSocketService] Error unsubscribing from all symbols:', err);
        });
      }
    } else {
      // Unsubscribe from specific symbols
      symbols.forEach(symbol => userSubscriptions.delete(symbol));
      
      // Unsubscribe from market data if MarketService is available
      if (MarketService && typeof MarketService.unsubscribeFromSymbols === 'function') {
        MarketService.unsubscribeFromSymbols(symbols, userId).catch(err => {
          console.error('[WebSocketService] Error unsubscribing from symbols:', err);
        });
      }
    }
    
    console.log(`[WebSocketService] User ${userId} unsubscribed from ${symbols ? symbols.join(', ') : 'all symbols'}`);
    
    // Send unsubscribe confirmation
    this.safeSend(ws, {
      type: 'unsubscribe',
      success: true,
      symbols: symbols || []
    });
  }
  
  /**
   * Handle ping request
   * @param {WebSocket} ws - WebSocket connection
   */
  handlePing(ws) {
    ws.isAlive = true;
    this.safeSend(ws, {
      type: 'pong',
      timestamp: Date.now()
    });
  }
  
  /**
   * Handle client disconnection
   * @param {WebSocket} ws - WebSocket connection
   */
  handleDisconnect(ws) {
    const userId = ws.userId;
    
    if (userId) {
      // Remove client connection
      this.clients.delete(userId);
      
      // Close Fyers order socket for this user
      const fyersSocket = this.fyersOrderSockets.get(userId);
      if (fyersSocket) {
        try {
          fyersSocket.close();
          this.fyersOrderSockets.delete(userId);
          console.log(`[WebSocketService] Closed Fyers order socket for user ${userId}`);
        } catch (error) {
          console.error(`[WebSocketService] Error closing Fyers order socket for user ${userId}:`, error);
        }
      }
      
      // Don't remove subscriptions in case the user reconnects
      // We'll keep the subscriptions active for a while
      
      console.log(`[WebSocketService] User ${userId} disconnected`);
    }
  }
  
  /**
   * Send error message to client
   * @param {WebSocket} ws - WebSocket connection
   * @param {string} message - Error message
   */
  sendError(ws, message) {
    this.safeSend(ws, {
      type: 'error',
      message
    });
  }
  
  /**
   * Send data to client safely
   * @param {WebSocket} ws - WebSocket connection
   * @param {Object} data - Data to send
   */
  safeSend(ws, data) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }
    
    try {
      ws.send(JSON.stringify(data));
    } catch (error) {
      console.error('[WebSocketService] Error sending data:', error);
    }
  }
  
  /**
   * Send market data to subscribed clients
   * @param {string} symbol - Symbol
   * @param {Object} data - Market data
   */
  sendMarketData(symbol, data) {
    // Find all users subscribed to this symbol
    for (const [userId, subscriptions] of this.subscriptions.entries()) {
      if (subscriptions.has(symbol)) {
        const ws = this.clients.get(userId);
        
        if (ws && ws.readyState === WebSocket.OPEN) {
          this.safeSend(ws, {
            type: 'marketData',
            data: [data] // Send as array to match frontend expectation
          });
        }
      }
    }
  }
  
  /**
   * Send trading state to a user
   * @param {string} userId - User ID
   */
  async sendTradingState(userId) {
    const ws = this.clients.get(userId);
    
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }
    
    try {
      const state = await TradeService.loadTradingState(userId);
      
      if (state) {
        this.safeSend(ws, {
          type: 'trading_state',
          state
        });
      }
    } catch (error) {
      console.error(`[WebSocketService] Error sending trading state to user ${userId}:`, error);
    }
  }
  
  /**
   * Send notification to a user
   * @param {string} userId - User ID
   * @param {Object} notification - Notification data
   */
  sendNotification(userId, notification) {
    const ws = this.clients.get(userId);
    
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }
    
    this.safeSend(ws, {
      type: 'notification',
      notification
    });
  }

  /**
   * Initialize Fyers order WebSocket for a specific user
   * @param {string} userId - User ID
   */
  async initializeFyersOrderSocket(userId) {
    try {
      // Check if already initialized for this user
      if (this.fyersOrderSockets.has(userId)) {
        console.log(`[WebSocketService] Fyers order socket already initialized for user ${userId}`);
        return;
      }

      // Get user from database
      const User = require('../models/User');
      const user = await User.findById(userId);
      
      if (!user || !user.fyers || !user.fyers.accessToken) {
        console.log(`[WebSocketService] No Fyers access token found for user ${userId}`);
        return;
      }

      // Ensure token is in correct format (appId:accessToken)
      let formattedToken = user.fyers.accessToken;
      if (!user.fyers.accessToken.includes(':')) {
        // If token doesn't contain ':', add the app ID
        const appId = process.env.FYERS_APP_ID || 'XJFL311ATX-100';
        formattedToken = `${appId}:${user.fyers.accessToken}`;
        console.log(`[WebSocketService] Formatted token with app ID: ${appId}`);
      }

      // Initialize Fyers order WebSocket
      const FyersOrderSocket = require("fyers-api-v3").fyersOrderSocket;
      const fyersOrderSocket = new FyersOrderSocket(formattedToken);

      fyersOrderSocket.on('connect', () => {
        console.log(`[WebSocketService] Fyers order WebSocket connected for user ${userId}`);
        fyersOrderSocket.subscribe([fyersOrderSocket.orderUpdates]);
      });

      fyersOrderSocket.on('orders', (msg) => {
        // Send order updates to the specific user
        if (msg && msg.orders) {
          this.sendOrderUpdate(userId, msg.orders);
          console.log(`[WebSocketService] Order update sent to user ${userId}:`, msg.orders);
        }
      });

      fyersOrderSocket.on('error', (err) => {
        console.error(`[WebSocketService] Fyers WebSocket error for user ${userId}:`, err);
        
        // Handle specific error types
        if (err.message && err.message.includes('403')) {
          console.error(`[WebSocketService] 403 Forbidden for user ${userId} - Token may be invalid or expired`);
          this.fyersOrderSockets.delete(userId);
        } else if (err.message && err.message.includes('401')) {
          console.error(`[WebSocketService] 401 Unauthorized for user ${userId} - Token authentication failed`);
          this.fyersOrderSockets.delete(userId);
        }
      });

      fyersOrderSocket.on('close', () => {
        console.warn(`[WebSocketService] Fyers order WebSocket closed for user ${userId}. Attempting to reconnect...`);
        fyersOrderSocket.autoreconnect(6);
        fyersOrderSocket.connect();
      });

      // Store the socket for this user
      this.fyersOrderSockets.set(userId, fyersOrderSocket);

      fyersOrderSocket.autoreconnect(6);
      fyersOrderSocket.connect();

    } catch (error) {
      console.error(`[WebSocketService] Error initializing Fyers order socket for user ${userId}:`, error);
    }
  }

  /**
   * Send order update to a specific user
   * @param {string} userId - User ID
   * @param {Object} orderData - Order update data
   */
  sendOrderUpdate(userId, orderData) {
    const ws = this.clients.get(userId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      this.safeSend(ws, {
        type: 'orderUpdate',
        data: orderData
      });
    }
  }

  /**
   * Send trade log update to a specific user
   * @param {string} userId - User ID
   * @param {Object} tradeLog - Trade log data
   */
  sendTradeLogUpdate(userId, tradeLog) {
    const ws = this.clients.get(userId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      this.safeSend(ws, {
        type: 'trade_log_update',
        data: tradeLog
      });
    }
  }
  
  /**
   * Broadcast message to all connected clients
   * @param {Object} message - Message to broadcast
   */
  broadcast(message) {
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        this.safeSend(client, message);
      }
    });
  }
  
  /**
   * Clean up resources when shutting down
   */
  cleanup() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    
    // Close all Fyers order sockets
    for (const [userId, fyersSocket] of this.fyersOrderSockets.entries()) {
      try {
        fyersSocket.close();
        console.log(`[WebSocketService] Closed Fyers order socket for user ${userId}`);
      } catch (error) {
        console.error(`[WebSocketService] Error closing Fyers order socket for user ${userId}:`, error);
      }
    }
    this.fyersOrderSockets.clear();
    
    if (this.wss) {
      this.wss.close();
    }
  }
  
  /**
   * Get instance of WebSocketService
   * @returns {WebSocketService} - WebSocketService instance
   */
  static getInstance() {
    return this.instance;
  }
  
  /**
   * Initialize WebSocketService with server
   * @param {http.Server} server - HTTP server
   * @returns {WebSocketService} - WebSocketService instance
   */
  static initialize(server) {
    if (!this.instance) {
      this.instance = new WebSocketService(server);
    }
    return this.instance;
  }
}

module.exports = { WebSocketService };
