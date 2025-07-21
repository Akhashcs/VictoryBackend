/**
 * Trade Service for backend
 * Migrated from frontend to handle trading operations without browser tab dependency
 */
const mongoose = require('mongoose');
const axios = require('axios');
const TradeLog = require('../models/TradeLog');
const TradingState = require('../models/TradingState');
const User = require('../models/User');

class TradeService {
  /**
   * Place a live trade via Fyers
   * @param {Object} tradeData - Trade data
   * @param {string} tradeData.symbol - Symbol to trade
   * @param {number} tradeData.quantity - Quantity to trade
   * @param {number} tradeData.price - Price to trade at
   * @param {string} tradeData.action - Action (BUY/SELL)
   * @param {string} tradeData.orderType - Order type (MARKET/LIMIT)
   * @param {string} tradeData.userId - User ID
   * @param {string} tradeData.fyersAccessToken - Fyers access token
   * @param {boolean} tradeData.offlineOrder - Whether this is an offline order (AMO)
   * @param {Object} tradeData.orderData - Complete order data for Fyers API
   * @returns {Promise<Object>} Trade log
   */
  static async placeLiveTrade(tradeData) {
    try {
      const { 
        symbol, 
        quantity, 
        price, 
        action = 'BUY', 
        orderType = 'MARKET', 
        userId,
        fyersAccessToken,
        offlineOrder = false,
        orderData = null
      } = tradeData;
      
      // Get user's Fyers access token if not provided
      let accessToken = fyersAccessToken;
      if (!accessToken) {
        const user = await User.findById(userId);
        if (!user || !user.fyers || !user.fyers.accessToken) {
          throw new Error('No valid Fyers access token found');
        }
        // Construct the proper access token format (appId:token)
        const appId = process.env.FYERS_APP_ID || 'XJFL311ATX-100';
        accessToken = `${appId}:${user.fyers.accessToken}`;
      }
      
      // Create trade log with correct enum values
      const tradeLog = new TradeLog({
        symbol,
        quantity,
        price,
        action: 'ORDER_PLACED', // Use correct enum value
        orderType,
        side: action, // Store BUY/SELL in side field
        tradeType: 'LIVE',
        status: 'PENDING',
        userId,
        remarks: `Order placed via Fyers API - ${orderType} ${action}`,
        fyersOrderId: null, // Will be updated after order placement
        fyersOrderStatus: 'PENDING',
        fyersRemarks: 'Order submitted to exchange'
      });
      
      // Prepare order data according to Fyers API documentation
      let fyersOrderData;
      
      if (orderData) {
        // Use provided order data (for offline orders)
        console.log(`🔍 [DEBUG] Using provided orderData:`, orderData);
        
        // Validate and fix order data for market orders
        if (orderType === 'MARKET') {
          if (orderData.type !== 2) {
            console.warn(`⚠️ [DEBUG] Market order has wrong type: ${orderData.type}, fixing to type: 2`);
            orderData.type = 2;
          }
          if (orderData.limitPrice !== 0) {
            console.warn(`⚠️ [DEBUG] Market order has non-zero limitPrice: ${orderData.limitPrice}, fixing to 0`);
            orderData.limitPrice = 0;
          }
        }
        
        fyersOrderData = orderData;
      } else {
        // Create order data based on parameters
        let orderTypeCode;
        let limitPriceValue;
        let stopPriceValue;
        
        switch (orderType) {
          case 'MARKET':
            orderTypeCode = 2; // Market Order
            limitPriceValue = 0;
            stopPriceValue = 0;
            break;
          case 'LIMIT':
            orderTypeCode = 1; // Limit Order
            limitPriceValue = price;
            stopPriceValue = 0;
            break;
          case 'SL_LIMIT':
            orderTypeCode = 4; // Stop Limit Order (SL-L)
            limitPriceValue = price;
            // For SL-L orders, the trigger logic depends on the side
            // This will be overridden by the orderData parameter
            stopPriceValue = 0; // Will be set by orderData
            break;
          default:
            orderTypeCode = 1; // Default to Limit Order
            limitPriceValue = price;
            stopPriceValue = 0;
        }
        
        fyersOrderData = {
          symbol,
          qty: quantity,
          type: orderTypeCode,
          side: action === 'BUY' ? 1 : -1, // 1=Buy, -1=Sell
          productType: 'INTRADAY',
          limitPrice: limitPriceValue,
          stopPrice: stopPriceValue,
          validity: 'DAY',
          disclosedQty: 0,
          stopLoss: 0,
          takeProfit: 0,
          offlineOrder: offlineOrder
        };
      }
      
      // Add validation parameters required by Fyers API
      fyersOrderData = {
        ...fyersOrderData,
        // Ensure all required fields are present (orderTag should already be provided)
        validity: fyersOrderData.validity || 'DAY',
        disclosedQty: fyersOrderData.disclosedQty || 0,
        stopLoss: fyersOrderData.stopLoss || 0,
        takeProfit: fyersOrderData.takeProfit || 0,
        offlineOrder: fyersOrderData.offlineOrder || false
      };
      
      console.log(`📋 [TRADE SERVICE] Placing order with Fyers:`, fyersOrderData);
      console.log(`🔍 [DEBUG] Final order data validation:`, {
        type: fyersOrderData.type,
        limitPrice: fyersOrderData.limitPrice,
        orderType: orderType,
        isMarketOrder: orderType === 'MARKET'
      });
      console.log(`🔍 [DEBUG] Access token format: ${accessToken ? 'Valid' : 'Invalid'}`);
      console.log(`🔍 [DEBUG] User ID: ${userId}`);
      
      // Place order with Fyers
      const fyersOrder = await this.fyersPlaceOrder(fyersOrderData, accessToken);
      
      // Update trade log with Fyers order ID
      tradeLog.orderId = fyersOrder.id;
      tradeLog.fyersOrderId = fyersOrder.id;
      tradeLog.fyersOrderStatus = fyersOrder.status || 'PENDING';
      tradeLog.remarks = `Order placed successfully - Fyers Order ID: ${fyersOrder.id}`;
      tradeLog.fyersRemarks = fyersOrder.message || 'Order submitted to exchange';
      tradeLog.status = 'PENDING'; // Keep as pending until filled
      await tradeLog.save();
      
      console.log(`[TradeService] Live trade placed: ${symbol} ${action} ${quantity} @ ${price}, Fyers Order ID: ${fyersOrder.id}`);
      
      return {
        success: true,
        orderId: fyersOrder.id,
        status: fyersOrder.status,
        message: 'Order placed successfully'
      };
    } catch (error) {
      console.error('[TradeService] Failed to place live trade:', error);
      
      // Create failed trade log with correct enum values
      const failedLog = new TradeLog({
        symbol: tradeData.symbol,
        quantity: tradeData.quantity,
        price: tradeData.price,
        action: 'ORDER_REJECTED', // Use correct enum value
        orderType: tradeData.orderType,
        side: tradeData.action, // Store BUY/SELL in side field
        tradeType: 'LIVE',
        status: 'REJECTED',
        userId: tradeData.userId,
        remarks: `Order placement failed: ${error.message}`,
        fyersOrderId: null,
        fyersOrderStatus: 'REJECTED',
        fyersRemarks: error.message,
        details: {
          message: `Order placement failed: ${error.message}`,
          error: error.message
        }
      });
      
      try {
        await failedLog.save();
      } catch (logError) {
        console.error('[TradeService] Failed to save failed trade log:', logError);
      }
      
      return {
        success: false,
        message: error.message
      };
    }
  }

  /**
   * Place order with Fyers API
   * @param {Object} orderData - Order data
   * @param {string} accessToken - Fyers access token
   * @returns {Promise<Object>} Fyers order response
   */
  static async fyersPlaceOrder(orderData, accessToken) {
    try {
      console.log(`🚀 [FYERS API] Placing order:`, orderData);
      
      // Use Fyers API library instead of direct HTTP calls
      const FyersAPI = require("fyers-api-v3").fyersModel;
      const fyers = new FyersAPI();
      
      // Extract appId from accessToken (format is "appId:token")
      const [appId, token] = accessToken.split(':');
      
      if (!appId || !token) {
        throw new Error('Invalid access token format - expected appId:token');
      }
      
      fyers.setAppId(appId);
      fyers.setAccessToken(token);
      
      // Use the Fyers API library to place order
      console.log(`🔍 [DEBUG] Calling Fyers API with orderData:`, orderData);
      const response = await fyers.place_order(orderData);
      
      console.log(`📡 [FYERS API] Response:`, response);
      
      if (response.s === 'ok') {
        return {
          id: response.id,
          status: response.s,
          message: response.message
        };
      } else {
        throw new Error(`Fyers API error: ${response.message || JSON.stringify(response)}`);
      }
    } catch (error) {
      console.error('[TradeService] Fyers order placement failed:', error);
      
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
   * Helper method to implement retry with exponential backoff
   * @param {Function} fn - Function to retry
   * @param {number} maxRetries - Maximum number of retries
   * @param {number} initialDelay - Initial delay in ms
   * @param {number} timeout - Timeout in ms
   * @returns {Promise<any>} Function result
   */
  static async retryWithBackoff(fn, maxRetries = 3, initialDelay = 1000, timeout = 10000) {
    let retries = 0;
    let delay = initialDelay;
    
    while (retries < maxRetries) {
      try {
        // Set a timeout for the function execution
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Request timed out')), timeout);
        });
        
        // Race the function against the timeout
        return await Promise.race([fn(), timeoutPromise]);
      } catch (error) {
        // Check if it's a timeout error or a rate limit error (429)
        const isTimeout = error.message === 'Request timed out' || error.code === 'ECONNABORTED';
        const isRateLimit = error.response && error.response.status === 429;
        
        if (isTimeout || isRateLimit) {
          retries++;
          if (retries >= maxRetries) {
            throw error; // Max retries reached, rethrow the error
          }
          
          const reason = isTimeout ? 'timeout' : 'rate limit';
          console.log(`[TradeService] Request failed due to ${reason}, retrying in ${delay}ms (attempt ${retries}/${maxRetries})...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          
          // Exponential backoff with jitter
          delay = delay * 2 + Math.random() * 1000;
          
          // Increase timeout for next attempt
          if (isTimeout) {
            timeout = Math.min(timeout * 1.5, 300000); // Increase timeout but cap at 5 minutes (10x increase)
          }
        } else {
          throw error; // Not a timeout or rate limit error, rethrow immediately
        }
      }
    }
  }

  /**
   * Get today's trade logs for a user
   * @param {string} userId - User ID
   * @returns {Promise<Array>} Trade logs
   */
  static async getTradeLogs(userId) {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      console.log(`[TradeService] Querying trade logs for user ${userId} from ${today} to ${tomorrow}`);
      
      const logs = await TradeLog.find({
        userId,
        timestamp: { $gte: today, $lt: tomorrow }
      }).sort({ timestamp: -1 }).exec();
      
      console.log(`[TradeService] Found ${logs.length} trade logs for today`);
      
      return logs;
    } catch (error) {
      console.error('[TradeService] Failed to get trade logs:', error);
      return [];
    }
  }

  /**
   * Get trade logs for a specific date
   * @param {string} userId - User ID
   * @param {Date} date - Date to get logs for
   * @returns {Promise<Array>} Trade logs
   */
  static async getTradeLogsByDate(userId, date) {
    try {
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      
      const endOfDay = new Date(startOfDay);
      endOfDay.setDate(endOfDay.getDate() + 1);
      
      const logs = await TradeLog.find({
        userId,
        timestamp: { $gte: startOfDay, $lt: endOfDay }
      }).sort({ timestamp: -1 }).exec();
      
      return logs;
    } catch (error) {
      console.error(`[TradeService] Failed to get trade logs for ${date}:`, error);
      return [];
    }
  }

  /**
   * Get all trade logs for a user
   * @param {string} userId - User ID
   * @returns {Promise<Array>} Trade logs
   */
  static async getAllTradeLogs(userId) {
    try {
      console.log(`[TradeService] Querying all trade logs for user ${userId}`);
      const logs = await TradeLog.find({ userId }).sort({ timestamp: -1 }).exec();
      console.log(`[TradeService] Found ${logs.length} total trade logs`);
      return logs;
    } catch (error) {
      console.error('[TradeService] Failed to get all trade logs:', error);
      return [];
    }
  }

  /**
   * Get trade statistics for a user
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Trade statistics
   */
  static async getTradeStats(userId) {
    try {
      // Get today's trades
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      const todayTrades = await TradeLog.find({
        userId,
        timestamp: { $gte: today, $lt: tomorrow }
      }).exec();
      
      // Get all trades
      const allTrades = await TradeLog.find({ userId }).exec();
      
      // Calculate statistics
      const todayPnL = todayTrades.reduce((total, trade) => {
        if (trade.pnl) {
          return total + trade.pnl;
        }
        return total;
      }, 0);
      
      const totalPnL = allTrades.reduce((total, trade) => {
        if (trade.pnl) {
          return total + trade.pnl;
        }
        return total;
      }, 0);
      
      const profitableTrades = allTrades.filter(trade => trade.pnl > 0).length;
      const winRate = allTrades.length > 0 ? (profitableTrades / allTrades.length) * 100 : 0;
      const avgPnL = allTrades.length > 0 ? totalPnL / allTrades.length : 0;
      
      return {
        todayTrades: todayTrades.length,
        todayPnL,
        totalTrades: allTrades.length,
        totalPnL,
        winRate,
        avgPnL
      };
    } catch (error) {
      console.error('[TradeService] Failed to get trade statistics:', error);
      return {
        todayTrades: 0,
        todayPnL: 0,
        totalTrades: 0,
        totalPnL: 0,
        winRate: 0,
        avgPnL: 0
      };
    }
  }

  /**
   * Save trading state for a user
   * @param {Object} state - Trading state
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} Success
   */
  static async saveTradingState(state, userId) {
    try {
      console.log(`[TradeService] Saving trading state for user ${userId}`);
      console.log(`[TradeService] State type:`, typeof state);
      console.log(`[TradeService] MonitoredSymbols type:`, typeof state.monitoredSymbols);
      console.log(`[TradeService] MonitoredSymbols isArray:`, Array.isArray(state.monitoredSymbols));
      console.log(`[TradeService] MonitoredSymbols length:`, state.monitoredSymbols?.length);
      
      // Ensure monitoredSymbols is an array
      if (!state.monitoredSymbols) {
        state.monitoredSymbols = [];
      }
      
      // Handle case where monitoredSymbols might be a string (JSON string)
      if (typeof state.monitoredSymbols === 'string') {
        try {
          console.log(`[TradeService] Parsing monitoredSymbols string:`, state.monitoredSymbols.substring(0, 100) + '...');
          state.monitoredSymbols = JSON.parse(state.monitoredSymbols);
        } catch (parseError) {
          console.error('[TradeService] Failed to parse monitoredSymbols string:', parseError);
          state.monitoredSymbols = [];
        }
      }
      
      // Ensure monitoredSymbols is an array
      if (!Array.isArray(state.monitoredSymbols)) {
        console.log(`[TradeService] Converting monitoredSymbols to array. Current value:`, state.monitoredSymbols);
        state.monitoredSymbols = [];
      }
      
      // Log the final state before saving
      console.log(`[TradeService] Final monitoredSymbols:`, {
        type: typeof state.monitoredSymbols,
        isArray: Array.isArray(state.monitoredSymbols),
        length: state.monitoredSymbols.length,
        sample: state.monitoredSymbols[0]
      });
      
      // Use Mongoose model for proper schema validation
      const TradingState = require('../models/TradingState');
      
      await TradingState.findOneAndUpdate(
        { userId: new mongoose.Types.ObjectId(userId) },
        { 
          ...state,
          lastUpdated: new Date()
        },
        { upsert: true, new: true }
      );
      
        console.log(`[TradeService] ✅ Trading state saved successfully for user ${userId}`);
        return true;
    } catch (error) {
      console.error('[TradeService] Failed to save trading state:', error);
      return false;
    }
  }

  /**
   * Load trading state for a user
   * @param {string} userId - User ID
   * @returns {Promise<Object|null>} Trading state
   */
  static async loadTradingState(userId) {
    try {
      console.log(`[TradeService] Loading trading state for user ${userId}`);
      const TradingState = require('../models/TradingState');
      
      const state = await TradingState.findOne({ 
        userId: new mongoose.Types.ObjectId(userId) 
      });
      
      if (!state) {
        console.log(`[TradeService] No trading state found for user ${userId}`);
        return null;
      }
      
      // Convert Mongoose document to plain object and remove _id
      const stateObject = state.toObject();
      const { _id, ...cleanState } = stateObject;
      
      console.log(`[TradeService] Loaded trading state for user ${userId}:`, {
        hasState: !!cleanState,
        stateType: typeof cleanState,
        stateKeys: cleanState ? Object.keys(cleanState) : null,
        monitoredSymbolsType: typeof cleanState?.monitoredSymbols,
        monitoredSymbolsIsArray: Array.isArray(cleanState?.monitoredSymbols),
        monitoredSymbolsLength: cleanState?.monitoredSymbols?.length,
        monitoredSymbolsSample: cleanState?.monitoredSymbols?.[0]
      });
      
      return cleanState;
    } catch (error) {
      console.error('[TradeService] Failed to load trading state:', error);
      return null;
    }
  }

  /**
   * Clear trading state for a user
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} Success
   */
  static async clearTradingState(userId) {
    try {
      const TradingState = require('../models/TradingState');
      
      await TradingState.deleteOne({ 
        userId: new mongoose.Types.ObjectId(userId) 
      });
      
      console.log(`[TradeService] Trading state cleared for user ${userId}`);
      return true;
    } catch (error) {
      console.error('[TradeService] Failed to clear trading state:', error);
      return false;
    }
  }
}

module.exports = { TradeService };
