const FyersOrderSocket = require("fyers-api-v3").fyersOrderSocket;
const axios = require('axios');
const { TradeLogService } = require('./tradeLogService');

class OrderWebSocketService {
  constructor() {
    this.connections = new Map(); // userId -> socket connection
    this.orderCallbacks = new Map(); // orderId -> callback functions
  }

  /**
   * Initialize WebSocket connection for a user
   * @param {string} userId - User ID
   * @param {string} accessToken - Fyers access token
   * @returns {Promise<boolean>} Connection success
   */
  async initializeConnection(userId, accessToken) {
    try {
      // Close existing connection if any
      if (this.connections.has(userId)) {
        await this.closeConnection(userId);
      }

      // Ensure token is in correct format (appId:accessToken)
      let formattedToken = accessToken;
      if (!accessToken.includes(':')) {
        // If token doesn't contain ':', add the app ID
        const appId = process.env.FYERS_APP_ID || 'XJFL311ATX-100';
        formattedToken = `${appId}:${accessToken}`;
        console.log(`[OrderWebSocketService] Formatted token with app ID: ${appId}`);
      }

      const fyersOrderdata = new FyersOrderSocket(formattedToken);

      // Set up event handlers
      fyersOrderdata.on("error", (errmsg) => {
        console.error(`WebSocket Error for user ${userId}:`, errmsg);
        
        // Handle specific error types
        if (errmsg.message && errmsg.message.includes('403')) {
          console.error(`[OrderWebSocketService] 403 Forbidden for user ${userId} - Token may be invalid or expired`);
          // Stop reconnection for 403 errors
          this.connections.delete(userId);
        } else if (errmsg.message && errmsg.message.includes('401')) {
          console.error(`[OrderWebSocketService] 401 Unauthorized for user ${userId} - Token authentication failed`);
          // Stop reconnection for 401 errors
          this.connections.delete(userId);
        }
      });

      fyersOrderdata.on('connect', () => {
        console.log(`✅ WebSocket connected for user ${userId}`);
        fyersOrderdata.subscribe([fyersOrderdata.orderUpdates]);
      });

      fyersOrderdata.on('close', () => {
        console.log(`❌ WebSocket closed for user ${userId}`);
        this.connections.delete(userId);
      });

      // Handle order updates
      fyersOrderdata.on('orders', (msg) => {
        this.handleOrderUpdate(userId, msg);
      });

      // Enable auto-reconnect
      fyersOrderdata.autoreconnect(10); // Try 10 times
      fyersOrderdata.connect();

      this.connections.set(userId, fyersOrderdata);
      return true;
    } catch (error) {
      console.error(`Error initializing WebSocket for user ${userId}:`, error);
      return false;
    }
  }

  /**
   * Handle incoming order updates
   * @param {string} userId - User ID
   * @param {Object} msg - Order update message
   */
  async handleOrderUpdate(userId, msg) {
    try {
      if (!msg.orders) return;

      const order = msg.orders;
      console.log(`📡 Order update for user ${userId}:`, {
        orderId: order.id,
        symbol: order.symbol,
        status: order.status,
        filledQty: order.filledQty,
        tradedPrice: order.tradedPrice,
        type: order.type // 1=Limit, 2=Market, 3=SL-M, 4=SL-L
      });

      // Map Fyers status codes to our status
      // Fyers Status Codes:
      // 1 = Cancelled, 2 = Traded/Filled, 3 = For future use, 4 = Transit, 5 = Rejected, 6 = Pending
      const statusMap = {
        1: 'CANCELLED',
        2: 'FILLED',
        3: 'UNKNOWN', // For future use
        4: 'TRANSIT',
        5: 'REJECTED',
        6: 'PENDING'
      };

      const orderStatus = statusMap[order.status] || 'UNKNOWN';

      // Check if this is a SL-M order (type 3)
      const isSLOrder = order.type === 3;

      if (isSLOrder) {
        // Handle SL-M order updates
        await this.handleSLOrderUpdate(userId, order, orderStatus);
      } else {
        // Handle regular order updates
        await this.updateOrderStatus(userId, order.id, orderStatus, {
          filledQty: order.filledQty,
          tradedPrice: order.tradedPrice,
          remainingQty: order.remainingQuantity,
          message: order.message
        });

        // Log order status updates
        if (orderStatus === 'FILLED') {
          await TradeLogService.logOrderFilled({
            userId: userId,
            symbol: order.symbol,
            orderId: order.id,
            filledPrice: order.tradedPrice,
            filledQuantity: order.filledQty,
            orderType: order.type === 1 ? 'LIMIT' : order.type === 2 ? 'MARKET' : 'SL-M',
            reason: 'ENTRY',
            source: 'FYERS'
          });
        } else if (orderStatus === 'REJECTED') {
          await TradeLogService.logOrderRejected({
            userId: userId,
            symbol: order.symbol,
            orderId: order.id,
            orderType: order.type === 1 ? 'LIMIT' : order.type === 2 ? 'MARKET' : 'SL-M',
            quantity: order.filledQty || 0,
            price: order.tradedPrice || 0,
            reason: 'SL',
            errorMessage: order.message,
            source: 'FYERS'
          });
        }

        // If order is filled, place SL-M order immediately
        if (orderStatus === 'FILLED') {
          await this.placeStopLossForFilledOrder(userId, order);
        }
      }

    } catch (error) {
      console.error(`Error handling order update for user ${userId}:`, error);
    }
  }

  /**
   * Handle SL-M order status updates
   * @param {string} userId - User ID
   * @param {Object} order - SL order data
   * @param {string} status - Order status
   */
  async handleSLOrderUpdate(userId, order, status) {
    try {
      const TradingState = require('../models/TradingState');
      const state = await TradingState.findOne({ userId });

      if (!state || !state.activePositions) return;

      // Find the position with this SL order ID
      const position = state.activePositions.find(p => p.slOrderId === order.id);
      if (!position) return;

      console.log(`🛡️ SL-M order update for ${position.symbol}: ${status} (Type: ${order.type})`);

      if (status === 'FILLED') {
        if (order.type === 3) {
          // SL-M order was executed - stop loss hit
          position.status = 'Stop Loss Hit';
          position.orderStatus = 'SL_EXECUTED';
          console.log(`🛡️ SL-M order executed for ${position.symbol} - stop loss hit`);
          
          // Log stop loss hit
          await TradeLogService.logStopLossHit({
            userId: userId,
            symbol: position.symbol,
            entryPrice: position.boughtPrice,
            stopLossPrice: position.stopLoss,
            exitPrice: order.tradedPrice || position.stopLoss,
            quantity: position.quantity,
            pnl: position.pnl || 0,
            orderId: order.id,
            source: 'FYERS'
          });
        } else if (order.type === 2) {
          // Modified to market order was executed - target hit
          position.status = 'Target Hit';
          position.orderStatus = 'TARGET_EXECUTED';
          console.log(`🎯 Market order executed for ${position.symbol} - target hit`);
          
          // Log target hit
          await TradeLogService.logTargetHit({
            userId: userId,
            symbol: position.symbol,
            entryPrice: position.boughtPrice,
            targetPrice: position.target,
            exitPrice: order.tradedPrice || position.target,
            quantity: position.quantity,
            pnl: position.pnl || 0,
            orderId: order.id,
            source: 'FYERS'
          });
        }
      } else if (status === 'CANCELLED') {
        // SL-M order was cancelled
        position.slOrderId = null;
        position.slStopPrice = null;
        console.log(`❌ SL-M order cancelled for ${position.symbol}`);
      } else if (status === 'REJECTED') {
        // SL-M order was rejected - log error
        console.error(`❌ SL-M order rejected for ${position.symbol}: ${order.message}`);
        
        // Log SL-M order rejection
        await TradeLogService.logOrderRejected({
          userId: userId,
          symbol: position.symbol,
          orderType: 'SL-M',
          orderId: order.id,
          quantity: order.filledQty || 0,
          price: order.tradedPrice || 0,
          reason: 'SL',
          errorMessage: order.message,
          source: 'FYERS'
        });
      }

      await state.save();

    } catch (error) {
      console.error(`Error handling SL order update for user ${userId}:`, error);
    }
  }

  /**
   * Place SL-M order for a filled position
   * @param {string} userId - User ID
   * @param {Object} order - Filled order data
   */
  async placeStopLossForFilledOrder(userId, order) {
    try {
      const TradingState = require('../models/TradingState');
      const state = await TradingState.findOne({ userId });

      if (!state || !state.activePositions) return;

      // Find the position that was just filled
      const position = state.activePositions.find(p => p.orderId === order.id);
      if (!position) return;

      // Place SL-M order
      const slResult = await this.placeStopLossOrder(position, userId);
      
      if (slResult.success) {
        // Update position with SL order details
        position.slOrderId = slResult.orderId;
        position.slStopPrice = slResult.stopPrice;
        position.slOrder = {
          orderId: slResult.orderId,
          stopPrice: slResult.stopPrice,
          status: 'ACTIVE'
        };

        await state.save();
        console.log(`🛡️ SL-M order placed for filled position ${position.symbol}`);
        
        // Log SL-M order placement
        await TradeLogService.logOrderPlaced({
          userId: userId,
          symbol: position.symbol,
          orderType: 'SL-M',
          quantity: position.quantity,
          price: slResult.stopPrice,
          side: 'SELL',
          productType: position.productType || 'INTRADAY',
          orderId: slResult.orderId,
          status: 'PENDING',
          reason: 'SL',
          source: 'FYERS'
        });
      } else {
        console.error(`❌ Failed to place SL-M order for ${position.symbol}:`, slResult.error);
        
        // Log SL-M order rejection
        await TradeLogService.logOrderRejected({
          userId: userId,
          symbol: position.symbol,
          orderType: 'SL-M',
          orderId: null,
          quantity: position.quantity,
          price: position.stopLoss,
          reason: 'SL',
          errorMessage: slResult.error,
          source: 'FYERS'
        });
      }

    } catch (error) {
      console.error(`Error placing SL-M order for filled position:`, error);
    }
  }

  /**
   * Update order status in monitoring service
   * @param {string} userId - User ID
   * @param {string} orderId - Fyers order ID
   * @param {string} status - Order status
   * @param {Object} details - Additional order details
   */
  async updateOrderStatus(userId, orderId, status, details) {
    try {
      const TradingState = require('../models/TradingState');
      const state = await TradingState.findOne({ userId });

      if (!state || !state.activePositions) return;

      // Find the position with this order ID
      const position = state.activePositions.find(p => p.orderId === orderId);
      if (!position) return;

      // Update position status based on order status
      if (status === 'FILLED') {
        position.status = 'Active';
        position.orderStatus = 'FILLED';
        position.boughtPrice = details.tradedPrice || position.boughtPrice;
        console.log(`✅ Order ${orderId} filled for ${position.symbol} at ${position.boughtPrice}`);
        
        // Reset order placement flag in monitored symbols to allow re-entries
        const monitoredSymbol = state.monitoredSymbols.find(s => s.symbol === position.symbol && s.type === position.type);
        if (monitoredSymbol) {
          monitoredSymbol.orderPlaced = false;
          monitoredSymbol.orderPlacedAt = null;
          console.log(`🔄 Reset order placement flag for ${position.symbol} to allow re-entries`);
        }
      } else if (status === 'CANCELLED' || status === 'REJECTED') {
        position.status = 'Closed';
        position.orderStatus = status;
        console.log(`❌ Order ${orderId} ${status.toLowerCase()} for ${position.symbol}`);
        
        // Reset order placement flag in monitored symbols to allow retry
        const monitoredSymbol = state.monitoredSymbols.find(s => s.symbol === position.symbol && s.type === position.type);
        if (monitoredSymbol) {
          monitoredSymbol.orderPlaced = false;
          monitoredSymbol.orderPlacedAt = null;
          console.log(`🔄 Reset order placement flag for ${position.symbol} to allow retry`);
        }
      } else if (status === 'PENDING') {
        position.status = 'Pending';
        position.orderStatus = 'PENDING';
      }

      // Update additional details
      if (details.filledQty !== undefined) {
        position.filledQty = details.filledQty;
      }
      if (details.remainingQty !== undefined) {
        position.remainingQty = details.remainingQty;
      }

      await state.save();
      console.log(`📊 Updated order status for ${position.symbol}: ${status}`);

    } catch (error) {
      console.error(`Error updating order status for user ${userId}:`, error);
    }
  }

  /**
   * Close WebSocket connection for a user
   * @param {string} userId - User ID
   */
  async closeConnection(userId) {
    try {
      const connection = this.connections.get(userId);
      if (connection) {
        connection.close();
        this.connections.delete(userId);
        console.log(`🔌 WebSocket connection closed for user ${userId}`);
      }
    } catch (error) {
      console.error(`Error closing WebSocket for user ${userId}:`, error);
    }
  }

  /**
   * Close all WebSocket connections
   */
  async closeAllConnections() {
    try {
      for (const [userId, connection] of this.connections) {
        connection.close();
      }
      this.connections.clear();
      console.log('🔌 All WebSocket connections closed');
    } catch (error) {
      console.error('Error closing all WebSocket connections:', error);
    }
  }

  /**
   * Get connection status for a user
   * @param {string} userId - User ID
   * @returns {boolean} Connection status
   */
  isConnected(userId) {
    return this.connections.has(userId);
  }

  /**
   * Place SL-M order for stop loss
   * @param {Object} position - Position data
   * @param {string} userId - User ID
   * @returns {Promise<Object>} SL order result
   */
  async placeStopLossOrder(position, userId) {
    try {
      const User = require('../models/User');
      const user = await User.findById(userId);
      
      if (!user || !user.fyers || !user.fyers.accessToken) {
        throw new Error('No valid Fyers access token found');
      }

      // Construct the proper access token format (appId:token)
      const appIdFromEnv = process.env.FYERS_APP_ID || 'XJFL311ATX-100';
      const fullAccessToken = `${appIdFromEnv}:${user.fyers.accessToken}`;

      // Calculate stop loss price (opposite side of the position)
      const stopPrice = position.type === 'BUY' ? 
        position.stopLoss : // For long positions, SL below entry
        position.stopLoss;   // For short positions, SL above entry

      // Round stop price to nearest tick size (0.0500)
      const roundToTickSize = (price, tickSize = 0.05) => {
        return Math.round(price / tickSize) * tickSize;
      };
      
      const roundedStopPrice = roundToTickSize(stopPrice);

      const orderData = {
        symbol: position.symbol,
        qty: position.quantity,
        type: 3, // SL-M order
        side: position.type === 'BUY' ? -1 : 1, // Opposite side for exit
        productType: position.productType || 'INTRADAY',
        limitPrice: 0, // Market order when triggered
        stopPrice: roundedStopPrice, // Use rounded stop price
        disclosedQty: 0,
        validity: 'DAY',
        offlineOrder: false, // SL-M orders are not offline orders
        stopLoss: 0,
        takeProfit: 0,
        orderTag: `VICTORYSL${Date.now()}` // Add validation parameter - alphanumeric only
      };

      console.log(`🛡️ [SL-M ORDER] Placing SL-M order:`, orderData);

      // Use Fyers API library instead of direct HTTP calls
      const FyersAPI = require("fyers-api-v3").fyersModel;
      const fyers = new FyersAPI();
      
      // Extract appId from accessToken (format is "appId:token")
      const [appId, token] = fullAccessToken.split(':');
      
      if (!appId || !token) {
        throw new Error('Invalid access token format - expected appId:token');
      }
      
      fyers.setAppId(appId);
      fyers.setAccessToken(token);
      
      // Use the Fyers API library to place order
      const response = await fyers.place_order(orderData);

      console.log(`📡 [SL-M API] Response:`, response);

      if (response.s === 'ok') {
        console.log(`🛡️ SL-M order placed for ${position.symbol} at ${roundedStopPrice}`);
        return {
          success: true,
          orderId: response.id,
          stopPrice: roundedStopPrice
        };
      } else {
        throw new Error(`SL-M order failed: ${response.message}`);
      }
    } catch (error) {
      console.error(`Error placing SL-M order for ${position.symbol}:`, error);
      
      // Handle specific Fyers API errors
      if (error.response) {
        const errorData = error.response.data;
        if (errorData.code === -392) {
          throw new Error('Price should be in multiples of tick size');
        } else if (errorData.code === -50) {
          throw new Error('StopLoss not a multiple of tick size');
        } else if (errorData.code === -201) {
          throw new Error('Insufficient funds');
        } else if (errorData.code === -202) {
          throw new Error('Market closed');
        } else if (errorData.code === -203) {
          throw new Error('Invalid symbol');
        } else {
          throw new Error(`Fyers API error (${errorData.code}): ${errorData.message || 'Unknown error'}`);
        }
      } else if (error.code === 'ECONNABORTED') {
        throw new Error('Request timeout - please try again');
      } else {
        throw new Error(`Network error: ${error.message}`);
      }
    }
  }

  /**
   * Modify existing SL-M order for trailing stop loss
   * @param {string} orderId - SL order ID
   * @param {number} newStopPrice - New stop price
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Modification result
   */
  async modifyStopLossOrder(orderId, newStopPrice, userId) {
    try {
      const User = require('../models/User');
      const user = await User.findById(userId);
      
      if (!user || !user.fyers || !user.fyers.accessToken) {
        throw new Error('No valid Fyers access token found');
      }

      // Construct the proper access token format (appId:token)
      const appIdFromEnv = process.env.FYERS_APP_ID || 'XJFL311ATX-100';
      const fullAccessToken = `${appIdFromEnv}:${user.fyers.accessToken}`;

      // Round new stop price to nearest tick size (0.0500)
      const roundToTickSize = (price, tickSize = 0.05) => {
        return Math.round(price / tickSize) * tickSize;
      };
      
      const roundedNewStopPrice = roundToTickSize(newStopPrice);

      const modifyData = {
        id: orderId,
        stopPrice: roundedNewStopPrice
      };

      console.log(`📈 [MODIFY SL] Modifying SL-M order:`, modifyData);

      // Use Fyers API library instead of direct HTTP calls
      const FyersAPI = require("fyers-api-v3").fyersModel;
      const fyers = new FyersAPI();
      
      // Extract appId from accessToken (format is "appId:token")
      const [appId, token] = fullAccessToken.split(':');
      
      if (!appId || !token) {
        throw new Error('Invalid access token format - expected appId:token');
      }
      
      fyers.setAppId(appId);
      fyers.setAccessToken(token);
      
      // Use the Fyers API library to modify order
      const response = await fyers.modify_order(modifyData);

      console.log(`📡 [MODIFY SL API] Response:`, response);

      if (response.s === 'ok') {
        console.log(`📈 SL-M order modified for ${orderId}: ${roundedNewStopPrice}`);
        
        // Log SL-M order modification
        await TradeLogService.logOrderModified({
          userId: userId,
          symbol: 'N/A', // Will be updated when we get the position details
          orderId: orderId,
          orderType: 'SL-M',
          modificationType: 'SL_MODIFIED',
          changes: {
            from: 'SL-M',
            to: 'SL-M',
            reason: 'TRAILING_STOP'
          },
          reason: 'TRAILING_STOP',
          source: 'FYERS'
        });
        
        return { success: true };
      } else {
        throw new Error(`SL-M modification failed: ${response.data.message}`);
      }
    } catch (error) {
      console.error(`Error modifying SL-M order ${orderId}:`, error);
      
      // Handle specific Fyers API errors
      if (error.response) {
        const errorData = error.response.data;
        if (errorData.code === -392) {
          throw new Error('Price should be in multiples of tick size');
        } else if (errorData.code === -50) {
          throw new Error('StopLoss not a multiple of tick size');
        } else if (errorData.code === -201) {
          throw new Error('Insufficient funds');
        } else if (errorData.code === -202) {
          throw new Error('Market closed');
        } else if (errorData.code === -203) {
          throw new Error('Invalid symbol');
        } else {
          throw new Error(`Fyers API error (${errorData.code}): ${errorData.message || 'Unknown error'}`);
        }
      } else if (error.code === 'ECONNABORTED') {
        throw new Error('Request timeout - please try again');
      } else {
        throw new Error(`Network error: ${error.message}`);
      }
    }
  }

  /**
   * Cancel SL-M order
   * @param {string} orderId - SL order ID
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Cancellation result
   */
  async cancelStopLossOrder(orderId, userId) {
    try {
      const User = require('../models/User');
      const user = await User.findById(userId);
      
      if (!user || !user.fyers || !user.fyers.accessToken) {
        throw new Error('No valid Fyers access token found');
      }

      console.log(`❌ [CANCEL SL] Cancelling SL-M order: ${orderId}`);

      // Construct the proper access token format (appId:token)
      const appIdFromEnv = process.env.FYERS_APP_ID || 'XJFL311ATX-100';
      const fullAccessToken = `${appIdFromEnv}:${user.fyers.accessToken}`;

      // Use Fyers API library instead of direct HTTP calls
      const FyersAPI = require("fyers-api-v3").fyersModel;
      const fyers = new FyersAPI();
      
      // Extract appId from accessToken (format is "appId:token")
      const [appId, token] = fullAccessToken.split(':');
      
      if (!appId || !token) {
        throw new Error('Invalid access token format - expected appId:token');
      }
      
      fyers.setAppId(appId);
      fyers.setAccessToken(token);
      
      // Use the Fyers API library to cancel order
      const response = await fyers.cancel_order({ id: orderId });

      console.log(`📡 [CANCEL SL API] Response:`, response);

      if (response.s === 'ok') {
        console.log(`❌ SL-M order cancelled: ${orderId}`);
        return { success: true };
      } else {
        throw new Error(`SL-M cancellation failed: ${response.data.message}`);
      }
    } catch (error) {
      console.error(`Error cancelling SL-M order ${orderId}:`, error);
      
      // Handle specific Fyers API errors
      if (error.response) {
        const errorData = error.response.data;
        if (errorData.code === -201) {
          throw new Error('Insufficient funds');
        } else if (errorData.code === -202) {
          throw new Error('Market closed');
        } else if (errorData.code === -203) {
          throw new Error('Invalid symbol');
        } else {
          throw new Error(`Fyers API error (${errorData.code}): ${errorData.message || 'Unknown error'}`);
        }
      } else if (error.code === 'ECONNABORTED') {
        throw new Error('Request timeout - please try again');
      } else {
        throw new Error(`Network error: ${error.message}`);
      }
    }
  }

  /**
   * Check if WebSocket connection should be active
   */
  async checkConnectionActive(userId) {
    // Implementation needed
  }

  /**
   * Modify SL-L order (Stop Limit Order)
   * @param {string} orderId - SL-L order ID
   * @param {number} limitPrice - New limit price
   * @param {number} stopPrice - New trigger price
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Modification result
   */
  async modifySLLOrder(orderId, limitPrice, stopPrice, userId) {
    try {
      const User = require('../models/User');
      const user = await User.findById(userId);
      
      if (!user || !user.fyers || !user.fyers.accessToken) {
        throw new Error('No valid Fyers access token found');
      }

      // Round prices to tick size
      const roundToTickSize = (price, tickSize = 0.05) => {
        return Math.round(price / tickSize) * tickSize;
      };
      
      const roundedLimitPrice = roundToTickSize(limitPrice);
      const roundedStopPrice = roundToTickSize(stopPrice);

      // Modify SL-L order
      const modifyData = {
        id: orderId,
        type: 4, // SL-L order type
        limitPrice: roundedLimitPrice,
        stopPrice: roundedStopPrice
      };

      console.log(`🔄 [MODIFY SL-L] Modifying SL-L order:`, modifyData);

      // Use Fyers API library instead of direct HTTP calls
      const FyersAPI = require("fyers-api-v3").fyersModel;
      const fyers = new FyersAPI();
      
      // Extract appId from accessToken (format is "appId:token")
      const appIdFromEnv = process.env.FYERS_APP_ID || 'XJFL311ATX-100';
      const fullAccessToken = `${appIdFromEnv}:${user.fyers.accessToken}`;
      const [appId, token] = fullAccessToken.split(':');
      
      if (!appId || !token) {
        throw new Error('Invalid access token format - expected appId:token');
      }
      
      fyers.setAppId(appId);
      fyers.setAccessToken(token);
      
      // Use the Fyers API library to modify order
      const response = await fyers.modify_order(modifyData);

      console.log(`📡 [MODIFY SL-L API] Response:`, response);

      if (response.s === 'ok') {
        console.log(`🔄 SL-L order modified successfully: ${orderId}`);
        return { success: true };
      } else {
        throw new Error(`SL-L modification failed: ${response.message}`);
      }
    } catch (error) {
      console.error(`Error modifying SL-L order ${orderId}:`, error);
      
      // Handle specific Fyers API errors
      if (error.response) {
        const errorData = error.response.data;
        if (errorData.code === -392) {
          throw new Error('Price should be in multiples of tick size');
        } else if (errorData.code === -50) {
          throw new Error('StopLoss not a multiple of tick size');
        } else if (errorData.code === -201) {
          throw new Error('Insufficient funds');
        } else if (errorData.code === -202) {
          throw new Error('Market closed');
        } else if (errorData.code === -203) {
          throw new Error('Invalid symbol');
        } else {
          throw new Error(`Fyers API error (${errorData.code}): ${errorData.message || 'Unknown error'}`);
        }
      } else if (error.code === 'ECONNABORTED') {
        throw new Error('Request timeout - please try again');
      } else {
        throw new Error(`Network error: ${error.message}`);
      }
    }
  }

  /**
   * Modify SL-M order to market order for target exit
   * @param {string} orderId - SL order ID
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Modification result
   */
  async modifySLToMarketOrder(orderId, userId) {
    try {
      const User = require('../models/User');
      const user = await User.findById(userId);
      
      if (!user || !user.fyers || !user.fyers.accessToken) {
        throw new Error('No valid Fyers access token found');
      }

      // Construct the proper access token format (appId:token)
      const appIdFromEnv = process.env.FYERS_APP_ID || 'XJFL311ATX-100';
      const fullAccessToken = `${appIdFromEnv}:${user.fyers.accessToken}`;

      // Modify SL-M order to market order (type 2) for immediate exit
      const modifyData = {
        id: orderId,
        type: 2, // Change from SL-M (type 3) to Market (type 2)
        stopPrice: 0, // Remove stop price since it's now a market order
        limitPrice: 0 // Market order
      };

      console.log(`🎯 [SL TO MARKET] Modifying SL-M to market order:`, modifyData);

      // Use Fyers API library instead of direct HTTP calls
      const FyersAPI = require("fyers-api-v3").fyersModel;
      const fyers = new FyersAPI();
      
      // Extract appId from accessToken (format is "appId:token")
      const [appId, token] = fullAccessToken.split(':');
      
      if (!appId || !token) {
        throw new Error('Invalid access token format - expected appId:token');
      }
      
      fyers.setAppId(appId);
      fyers.setAccessToken(token);
      
      // Use the Fyers API library to modify order
      const response = await fyers.modify_order(modifyData);

      console.log(`📡 [SL TO MARKET API] Response:`, response);

      if (response.s === 'ok') {
        console.log(`🎯 Target hit - SL-M order modified to market order for ${orderId}`);
        
        // Log SL-M to market modification
        await TradeLogService.logOrderModified({
          userId: userId,
          symbol: 'N/A', // Will be updated when we get the position details
          orderId: orderId,
          orderType: 'SL-M',
          modificationType: 'SL_TO_MARKET',
          changes: {
            from: 'SL-M',
            to: 'MARKET',
            reason: 'TARGET_HIT'
          },
          reason: 'TARGET',
          source: 'FYERS'
        });
        
        return { success: true };
      } else {
        throw new Error(`SL-M to market modification failed: ${response.message}`);
      }
    } catch (error) {
      console.error(`Error modifying SL-M to market order ${orderId}:`, error);
      
      // Handle specific Fyers API errors
      if (error.response) {
        const errorData = error.response.data;
        if (errorData.code === -392) {
          throw new Error('Price should be in multiples of tick size');
        } else if (errorData.code === -50) {
          throw new Error('StopLoss not a multiple of tick size');
        } else if (errorData.code === -201) {
          throw new Error('Insufficient funds');
        } else if (errorData.code === -202) {
          throw new Error('Market closed');
        } else if (errorData.code === -203) {
          throw new Error('Invalid symbol');
        } else {
          throw new Error(`Fyers API error (${errorData.code}): ${errorData.message || 'Unknown error'}`);
        }
      } else if (error.code === 'ECONNABORTED') {
        throw new Error('Request timeout - please try again');
      } else {
        throw new Error(`Network error: ${error.message}`);
      }
    }
  }
}

module.exports = { OrderWebSocketService };