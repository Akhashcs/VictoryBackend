const TradingState = require('../models/TradingState');
const { TradeService } = require('./tradeService');
const { HMAService } = require('./hmaService');
const { MarketDataService } = require('./marketDataService');
const { MarketService } = require('./marketService');
const { TradeLogService } = require('./tradeLogService');
const axios = require('axios');

// Get singleton instance of Fyers WebSocket service
const { fyersWebSocketService } = require('./fyersWebSocketService');

/**
 * Backend Monitoring Service
 * Handles all monitoring logic, trade execution, and state management
 */
class MonitoringService {
  /**
   * Start monitoring for a user
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} Success status
   */
  static async startMonitoring(userId) {
    try {
      const TradingState = require('../models/TradingState');
      const User = require('../models/User');
      
      // Get user with Fyers token
      const user = await User.findById(userId);
      if (!user || !user.fyers || !user.fyers.accessToken) {
        throw new Error('No valid Fyers access token found');
      }

      // Update or create trading state
      let state = await TradingState.findOne({ userId });
      if (!state) {
        state = new TradingState({
          userId,
          monitoredSymbols: [],
          activePositions: [],
          tradeExecutionState: {
            isMonitoring: false,
            totalTradesExecuted: 0,
            totalPnL: 0
          }
        });
      }
      
      state.tradeExecutionState.isMonitoring = true;
      state.tradeExecutionState.monitoringStartTime = new Date();
      await state.save();
      
      // Start Fyers WebSocket for order updates
      const webSocketStarted = await fyersWebSocketService.startConnection();
      if (webSocketStarted) {
        console.log(`🔌 Fyers WebSocket started for order monitoring`);
      } else {
        console.log(`⚠️ Fyers WebSocket not started - no valid access token found`);
      }

      // Manage WebSocket connection
      await this.manageWebSocketConnection(userId);

      console.log(`🚀 Monitoring started for user ${userId}`);
      return true;
    } catch (error) {
      console.error('Error starting monitoring:', error);
      throw error;
    }
  }

  /**
   * Stop monitoring for a user
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} Success status
   */
  static async stopMonitoring(userId) {
    try {
      const TradingState = require('../models/TradingState');
      
      // Update trading state
      const state = await TradingState.findOne({ userId });
      if (state) {
        state.tradeExecutionState.isMonitoring = false;
        await state.save();
      }
      
      // Manage WebSocket connection
      await this.manageWebSocketConnection(userId);
      
      console.log(`🛑 Monitoring stopped for user ${userId}`);
      return true;
    } catch (error) {
      console.error('Error stopping monitoring:', error);
      throw error;
    }
  }

  /**
   * Add symbol to monitoring
   * @param {string} userId - User ID
   * @param {Object} symbolData - Symbol configuration
   * @returns {Promise<Object>} Updated state
   */
  static async addSymbolToMonitoring(userId, symbolData) {
    try {
      let state = await TradingState.findOne({ userId });
      
      if (!state) {
        state = new TradingState({ userId });
      }
      
      const newSymbol = {
        id: `${symbolData.symbol}-${Date.now()}`,
        ...symbolData,
        useTrailingStoploss: symbolData.useTrailingStoploss || false,
        trailingX: symbolData.trailingX || 20,
        trailingY: symbolData.trailingY || 15,
        triggerStatus: 'WAITING',
        pendingSignal: null,
        lastUpdate: new Date()
      };
      
      state.monitoredSymbols.push(newSymbol);
      await state.save();
      
      // Fetch HMA value immediately for the new symbol
      try {
        const User = require('../models/User');
        const user = await User.findById(userId);
        if (user) {
          const hmaData = await HMAService.fetchAndCalculateHMA(symbolData.symbol, user);
          if (hmaData.currentHMA || hmaData.hmaValue) {
            await TradingState.updateOne(
              { userId, 'monitoredSymbols.id': newSymbol.id },
              {
                $set: {
                  'monitoredSymbols.$.hmaValue': hmaData.currentHMA || hmaData.hmaValue,
                  'monitoredSymbols.$.lastUpdate': hmaData.lastUpdate || new Date()
                }
              }
            );
            console.log(`📈 Fetched HMA value for ${symbolData.symbol}: ${hmaData.currentHMA || hmaData.hmaValue}`);
          }
        } else {
          console.error(`User not found for userId: ${userId}`);
        }
      } catch (error) {
        console.error(`Error fetching HMA for ${symbolData.symbol}:`, error);
      }
      
      console.log(`📊 Added ${symbolData.symbol} to monitoring for user ${userId}`);
      return state;
    } catch (error) {
      console.error('Error adding symbol to monitoring:', error);
      throw error;
    }
  }

  /**
   * Remove symbol from monitoring
   * @param {string} userId - User ID
   * @param {string} symbolId - Symbol ID
   * @returns {Promise<Object>} Updated state
   */
  static async removeSymbolFromMonitoring(userId, symbolId) {
    try {
      const state = await TradingState.findOne({ userId });
      if (!state) return null;
      
      state.monitoredSymbols = state.monitoredSymbols.filter(s => s.id !== symbolId);
      await state.save();
      
      console.log(`🗑️ Removed symbol ${symbolId} from monitoring for user ${userId}`);
      return state;
    } catch (error) {
      console.error('Error removing symbol from monitoring:', error);
      throw error;
    }
  }

  /**
   * Clear all monitoring for a user
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} Success status
   */
  static async clearAllMonitoring(userId) {
    try {
      const state = await TradingState.findOne({ userId });
      if (state) {
        state.monitoredSymbols = [];
        state.tradeExecutionState.isMonitoring = false;
        await state.save();
      }
      
      // Check if any other users are still monitoring
      const activeMonitoring = await TradingState.findOne({
        'tradeExecutionState.isMonitoring': true
      });
      
      // Stop Fyers WebSocket if no one is monitoring
      if (!activeMonitoring) {
        fyersWebSocketService.stopReconnection(); // Stop reconnection attempts
        fyersWebSocketService.disconnect();
        console.log(`🔌 Fyers WebSocket stopped - no active monitoring`);
      }
      
      console.log(`🗑️ All monitoring cleared for user ${userId}`);
      return true;
    } catch (error) {
      console.error('Error clearing all monitoring:', error);
      throw error;
    }
  }

  /**
   * Update HMA values for monitored symbols
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Updated state
   */
  static async updateHMAValues(userId) {
    try {
      const TradingState = require('../models/TradingState');
      const state = await TradingState.findOne({ userId });
      if (!state || !state.monitoredSymbols || state.monitoredSymbols.length === 0) {
        console.log(`📊 No trading state or monitored symbols found for user ${userId}`);
        return state;
      }
      
      // Get current state with updated symbols
      const updatedState = await TradingState.findOne({ userId });
      
      // Process each monitored symbol for HMA updates and order modifications
      for (const symbol of updatedState.monitoredSymbols) {
        try {
          const User = require('../models/User');
          const user = await User.findById(userId);
          if (!user) {
            console.error(`User not found for userId: ${userId}`);
            continue;
          }
          
          const hmaData = await HMAService.fetchAndCalculateHMA(symbol.symbol, user);
          const newHmaValue = hmaData.currentHMA || hmaData.hmaValue;
          const oldHmaValue = symbol.hmaValue;
          
          // Update HMA value
          await TradingState.updateOne(
            { userId, 'monitoredSymbols.id': symbol.id },
            {
              $set: {
                'monitoredSymbols.$.hmaValue': newHmaValue,
                'monitoredSymbols.$.lastUpdate': hmaData.lastUpdate || new Date()
              }
            }
          );
          
          // Check if HMA changed significantly
          if (oldHmaValue && Math.abs(newHmaValue - oldHmaValue) >= 0.5) {
            console.log(`📈 HMA changed for ${symbol.symbol}: ${oldHmaValue} → ${newHmaValue}`);
            
            // Modify BUY SL-L order if it's pending and not filled
            if (symbol.orderPlaced && symbol.orderStatus === 'PENDING' && symbol.orderId && !symbol.sellOrderId) {
              await this.modifyPendingOrderForHMAChange(symbol, oldHmaValue, newHmaValue, userId);
            }
          }
          
          // Check for SELL SL-L order modifications based on trailing stop loss
          if (symbol.sellOrderId && symbol.orderStatus === 'PENDING' && symbol.useTrailingStoploss) {
            const liveQuote = await this.getLiveQuote(symbol.symbol, userId);
            if (liveQuote && liveQuote.ltp) {
              await this.modifySellSLLOrderForTrailingStop(symbol, liveQuote.ltp, userId);
            }
          }
          
        } catch (error) {
          console.error(`Error updating HMA for ${symbol.symbol}:`, error);
        }
      }
      
      // Update lastHMAUpdate timestamp atomically
      await TradingState.updateOne(
        { userId },
        { $set: { 'tradeExecutionState.lastHMAUpdate': new Date() } }
      );
      console.log(`📈 Updated HMA values and processed order modifications for ${updatedState.monitoredSymbols.length} symbols for user ${userId}`);
      return await TradingState.findOne({ userId });
    } catch (error) {
      console.error('Error updating HMA values:', error);
      throw error;
    }
  }

  /**
   * Modify pending BUY SL-L order when HMA changes
   * @param {Object} symbol - Symbol data
   * @param {number} oldHmaValue - Previous HMA value
   * @param {number} newHmaValue - New HMA value
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} Success status
   */
  static async modifyPendingOrderForHMAChange(symbol, oldHmaValue, newHmaValue, userId) {
    try {
      // Only modify if BUY order is placed and still pending (not filled)
      if (!symbol.orderPlaced || symbol.orderStatus !== 'PENDING' || !symbol.orderId || symbol.sellOrderId) {
        console.log(`⚠️ Cannot modify BUY SL-L order for ${symbol.symbol}: order not placed, not pending, or already filled`);
        return false;
      }

      // Check if HMA change is significant (more than 0.5 points)
      const hmaDifference = Math.abs(newHmaValue - oldHmaValue);
      if (hmaDifference < 0.5) {
        console.log(`📊 HMA change for ${symbol.symbol} too small (${hmaDifference.toFixed(2)}), skipping modification`);
        return false;
      }

      console.log(`🔄 Modifying BUY SL-L order for ${symbol.symbol}: HMA ${oldHmaValue} → ${newHmaValue}`);

      // Cancel existing BUY SL-L order
      const cancelResult = await TradeService.cancelOrder(symbol.orderId, userId);
      if (!cancelResult.success) {
        console.error(`❌ Failed to cancel BUY SL-L order ${symbol.orderId} for ${symbol.symbol}`);
        return false;
      }

      // Place new BUY SL-L order with updated HMA value
      const newLimitPrice = newHmaValue;
      const position = await this.executeLimitOrder(symbol, newLimitPrice, new Date(), userId);
      
      if (position) {
        // Update symbol status
        const TradingState = require('../models/TradingState');
        await TradingState.updateOne(
          { userId, 'monitoredSymbols.id': symbol.id },
          {
            $set: {
              'monitoredSymbols.$.triggerStatus': 'ORDER_MODIFIED',
              'monitoredSymbols.$.orderId': position.orderId,
              'monitoredSymbols.$.orderStatus': 'PENDING',
              'monitoredSymbols.$.lastOrderModification': new Date(),
              'monitoredSymbols.$.orderModificationCount': (symbol.orderModificationCount || 0) + 1,
              'monitoredSymbols.$.lastHmaValue': oldHmaValue,
              'monitoredSymbols.$.orderModificationReason': `BUY SL-L modified: HMA changed from ${oldHmaValue} to ${newHmaValue}`
            }
          }
        );

        console.log(`✅ BUY SL-L order modified for ${symbol.symbol} at new HMA: ${newHmaValue}`);
        return true;
      } else {
        // Order modification failed
        await TradingState.updateOne(
          { userId, 'monitoredSymbols.id': symbol.id },
          {
            $set: {
              'monitoredSymbols.$.triggerStatus': 'ORDER_REJECTED',
              'monitoredSymbols.$.orderStatus': 'REJECTED',
              'monitoredSymbols.$.orderModificationReason': 'Failed to modify BUY SL-L order'
            }
          }
        );
        console.error(`❌ BUY SL-L order modification failed for ${symbol.symbol}`);
        return false;
      }
    } catch (error) {
      console.error(`❌ Error modifying BUY SL-L order for ${symbol.symbol}:`, error);
      
      // Update status to rejected
      const TradingState = require('../models/TradingState');
      await TradingState.updateOne(
        { userId, 'monitoredSymbols.id': symbol.id },
        {
          $set: {
            'monitoredSymbols.$.triggerStatus': 'ORDER_REJECTED',
            'monitoredSymbols.$.orderStatus': 'REJECTED',
            'monitoredSymbols.$.orderModificationReason': error.message
          }
        }
      );
      
      return false;
    }
  }

  /**
   * Modify pending SL-L orders when HMA changes
   * @param {Object} symbol - Symbol data
   * @param {number} oldHmaValue - Previous HMA value
   * @param {number} newHmaValue - New HMA value
   * @param {string} userId - User ID
   */
  static async modifyPendingOrdersForHMAChange(symbol, oldHmaValue, newHmaValue, userId) {
    try {
      const state = await TradingState.findOne({ userId });
      if (!state || !state.activePositions) return;
      
      // Find pending SL-L orders for this symbol
      const pendingOrders = state.activePositions.filter(p => 
        p.symbol === symbol.symbol && p.status === 'Pending' && p.orderType === 'SL_LIMIT'
      );
      
      for (const order of pendingOrders) {
        try {
          // Calculate new trigger price based on new HMA
          const newTriggerPrice = order.boughtPrice - 0.5; // Keep 0.5 points below limit
          
          // Note: Order modifications are now handled by the trade service
          // This prevents conflicts with the new Fyers WebSocket service
          console.log(`🔄 HMA change detected for ${symbol.symbol}: ${oldHmaValue} → ${newHmaValue}`);
          console.log(`📝 Order modification should be handled by trade service`);
        } catch (error) {
          console.error(`Error modifying SL-L order for ${symbol.symbol}:`, error);
        }
      }
      
      // Save updated state
      await state.save();
    } catch (error) {
      console.error('Error modifying pending orders for HMA change:', error);
    }
  }

  /**
   * Execute monitoring cycle - check for trade signals and execute trades
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Execution results
   */
  static async executeMonitoringCycle(userId) {
    try {
      const TradingState = require('../models/TradingState');
      const state = await TradingState.findOne({ userId });
      if (!state) {
        console.log(`📊 No trading state found for user ${userId}`);
        return { executed: 0, errors: [] };
      }
      if (!state.tradeExecutionState || !state.tradeExecutionState.isMonitoring) {
        console.log(`📊 Monitoring not active for user ${userId}`);
        return { executed: 0, errors: [] };
      }
      if (!state.monitoredSymbols || state.monitoredSymbols.length === 0) {
        console.log(`📊 No monitored symbols for user ${userId}`);
        return { executed: 0, errors: [] };
      }
      const results = { executed: 0, errors: [] };
      const symbolsToFetch = state.monitoredSymbols.map(s => s.symbol).filter(Boolean);
      if (symbolsToFetch.length === 0) return results;
      const User = require('../models/User');
      const user = await User.findById(userId);
      const liveData = await MarketService.getQuotes(symbolsToFetch, user);
      const now = new Date();
      // Process each monitored symbol
      for (const symbol of state.monitoredSymbols) {
        try {
          console.log(`🔍 [DEBUG] Processing symbol ${symbol.symbol}:`, {
            orderPlaced: symbol.orderPlaced,
            orderPlacedAt: symbol.orderPlacedAt,
            id: symbol.id
          });
          const liveQuote = liveData.find(d => d.symbol === symbol.symbol);
          if (!liveQuote) continue;
          
          // If HMA value is missing, try to fetch it
          if (!symbol.hmaValue) {
            console.log(`⚠️ No HMA value for ${symbol.symbol}, fetching now...`);
            try {
              const User = require('../models/User');
              const user = await User.findById(userId);
              if (!user) {
                console.error(`User not found for userId: ${userId}`);
                continue;
              }
              
              const hmaData = await HMAService.fetchAndCalculateHMA(symbol.symbol, user);
              if (hmaData.currentHMA || hmaData.hmaValue) {
                await TradingState.updateOne(
                  { userId, 'monitoredSymbols.id': symbol.id },
                  {
                    $set: {
                      'monitoredSymbols.$.hmaValue': hmaData.currentHMA || hmaData.hmaValue,
                      'monitoredSymbols.$.lastUpdate': hmaData.lastUpdate || new Date()
                    }
                  }
                );
                symbol.hmaValue = hmaData.currentHMA || hmaData.hmaValue;
                console.log(`📈 Fetched HMA value for ${symbol.symbol}: ${symbol.hmaValue}`);
              } else {
                console.log(`⚠️ Could not fetch HMA value for ${symbol.symbol}, skipping...`);
                continue;
              }
            } catch (error) {
              console.error(`Error fetching HMA for ${symbol.symbol}:`, error);
              continue;
            }
          }
          
          const ltp = liveQuote.ltp;
          const updatedSymbol = await this.processSymbolSignal(symbol, ltp, now, userId);
          console.log(`🔍 [DEBUG] processSymbolSignal result for ${symbol.symbol}:`, {
            executed: updatedSymbol.executed,
            symbolRemoved: updatedSymbol.symbolRemoved,
            position: updatedSymbol.position ? 'present' : 'null'
          });
          if (updatedSymbol.executed) {
            results.executed++;
            // Remove from monitoring and add to active positions
            state.monitoredSymbols = state.monitoredSymbols.filter(s => s.id !== symbol.id);
            if (updatedSymbol.position && state.activePositions) {
              state.activePositions.push(updatedSymbol.position);
            }
          } else if (updatedSymbol.symbolRemoved) {
            // Remove symbol from monitoring for single entry scenarios
            state.monitoredSymbols = state.monitoredSymbols.filter(s => s.id !== symbol.id);
            console.log(`🗑️ Removed ${symbol.symbol} from monitoring (single entry)`);
            console.log(`🔍 [DEBUG] Symbol removed flag: ${updatedSymbol.symbolRemoved}`);
          }
          // Atomically update currentLTP, lastUpdate, pendingSignal, and orderPlaced flag for this symbol
          console.log(`🔍 [DEBUG] Updating symbol ${symbol.symbol} in database:`, {
            orderPlaced: symbol.orderPlaced,
            orderPlacedAt: symbol.orderPlacedAt
          });
          
          // Use atomic update to prevent race conditions
          const updateResult = await TradingState.updateOne(
            { 
              userId, 
              'monitoredSymbols.id': symbol.id,
              // Only update if orderPlaced is not already true (prevent race conditions)
              $or: [
                { 'monitoredSymbols.orderPlaced': { $ne: true } },
                { 'monitoredSymbols.orderPlaced': symbol.orderPlaced }
              ]
            },
            {
              $set: {
                'monitoredSymbols.$.currentLTP': ltp,
                'monitoredSymbols.$.lastUpdate': now,
                'monitoredSymbols.$.pendingSignal': symbol.pendingSignal,
                'monitoredSymbols.$.orderPlaced': symbol.orderPlaced,
                'monitoredSymbols.$.orderPlacedAt': symbol.orderPlacedAt
              }
            }
          );
          
          // Check if update was successful (prevents race conditions)
          if (updateResult.modifiedCount === 0 && symbol.orderPlaced) {
            console.log(`⚠️ Database update failed for ${symbol.symbol} - order may have been placed by another process`);
            // Reset the flag since the database update failed
            symbol.orderPlaced = false;
            symbol.orderPlacedAt = null;
          }
        } catch (error) {
          console.error(`Error processing symbol ${symbol.symbol}:`, error);
          results.errors.push({ symbol: symbol.symbol, error: error.message });
        }
      }
      // Atomically update lastMarketDataUpdate, totalTradesExecuted, and monitoredSymbols
      const updateFields = {
        'tradeExecutionState.lastMarketDataUpdate': now
      };
        if (results.executed > 0) {
        updateFields['tradeExecutionState.totalTradesExecuted'] = (state.tradeExecutionState.totalTradesExecuted || 0) + results.executed;
      }
      
      // Update monitoredSymbols array to persist symbol removals
      updateFields['monitoredSymbols'] = state.monitoredSymbols;
      
      await TradingState.updateOne(
        { userId },
        { $set: updateFields }
      );
      
      // Manage WebSocket connection based on monitoring activity
      await this.manageWebSocketConnection(userId);
      
      console.log(`🔄 Monitoring cycle (atomic) for user ${userId}: ${results.executed} trades executed`);
      return results;
    } catch (error) {
      console.error('Error executing monitoring cycle:', error);
      throw error;
    }
  }

  /**
   * Process symbol signal and execute trades
   * @param {Object} symbol - Symbol data
   * @param {number} ltp - Current LTP
   * @param {Date} now - Current time
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Execution result
   */
  static async processSymbolSignal(symbol, ltp, now, userId) {
    const result = { executed: false, position: null, symbolRemoved: false };
    const hma = symbol.hmaValue;
    
    if (!hma) {
      console.log(`⚠️ No HMA value for ${symbol.symbol}`);
      return result;
    }

    // Check if order was already placed for this symbol (prevent multiple orders)
    console.log(`🔍 [DEBUG] ${symbol.symbol} orderPlaced flag: ${symbol.orderPlaced}, orderStatus: ${symbol.orderStatus}`);
    
    // If order is already placed and pending, check if we need to modify it
    if (symbol.orderPlaced && symbol.orderStatus === 'PENDING' && symbol.orderId) {
      // Check if HMA has changed significantly
      if (symbol.lastHmaValue && Math.abs(hma - symbol.lastHmaValue) >= 0.5) {
        console.log(`🔄 HMA changed for ${symbol.symbol}: ${symbol.lastHmaValue} → ${hma}, modifying order`);
        await this.modifyPendingOrderForHMAChange(symbol, symbol.lastHmaValue, hma, userId);
      }
      return result;
    }

    // If order was rejected, handle re-entry logic
    if (symbol.orderStatus === 'REJECTED') {
      console.log(`❌ Order was rejected for ${symbol.symbol}, checking re-entry logic`);
      
      // Check if we should transition from ORDER_REJECTED to WAITING_REENTRY
      if (symbol.triggerStatus === 'ORDER_REJECTED') {
        // Add a cooldown period before allowing re-entry (5 minutes)
        const timeSinceRejection = symbol.orderPlacedAt ? (now - new Date(symbol.orderPlacedAt).getTime()) : 0;
        const cooldownPeriod = 5 * 60 * 1000; // 5 minutes cooldown
        
        if (timeSinceRejection >= cooldownPeriod) {
          // Reset order status for re-entry
          const TradingState = require('../models/TradingState');
          await TradingState.updateOne(
            { userId, 'monitoredSymbols.id': symbol.id },
            {
              $set: {
                'monitoredSymbols.$.triggerStatus': 'WAITING_REENTRY',
                'monitoredSymbols.$.orderPlaced': false,
                'monitoredSymbols.$.orderStatus': null,
                'monitoredSymbols.$.orderId': null,
                'monitoredSymbols.$.reEntryCount': (symbol.reEntryCount || 0) + 1,
                'monitoredSymbols.$.orderModificationReason': 'Ready for re-entry after cooldown'
              }
            }
          );
          console.log(`🔄 ${symbol.symbol} reset for re-entry (attempt ${symbol.reEntryCount + 1})`);
        } else {
          const remainingCooldown = Math.ceil((cooldownPeriod - timeSinceRejection) / 1000 / 60);
          console.log(`⏳ ${symbol.symbol}: Order recently rejected, cooldown period active (${remainingCooldown} minutes remaining)`);
        }
      }
      return result;
    }

    // ADDITIONAL RACE CONDITION PROTECTION: Check database state atomically
    const TradingState = require('../models/TradingState');
    const dbSymbol = await TradingState.findOne(
      { 
        userId, 
        'monitoredSymbols.id': symbol.id,
        'monitoredSymbols.orderPlaced': { $ne: true } // Only proceed if order not already placed
      }
    );
    
    if (!dbSymbol) {
      console.log(`⏳ Order already placed for ${symbol.symbol} (database check) - skipping`);
      return result;
    }

    // Check if order was recently rejected to prevent immediate retry
    const recentlyRejected = symbol.orderStatus === 'REJECTED' && symbol.orderPlacedAt;
    if (recentlyRejected) {
      const timeSinceRejection = now - new Date(symbol.orderPlacedAt).getTime();
      const cooldownPeriod = 5 * 60 * 1000; // 5 minutes cooldown
      
      if (timeSinceRejection < cooldownPeriod) {
        const remainingCooldown = Math.ceil((cooldownPeriod - timeSinceRejection) / 1000 / 60);
        console.log(`⏳ ${symbol.symbol}: Order recently rejected, cooldown period active (${remainingCooldown} minutes remaining)`);
        return result;
      }
    }

    // NEW STRATEGY: 
    // 1. If LTP < HMA: Place limit order immediately at HMA value
    // 2. If LTP > HMA: Wait for LTP to drop below HMA, then wait 15 minutes before placing order
    if (ltp < hma) {
      // LTP is below HMA - Place limit order immediately at HMA value
      console.log(`📈 ${symbol.symbol}: LTP (${ltp}) < HMA (${hma}) - Placing limit order immediately at HMA`);
      
      try {
        // Place limit order at HMA value
        const limitPrice = hma;
        
        const position = await this.executeLimitOrder(symbol, limitPrice, now, userId);
        
        // Check if order was successfully placed
        if (position) {
          // Don't set result.executed = true here - only when order is actually FILLED
          // result.executed = true;  // REMOVED - only set when order is filled
          // result.position = position;  // REMOVED - only set when order is filled
          
          // Update symbol status to ORDER_PLACED
          await TradingState.updateOne(
            { userId, 'monitoredSymbols.id': symbol.id },
            {
              $set: {
                'monitoredSymbols.$.triggerStatus': 'ORDER_PLACED',
                'monitoredSymbols.$.orderPlaced': true,
                'monitoredSymbols.$.orderPlacedAt': now,
                'monitoredSymbols.$.orderId': position.buyOrderId, // Use buyOrderId from position
                'monitoredSymbols.$.orderStatus': 'PENDING',
                'monitoredSymbols.$.lastHmaValue': hma
              }
            }
          );
          
          console.log(`✅ Limit order placed for ${symbol.symbol} at ${limitPrice}`);
          console.log(`🔍 [DEBUG] Set orderPlaced=true for ${symbol.symbol}`);
          
          // Keep symbol in monitoring for order tracking (don't remove immediately)
          console.log(`📊 Keeping ${symbol.symbol} in monitoring for order tracking`);
        } else {
          // Order was rejected
          await TradingState.updateOne(
            { userId, 'monitoredSymbols.id': symbol.id },
            {
              $set: {
                'monitoredSymbols.$.triggerStatus': 'ORDER_REJECTED',
                'monitoredSymbols.$.orderStatus': 'REJECTED',
                'monitoredSymbols.$.orderPlacedAt': now,
                'monitoredSymbols.$.orderModificationReason': 'Order placement failed'
              }
            }
          );
          
          console.log(`❌ Limit order rejected for ${symbol.symbol}`);
          result.executed = false;
        }
      } catch (error) {
        console.error(`❌ Failed to place limit order for ${symbol.symbol}:`, error);
        
        // Update status to rejected
        await TradingState.updateOne(
          { userId, 'monitoredSymbols.id': symbol.id },
          {
            $set: {
              'monitoredSymbols.$.triggerStatus': 'ORDER_REJECTED',
              'monitoredSymbols.$.orderStatus': 'REJECTED',
              'monitoredSymbols.$.orderPlacedAt': now,
              'monitoredSymbols.$.orderModificationReason': error.message
            }
          }
        );
        
        // Check if it's a margin shortfall or other permanent error
        const isMarginShortfall = error.message && (
          error.message.includes('Margin Shortfall') || 
          error.message.includes('margin shortfall') ||
          error.message.includes('RED:Margin Shortfall')
        );
        const isInsufficientFunds = error.message && (
          error.message.includes('insufficient') ||
          error.message.includes('Insufficient')
        );
        const isSystemSquareOff = error.message && (
          error.message.includes('system square off') ||
          error.message.includes('System square off') ||
          error.message.includes('RED:MIS Orders are disallowed after system square off')
        );
        const isLotSizeError = error.message && (
          error.message.includes('lot size') ||
          error.message.includes('Lot size') ||
          error.message.includes('not a multiple of minimum lot size')
        );
        
        console.log(`🔍 [DEBUG] Error message: "${error.message}"`);
        console.log(`🔍 [DEBUG] isMarginShortfall: ${isMarginShortfall}, isInsufficientFunds: ${isInsufficientFunds}, isSystemSquareOff: ${isSystemSquareOff}, isLotSizeError: ${isLotSizeError}`);
        
        if (isMarginShortfall || isInsufficientFunds || isSystemSquareOff) {
          // For permanent errors, remove symbol from monitoring
          result.symbolRemoved = true;
          console.log(`💰 Permanent error for ${symbol.symbol} - removing from monitoring`);
        } else if (isLotSizeError) {
          // For lot size errors, keep in monitoring but don't retry immediately
          console.log(`📦 Lot size error for ${symbol.symbol} - keeping in monitoring but not retrying`);
          // Set a flag to prevent immediate retry
          await TradingState.updateOne(
            { userId, 'monitoredSymbols.id': symbol.id },
            {
              $set: {
                'monitoredSymbols.$.orderPlaced': false,
                'monitoredSymbols.$.orderPlacedAt': null,
                'monitoredSymbols.$.orderModificationReason': 'Lot size error - manual intervention required'
              }
            }
          );
        } else {
          // For other errors, keep symbol in monitoring for re-entry
          console.log(`⚠️ Limit order rejected for ${symbol.symbol} - keeping in monitoring`);
        }
        result.executed = false;
      }
    } else if (ltp > hma) {
      // LTP is above HMA - Wait for LTP to drop below HMA and stay there for 15 minutes
      console.log(`📉 ${symbol.symbol}: LTP (${ltp}) > HMA (${hma}) - Waiting for LTP to drop below HMA`);
      
      // Check if we have a pending signal for waiting period
      if (!symbol.pendingSignal) {
        // Start waiting period when LTP first drops below HMA
        symbol.pendingSignal = {
          direction: 'WAIT_FOR_DROP',
          triggeredAt: now,
          hmaAtTrigger: hma,
          waitStartTime: null // Will be set when LTP drops below HMA
        };
        
        // Update status to WAITING
        await TradingState.updateOne(
          { userId, 'monitoredSymbols.id': symbol.id },
          {
            $set: {
              'monitoredSymbols.$.triggerStatus': 'WAITING',
              'monitoredSymbols.$.pendingSignal': symbol.pendingSignal
            }
          }
        );
        
        console.log(`⏳ ${symbol.symbol}: Started monitoring for LTP to drop below HMA`);
      } else if (symbol.pendingSignal.direction === 'WAIT_FOR_DROP') {
        // Check if LTP has dropped below HMA
        if (ltp <= hma) {
          if (!symbol.pendingSignal.waitStartTime) {
            // First time LTP dropped below HMA - start 15-minute timer
            symbol.pendingSignal.waitStartTime = now;
            
            // Update status to show countdown is starting
            await TradingState.updateOne(
              { userId, 'monitoredSymbols.id': symbol.id },
              {
                $set: {
                  'monitoredSymbols.$.triggerStatus': 'WAITING',
                  'monitoredSymbols.$.pendingSignal': symbol.pendingSignal,
                  'monitoredSymbols.$.orderModificationReason': 'LTP dropped below HMA, starting 15-minute countdown'
                }
              }
            );
            
            console.log(`⏱️ ${symbol.symbol}: LTP dropped below HMA, starting 15-minute countdown`);
          } else {
            // Check if 15 minutes have passed since LTP dropped below HMA
            const waitDuration = now - symbol.pendingSignal.waitStartTime;
            const fifteenMinutes = 15 * 60 * 1000; // 15 minutes in milliseconds
            
            if (waitDuration >= fifteenMinutes) {
              // 15 minutes passed - place limit order
              console.log(`⏰ ${symbol.symbol}: 15-minute countdown completed, placing limit order`);
              
              try {
                const limitPrice = hma; // Place at HMA value
                const position = await this.executeLimitOrder(symbol, limitPrice, now, userId);
                
                // Check if order was successfully placed
                if (position) {
                  result.executed = true;
                  result.position = position;
                  
                  // Update symbol status to ORDER_PLACED
                  await TradingState.updateOne(
                    { userId, 'monitoredSymbols.id': symbol.id },
                    {
                      $set: {
                        'monitoredSymbols.$.triggerStatus': 'ORDER_PLACED',
                        'monitoredSymbols.$.orderPlaced': true,
                        'monitoredSymbols.$.orderPlacedAt': now,
                        'monitoredSymbols.$.orderId': position.orderId,
                        'monitoredSymbols.$.orderStatus': 'PENDING',
                        'monitoredSymbols.$.lastHmaValue': hma,
                        'monitoredSymbols.$.orderModificationReason': 'Order placed after 15-minute countdown'
                      }
                    }
                  );
                  
                  console.log(`✅ Limit order placed for ${symbol.symbol} at ${limitPrice} after 15-minute countdown`);
                  
                  // Keep symbol in monitoring for order tracking
                  console.log(`📊 Keeping ${symbol.symbol} in monitoring for order tracking`);
                } else {
                  // Order was rejected
                  await TradingState.updateOne(
                    { userId, 'monitoredSymbols.id': symbol.id },
                    {
                      $set: {
                        'monitoredSymbols.$.triggerStatus': 'ORDER_REJECTED',
                        'monitoredSymbols.$.orderStatus': 'REJECTED',
                        'monitoredSymbols.$.orderPlacedAt': now,
                        'monitoredSymbols.$.orderModificationReason': 'Order placement failed after 15-minute countdown'
                      }
                    }
                  );
                  
                  console.log(`❌ Limit order rejected for ${symbol.symbol} after 15-minute countdown`);
                  result.executed = false;
                }
              } catch (error) {
                console.error(`❌ Failed to place limit order for ${symbol.symbol}:`, error);
                
                // Update status to rejected
                await TradingState.updateOne(
                  { userId, 'monitoredSymbols.id': symbol.id },
                  {
                    $set: {
                      'monitoredSymbols.$.triggerStatus': 'ORDER_REJECTED',
                      'monitoredSymbols.$.orderStatus': 'REJECTED',
                      'monitoredSymbols.$.orderPlacedAt': now,
                      'monitoredSymbols.$.orderModificationReason': error.message
                    }
                  }
                );
                
                // Check if it's a margin shortfall or other permanent error
                const isMarginShortfall = error.message && error.message.includes('Margin Shortfall');
                const isInsufficientFunds = error.message && error.message.includes('insufficient');
                const isSystemSquareOff = error.message && (
                  error.message.includes('system square off') ||
                  error.message.includes('System square off') ||
                  error.message.includes('RED:MIS Orders are disallowed after system square off')
                );
                const isLotSizeError = error.message && (
                  error.message.includes('lot size') ||
                  error.message.includes('Lot size') ||
                  error.message.includes('not a multiple of minimum lot size')
                );
                
                if (isMarginShortfall || isInsufficientFunds || isSystemSquareOff) {
                  // For permanent errors, remove symbol from monitoring
                  result.symbolRemoved = true;
                  console.log(`💰 Permanent error for ${symbol.symbol} - removing from monitoring`);
                } else if (isLotSizeError) {
                  // For lot size errors, keep in monitoring but don't retry immediately
                  console.log(`📦 Lot size error for ${symbol.symbol} - keeping in monitoring but not retrying`);
                  // Set a flag to prevent immediate retry
                  await TradingState.updateOne(
                    { userId, 'monitoredSymbols.id': symbol.id },
                    {
                      $set: {
                        'monitoredSymbols.$.orderPlaced': false,
                        'monitoredSymbols.$.orderPlacedAt': null,
                        'monitoredSymbols.$.orderModificationReason': 'Lot size error - manual intervention required'
                      }
                    }
                  );
                } else {
                  // For other errors, keep symbol in monitoring for re-entry
                  console.log(`⚠️ Limit order rejected for ${symbol.symbol} - keeping in monitoring`);
                }
                result.executed = false;
              }
            } else {
              // Still waiting - check if LTP went back above HMA
              if (ltp > hma) {
                // Reset wait timer if LTP went back above HMA
                symbol.pendingSignal.waitStartTime = null;
                
                await TradingState.updateOne(
                  { userId, 'monitoredSymbols.id': symbol.id },
                  {
                    $set: {
                      'monitoredSymbols.$.pendingSignal': symbol.pendingSignal,
                      'monitoredSymbols.$.orderModificationReason': 'LTP went back above HMA, resetting countdown'
                    }
                  }
                );
                
                console.log(`🔄 ${symbol.symbol}: LTP went back above HMA, resetting 15-minute countdown`);
              } else {
                const remainingTime = Math.ceil((fifteenMinutes - waitDuration) / 1000 / 60);
                
                await TradingState.updateOne(
                  { userId, 'monitoredSymbols.id': symbol.id },
                  {
                    $set: {
                      'monitoredSymbols.$.orderModificationReason': `15-minute countdown in progress: ${remainingTime} minutes remaining`
                    }
                  }
                );
                
                console.log(`⏳ ${symbol.symbol}: 15-minute countdown in progress, ${remainingTime} minutes remaining`);
              }
            }
          }
        } else {
          // LTP is still above HMA - reset wait timer and update status
          symbol.pendingSignal.waitStartTime = null;
          
          await TradingState.updateOne(
            { userId, 'monitoredSymbols.id': symbol.id },
            {
              $set: {
                'monitoredSymbols.$.pendingSignal': symbol.pendingSignal,
                'monitoredSymbols.$.orderModificationReason': 'Waiting for LTP to drop below HMA'
              }
            }
          );
          
          console.log(`📉 ${symbol.symbol}: LTP still above HMA, waiting for drop`);
        }
      }
    }
    
    return result;
  }

  /**
   * Execute a BUY SL-L order (Stop Loss - Limit)
   * @param {Object} symbol - Symbol data
   * @param {number} limitPrice - Limit price (HMA value)
   * @param {Date} now - Current time
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Position data
   */
  static async executeLimitOrder(symbol, limitPrice, now, userId) {
    try {
      // Get the correct lot size based on the index
      const getLotSize = (indexName) => {
        switch (indexName?.toUpperCase()) {
          case 'NIFTY':
            return 75; // Minimum lot size for NIFTY
          case 'BANKNIFTY':
            return 35; // Minimum lot size for BANKNIFTY
          case 'SENSEX':
            return 20; // Minimum lot size for SENSEX
          default:
            return 75; // Default to NIFTY lot size
        }
      };
      
      // Round limit price to nearest tick size (0.0500)
      const roundToTickSize = (price, tickSize = 0.05) => {
        return Math.round(price / tickSize) * tickSize;
      };
      
      const lotSize = getLotSize(symbol.index?.name);
      // Ensure lots is a whole number and calculate quantity
      const lots = Math.floor(symbol.lots || 1); // Ensure lots is a whole number
      const quantity = lots * lotSize; // Calculate quantity based on lots and lot size
      const roundedLimitPrice = roundToTickSize(limitPrice);
      
      // Debug logging to check symbol data
      console.log(`🔍 [DEBUG] Symbol data for BUY SL-L order placement:`, {
        symbol: symbol.symbol,
        lots: symbol.lots,
        index: symbol.index,
        indexName: symbol.index?.name,
        calculatedQuantity: quantity,
        lotSize: lotSize,
        originalPrice: limitPrice,
        roundedPrice: roundedLimitPrice
      });
      
      // Prepare BUY SL-L order data according to Fyers API documentation
      // For BUY SL-L: stopPrice (trigger) should be LOWER than limitPrice
      const triggerPrice = roundedLimitPrice - 0.5; // Trigger 0.5 points BELOW limit price for BUY
      
      // Create alphanumeric order tag (max 30 chars, no special characters)
      const orderTag = `VICTORYBUY${Date.now().toString().slice(-8)}`;
      
      const buyOrderData = {
        symbol: symbol.symbol,
        qty: quantity,
        type: 4, // Stop Limit Order (SL-L)
        side: 1, // Buy
        productType: symbol.productType || 'INTRADAY',
        limitPrice: roundedLimitPrice, // Buy price (HMA value)
        stopPrice: triggerPrice, // Trigger price (0.5 points BELOW limit for BUY)
        disclosedQty: 0,
        validity: 'DAY',
        offlineOrder: false,
        stopLoss: 0,
        takeProfit: 0,
        orderTag: orderTag // Alphanumeric only, max 30 chars
      };
      
      console.log(`📋 [BUY SL-L ORDER] Placing BUY SL-L order:`, buyOrderData);
      
      // Use live trade service to place BUY SL-L order
      const tradeResult = await TradeService.placeLiveTrade({
        symbol: symbol.symbol,
        quantity: quantity,
        price: roundedLimitPrice,
        action: 'BUY',
        orderType: 'SL_LIMIT', // BUY SL-L order type
        productType: symbol.productType || 'INTRADAY',
        userId,
        offlineOrder: false, // This is a live order
        orderData: buyOrderData // Pass complete order data
      });
      
      // Check if order was rejected during placement
      if (!tradeResult || !tradeResult.success) {
        throw new Error(`BUY SL-L order placement failed: ${tradeResult?.message || 'Unknown error'}`);
      }
      
      const position = {
        id: `${symbol.symbol}-${now.getTime()}`,
        symbol: symbol.symbol,
        type: symbol.type,
        lots: symbol.lots,
        quantity: quantity,
        boughtPrice: roundedLimitPrice,
        currentPrice: roundedLimitPrice,
        target: roundedLimitPrice + parseFloat(symbol.targetPoints || 0),
        stopLoss: roundedLimitPrice - parseFloat(symbol.stopLossPoints || 0),
        initialStopLoss: roundedLimitPrice - parseFloat(symbol.stopLossPoints || 0),
        useTrailingStoploss: symbol.useTrailingStoploss || false,
        trailingX: symbol.trailingX || 20,
        trailingY: symbol.trailingY || 15,
        status: 'Pending', // Initially pending until BUY order is filled
        timestamp: now,
        tradingMode: 'LIVE',
        orderType: 'BUY_SL_LIMIT',
        productType: symbol.productType || 'INTRADAY',
        buyOrderId: tradeResult?.orderId || null, // Store BUY order ID
        sellOrderId: null, // Will be set when SELL SL-L order is placed
        orderStatus: 'PENDING', // Track order status from Fyers
        slStopPrice: null // Current SL stop price
      };
      
      console.log(`✅ [BUY SL-L ORDER] BUY SL-L order placed for ${symbol.symbol} at ${roundedLimitPrice} (trigger: ${triggerPrice})`);
      
      // Note: Trade logging will be handled by Fyers WebSocket when order status updates are received
      
      // Ensure WebSocket is connected for this new order
      await this.manageWebSocketConnection(userId);
      
      return position;
    } catch (error) {
      console.error(`❌ BUY SL-L order execution failed for ${symbol.symbol}:`, error);
      
      // Get lot size for error logging (define function here for scope)
      const getLotSizeForError = (indexName) => {
        switch (indexName?.toUpperCase()) {
          case 'NIFTY':
            return 75;
          case 'BANKNIFTY':
            return 35;
          case 'SENSEX':
            return 20;
          default:
            return 75; // Default to NIFTY lot size
        }
      };
      
      // Round limit price for error logging
      const roundToTickSize = (price, tickSize = 0.05) => {
        return Math.round(price / tickSize) * tickSize;
      };
      const roundedLimitPrice = roundToTickSize(limitPrice);
      
      // Note: Trade logging will be handled by Fyers WebSocket when order status updates are received
      
      // Check for margin shortfall and other permanent errors
      const isMarginShortfall = error.message && (
        error.message.includes('Margin Shortfall') || 
        error.message.includes('margin shortfall') ||
        error.message.includes('RED:Margin Shortfall')
      );
      const isInsufficientFunds = error.message && (
        error.message.includes('insufficient') ||
        error.message.includes('Insufficient')
      );
      
      // Log specific rejection reasons
      if (isMarginShortfall || isInsufficientFunds) {
        console.error(`💰 Margin shortfall/insufficient funds for ${symbol.symbol}: ${error.message}`);
        // For margin shortfall, throw the error so it can be handled in processSymbolSignal
        throw error;
      } else if (error.message.includes('insufficient')) {
        console.error(`💰 Insufficient funds for ${symbol.symbol}`);
      } else if (error.message.includes('invalid price')) {
        console.error(`💱 Invalid price for ${symbol.symbol} at ${roundedLimitPrice}`);
      } else if (error.message.includes('market closed')) {
        console.error(`⏰ Market closed for ${symbol.symbol}`);
      } else if (error.message.includes('token expired')) {
        console.error(`🔑 Fyers token expired for ${symbol.symbol}`);
      } else if (error.message.includes('validation parameter')) {
        console.error(`🔍 Validation parameter missing for ${symbol.symbol}`);
      } else if (error.message.includes('lot size')) {
        console.error(`📦 Lot size error for ${symbol.symbol} - check quantity calculation`);
      }
      
      return null;
    }
  }

  /**
   * Place SELL SL-M order when BUY order is filled
   * @param {Object} symbol - Symbol data
   * @param {string} buyOrderId - BUY order ID that was filled
   * @param {number} buyPrice - Price at which BUY order was filled
   * @param {string} userId - User ID
   * @returns {Promise<Object>} SELL order result
   */
  static async placeSellSLMOrder(symbol, buyOrderId, buyPrice, userId) {
    try {
      // Get the correct lot size based on the index
      const getLotSize = (indexName) => {
        switch (indexName?.toUpperCase()) {
          case 'NIFTY':
            return 75; // Minimum lot size for NIFTY
          case 'BANKNIFTY':
            return 35; // Minimum lot size for BANKNIFTY
          case 'SENSEX':
            return 20; // Minimum lot size for SENSEX
          default:
            return 75; // Default to NIFTY lot size
        }
      };
      
      // Round prices to nearest tick size (0.0500)
      const roundToTickSize = (price, tickSize = 0.05) => {
        return Math.round(price / tickSize) * tickSize;
      };
      
      const lotSize = getLotSize(symbol.index?.name);
      // Ensure lots is a whole number and calculate quantity
      const lots = Math.floor(symbol.lots || 1); // Ensure lots is a whole number
      const quantity = lots * lotSize;
      const stopLossPoints = parseFloat(symbol.stopLossPoints || 0);
      const stopLossPrice = buyPrice - stopLossPoints;
      const roundedStopLossPrice = roundToTickSize(stopLossPrice);
      
      // For SELL SL-L: stopPrice (trigger) should be HIGHER than limitPrice
      const triggerPrice = roundedStopLossPrice + 0.5; // Trigger 0.5 points ABOVE limit price for SELL
      
      // Create alphanumeric order tag (max 30 chars, no special characters)
      const orderTag = `VICTORYSELL${Date.now().toString().slice(-8)}`;
      
      const sellOrderData = {
        symbol: symbol.symbol,
        qty: quantity,
        type: 3, // Stop Market Order (SL-M)
        side: -1, // Sell
        productType: symbol.productType || 'INTRADAY',
        stopPrice: roundedStopLossPrice, // Stop loss trigger price
        disclosedQty: 0,
        validity: 'DAY',
        offlineOrder: false,
        stopLoss: 0,
        takeProfit: 0,
        orderTag: orderTag // Alphanumeric only, max 30 chars
      };
      
      console.log(`📋 [SELL SL-M ORDER] Placing SELL SL-M order:`, sellOrderData);
      
      // Use live trade service to place SELL SL-M order
      const tradeResult = await TradeService.placeLiveTrade({
        symbol: symbol.symbol,
        quantity: quantity,
        price: roundedStopLossPrice,
        action: 'SELL',
        orderType: 'SL_MARKET', // SELL SL-M order type
        productType: symbol.productType || 'INTRADAY',
        userId,
        offlineOrder: false,
        orderData: sellOrderData
      });
      
      // Check if order was rejected during placement
      if (!tradeResult || !tradeResult.success) {
        throw new Error(`SELL SL-L order placement failed: ${tradeResult?.message || 'Unknown error'}`);
      }
      
      console.log(`✅ [SELL SL-M ORDER] SELL SL-M order placed for ${symbol.symbol} at ${roundedStopLossPrice}`);
      
      // Note: Trade logging will be handled by Fyers WebSocket when order status updates are received
      
      return {
        success: true,
        sellOrderId: tradeResult?.orderId,
        stopLossPrice: roundedStopLossPrice,
        triggerPrice: roundedStopLossPrice
      };
      
    } catch (error) {
      console.error(`❌ SELL SL-M order placement failed for ${symbol.symbol}:`, error);
      
      // Note: Trade logging will be handled by Fyers WebSocket when order status updates are received
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Update active positions (simplified - WebSocket handles order status)
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Update results
   */
  static async updateActivePositions(userId) {
    try {
      const state = await TradingState.findOne({ userId });
      if (!state || state.activePositions.length === 0) return { updated: 0, closed: 0 };
      
      const symbolsToFetch = state.activePositions.map(p => p.symbol);
      const User = require('../models/User');
      const user = await User.findById(userId);
      const liveData = await MarketService.getQuotes(symbolsToFetch, user);
      
      let updated = 0;
      let closed = 0;
      
      for (const position of state.activePositions) {
        const liveQuote = liveData.find(d => d.symbol === position.symbol);
        if (!liveQuote) continue;
        
        const ltp = liveQuote.ltp;
        position.currentPrice = ltp;
        
        // Only calculate P&L and check targets for active positions
        if (position.status === 'Active') {
          const lotSize = position.index?.lotSize || 75;
        position.pnl = (ltp - position.boughtPrice) * Math.floor(position.lots || 1) * lotSize;
        position.pnlPercentage = ((ltp - position.boughtPrice) / position.boughtPrice) * 100;
        
        // Check for target or stop loss
          if (ltp >= position.target) {
          position.status = 'Target Hit';
          closed++;
              
              // Target hit - order modifications handled by trade service
              if (position.slOrderId) {
                console.log(`🎯 Target hit for ${position.symbol} - order modifications handled by trade service`);
                position.orderStatus = 'TARGET_EXIT_PENDING';
              }
          } else if (ltp <= position.stopLoss) {
          position.status = 'Stop Loss Hit';
          closed++;
              
              // Stop loss hit - order cancellations handled by trade service
              if (position.slOrderId) {
                console.log(`🛡️ Stop loss hit for ${position.symbol} - order cancellations handled by trade service`);
              }
            } else {
              // Position is still active - check for trailing stop loss modifications
              await this.updateTrailingStopLoss(position, ltp, userId);
          }
        }
        
        updated++;
      }
      
      // Remove closed positions and handle re-entries
      const closedPositions = state.activePositions.filter(p => p.status !== 'Active');
      state.activePositions = state.activePositions.filter(p => p.status === 'Active');
      
      // Handle re-entries for fully closed positions
      for (const closedPosition of closedPositions) {
        const origSymbol = state.monitoredSymbols.find(s => s.symbol === closedPosition.symbol && s.type === closedPosition.type);
        const maxReEntries = origSymbol ? origSymbol.maxReEntries : closedPosition.maxReEntries || 0;
        const reEntryCount = (closedPosition.reEntryCount || 0) + 1;
        
        if (maxReEntries > 0 && reEntryCount <= maxReEntries) {
          // Create re-entry symbol with reset state
          const reEntrySymbol = {
            ...origSymbol,
            reEntryCount,
            triggerStatus: 'WAITING',
            pendingSignal: null,
            lastUpdate: new Date(),
            orderPlaced: false, // Reset order placement flag
            orderPlacedAt: null, // Reset order placement time
            id: `${closedPosition.symbol}-${Date.now()}` // New unique ID
          };
          
          state.monitoredSymbols.push(reEntrySymbol);
          console.log(`🔁 Re-entry created for ${closedPosition.symbol} (${reEntryCount}/${maxReEntries})`);
        } else if (maxReEntries > 0) {
          console.log(`🚫 Max re-entries reached for ${closedPosition.symbol}`);
        }
      }
      
      if (closed > 0) {
        state.tradeExecutionState.totalPnL += closedPositions.reduce((sum, p) => sum + p.pnl, 0);
      }
      
      await state.save();
      
      // Manage WebSocket connection based on current trading activity
      await this.manageWebSocketConnection(userId);
      
      console.log(`📊 Updated ${updated} positions, closed ${closed} for user ${userId}`);
      return { updated, closed };
    } catch (error) {
      console.error('Error updating active positions:', error);
      throw error;
    }
  }

  /**
   * Update trailing stop loss for a position
   * @param {Object} position - Position data
   * @param {number} currentPrice - Current LTP
   * @param {string} userId - User ID
   */
  static async updateTrailingStopLoss(position, currentPrice, userId) {
    try {
      let newStopLoss = null;
      let reason = '';

      // Handle standard trailing stop loss (trail to cost)
      if (position.trailingStopLoss && currentPrice > position.boughtPrice) {
        newStopLoss = currentPrice - position.stopLossPoints;
        if (newStopLoss > position.stopLoss) {
          reason = 'Standard trailing';
        }
      }
      
      // Handle advanced trailing stoploss with X/Y parameters
      if (position.useTrailingStoploss && position.trailingX && position.trailingY) {
        const priceMovement = currentPrice - position.boughtPrice;
        
        // Only trail if price has moved up by at least X points
        if (priceMovement >= position.trailingX) {
          // Calculate how many "X" intervals we've moved
          const intervals = Math.floor(priceMovement / position.trailingX);
          
          // Calculate new stop loss based on Y points per X interval
          const slMovement = intervals * position.trailingY;
          const advancedStopLoss = position.initialStopLoss + slMovement;
          
          // Only update if the new stop loss is higher than current
          if (advancedStopLoss > position.stopLoss) {
            newStopLoss = advancedStopLoss;
            reason = `Advanced trailing (${intervals} intervals)`;
          }
        }
      }

      // Modify SL-M order if stop loss needs updating
      if (newStopLoss && newStopLoss > position.stopLoss && position.slOrderId) {
        console.log(`📈 ${reason} SL update for ${position.symbol}: ${position.stopLoss} → ${newStopLoss}`);
        
        // Stop loss modifications handled by trade service
        console.log(`📈 ${reason} SL update for ${position.symbol}: ${position.stopLoss} → ${newStopLoss}`);
        console.log(`📝 Stop loss modifications handled by trade service`);
        position.stopLoss = newStopLoss;
        position.slStopPrice = newStopLoss;
      }
    } catch (error) {
      console.error(`Error updating trailing stop loss for ${position.symbol}:`, error);
    }
  }

  /**
   * Modify SELL SL-L order based on trailing stop loss
   * @param {Object} symbol - Symbol data
   * @param {number} currentPrice - Current market price
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} Success status
   */
  static async modifySellSLLOrderForTrailingStop(symbol, currentPrice, userId) {
    try {
      // Only modify if SELL order is placed and still pending
      if (!symbol.sellOrderId || symbol.orderStatus !== 'PENDING') {
        console.log(`⚠️ Cannot modify SELL SL-L order for ${symbol.symbol}: SELL order not placed or not pending`);
        return false;
      }

      // Calculate new trailing stop loss price
      const newStopLossPrice = this.calculateTrailingStopLoss(symbol, currentPrice);
      
      if (!newStopLossPrice || newStopLossPrice <= symbol.slStopPrice) {
        console.log(`📊 No trailing stop loss update needed for ${symbol.symbol}: current=${symbol.slStopPrice}, new=${newStopLossPrice}`);
        return false;
      }

      console.log(`🔄 Modifying SELL SL-L order for ${symbol.symbol}: SL ${symbol.slStopPrice} → ${newStopLossPrice}`);

      // Cancel existing SELL SL-L order
      const cancelResult = await TradeService.cancelOrder(symbol.sellOrderId, userId);
      if (!cancelResult.success) {
        console.error(`❌ Failed to cancel SELL SL-L order ${symbol.sellOrderId} for ${symbol.symbol}`);
        return false;
      }

      // Place new SELL SL-L order with updated stop loss price
      const sellOrderResult = await this.placeSellSLLOrder(symbol, symbol.orderId, currentPrice, userId);
      
      if (sellOrderResult.success) {
        // Update active position with new SELL order details and track modification
        const TradingState = require('../models/TradingState');
        await TradingState.updateOne(
          { userId, 'activePositions.sellOrderId': symbol.sellOrderId },
          {
            $set: {
              'activePositions.$.sellOrderId': sellOrderResult.sellOrderId,
              'activePositions.$.slStopPrice': sellOrderResult.stopLossPrice,
              'activePositions.$.slTriggerPrice': sellOrderResult.triggerPrice
            },
            $push: {
              'activePositions.$.slModifications': {
                timestamp: new Date(),
                oldStopLoss: symbol.slStopPrice,
                newStopLoss: sellOrderResult.stopLossPrice,
                reason: `Trailing stop loss update: ${symbol.slStopPrice} → ${sellOrderResult.stopLossPrice}`,
                orderId: sellOrderResult.sellOrderId
              }
            }
          }
        );

        console.log(`✅ SELL SL-L order modified for ${symbol.symbol} at new stop loss: ${sellOrderResult.stopLossPrice}`);
        return true;
      } else {
        // Order modification failed
        console.error(`❌ SELL SL-L order modification failed for ${symbol.symbol}`);
        return false;
      }
    } catch (error) {
      console.error(`❌ Error modifying SELL SL-L order for ${symbol.symbol}:`, error);
      return false;
    }
  }

  /**
   * Calculate trailing stop loss price
   * @param {Object} symbol - Symbol data
   * @param {number} currentPrice - Current market price
   * @returns {number|null} New stop loss price or null if no update needed
   */
  static calculateTrailingStopLoss(symbol, currentPrice) {
    try {
      if (!symbol.useTrailingStoploss || !symbol.slStopPrice) {
        return null;
      }

      const { trailingX, trailingY, stopLossPoints } = symbol;
      const initialStopLoss = symbol.slStopPrice + parseFloat(stopLossPoints || 0); // Convert back to entry price
      
      // Calculate trailing stop loss using the same logic as in updateTrailingStopLoss
      let newStopLoss = symbol.slStopPrice;
      
      if (currentPrice > initialStopLoss) {
        // Price is above entry, calculate trailing stop loss
        const profit = currentPrice - initialStopLoss;
        const trailingAmount = Math.floor(profit / trailingX) * trailingY;
        const calculatedStopLoss = initialStopLoss + trailingAmount;
        
        // Only update if new stop loss is higher than current
        if (calculatedStopLoss > symbol.slStopPrice) {
          newStopLoss = calculatedStopLoss;
        }
      }
      
      return newStopLoss > symbol.slStopPrice ? newStopLoss : null;
    } catch (error) {
      console.error('Error calculating trailing stop loss:', error);
      return null;
    }
  }

  /**
   * Get monitoring status for a user
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Monitoring status
   */
  static async getMonitoringStatus(userId) {
    try {
      const state = await TradingState.findOne({ userId });
      if (!state) {
        return {
          isMonitoring: false,
          monitoredSymbols: [],
          activePositions: [],
          pendingOrders: [],
          tradeExecutionState: {
            isMonitoring: false,
            totalTradesExecuted: 0,
            totalPnL: 0
          }
        };
      }
      
      // Separate active positions from pending orders
      const activePositions = state.activePositions.filter(p => p.status === 'Active');
      const pendingOrders = state.activePositions.filter(p => p.status === 'Pending');
      
      return {
        isMonitoring: state.tradeExecutionState.isMonitoring,
        monitoredSymbols: state.monitoredSymbols,
        activePositions: activePositions,
        pendingOrders: pendingOrders,
        tradeExecutionState: state.tradeExecutionState
      };
    } catch (error) {
      console.error('Error getting monitoring status:', error);
      throw error;
    }
  }

  /**
   * Cancel an order on Fyers
   * @param {string} orderId - Fyers order ID
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} Success status
   */
  static async cancelOrder(orderId, userId) {
    try {
      const User = require('../models/User');
      const user = await User.findById(userId);
      
      if (!user || !user.fyers || !user.fyers.accessToken) {
        throw new Error('No valid Fyers access token found');
      }
      
      const response = await axios.delete(`https://api.fyers.in/api/v2/orders/${orderId}`, {
        headers: {
          'Authorization': user.fyers.accessToken
        }
      });
      
      if (response.data && response.data.s === 'ok') {
        console.log(`✅ Order ${orderId} cancelled successfully`);
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('Error cancelling order:', error);
      return false;
    }
  }

  /**
   * Get live quote for a symbol
   * @param {string} symbol - Symbol to get quote for
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Live quote data
   */
  static async getLiveQuote(symbol, userId) {
    try {
      const User = require('../models/User');
      const user = await User.findById(userId);
      const liveData = await MarketService.getQuotes([symbol], user);
      return liveData.find(d => d.symbol === symbol);
    } catch (error) {
      console.error('Error getting live quote:', error);
      return null;
    }
  }

  /**
   * Check if WebSocket connection should be active
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} Whether connection should be active
   */
  static async shouldKeepWebSocketActive(userId) {
    try {
      const TradingState = require('../models/TradingState');
      const state = await TradingState.findOne({ userId });
      
      if (!state) return false;
      
      // Check if there are any pending or active positions
      const hasActivePositions = state.activePositions && state.activePositions.length > 0;
      const hasPendingOrders = state.activePositions && state.activePositions.some(p => p.status === 'Pending');
      const hasMonitoredSymbols = state.monitoredSymbols && state.monitoredSymbols.length > 0;
      
      // Keep WebSocket active if there are pending orders, active positions, or monitored symbols
      return hasActivePositions || hasPendingOrders || hasMonitoredSymbols;
    } catch (error) {
      console.error('Error checking WebSocket status:', error);
      return false;
    }
  }

  /**
   * Manage WebSocket connection based on trading activity
   * @param {string} userId - User ID
   */
  static async manageWebSocketConnection(userId) {
    try {
      const shouldBeActive = await this.shouldKeepWebSocketActive(userId);
      
      // Check if WebSocket should be active globally
      const globalShouldBeActive = await fyersWebSocketService.shouldBeActive();
      
      if (shouldBeActive && !globalShouldBeActive) {
        console.log(`🔌 Starting WebSocket for user ${userId} - monitoring activity detected`);
        await fyersWebSocketService.startConnection();
      } else if (!shouldBeActive && globalShouldBeActive) {
        console.log(`🔌 Stopping WebSocket for user ${userId} - no monitoring activity`);
        // Only stop if no other users have activity
        const otherUsersActive = await this.checkOtherUsersActivity(userId);
        if (!otherUsersActive) {
          fyersWebSocketService.disconnect();
        }
      }
      
      console.log(`🔌 WebSocket status: ${shouldBeActive ? 'Should be active' : 'Should be inactive'} for user ${userId}`);
    } catch (error) {
      console.error('Error managing WebSocket connection:', error);
    }
  }

  /**
   * Check if other users have active monitoring or positions
   * @param {string} excludeUserId - User ID to exclude from check
   * @returns {Promise<boolean>} Whether other users have activity
   */
  static async checkOtherUsersActivity(excludeUserId) {
    try {
      const TradingState = require('../models/TradingState');
      
      // Check for other users with active monitoring
      const otherActiveMonitoring = await TradingState.findOne({
        userId: { $ne: excludeUserId },
        'tradeExecutionState.isMonitoring': true
      });
      
      if (otherActiveMonitoring) {
        return true;
      }
      
      // Check for other users with active positions
      const otherActivePositions = await TradingState.findOne({
        userId: { $ne: excludeUserId },
        'activePositions': { $exists: true, $ne: [] }
      });
      
      if (otherActivePositions) {
        return true;
      }
      
      // Check for other users with pending orders
      const otherPendingOrders = await TradingState.findOne({
        userId: { $ne: excludeUserId },
        'monitoredSymbols.orderId': { $exists: true, $ne: null }
      });
      
      return !!otherPendingOrders;
    } catch (error) {
      console.error('Error checking other users activity:', error);
      return false;
    }
  }

  /**
   * Handle order status update from Fyers WebSocket
   * @param {string} orderId - Fyers order ID
   * @param {string} status - Order status (FILLED, REJECTED, CANCELLED)
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Update result
   */
  static async handleOrderStatusUpdate(orderId, status, userId, remarks = '', fillPriceFromFyers = null) {
    try {
      const TradingState = require('../models/TradingState');
      
      // Find the symbol with this order ID
      const state = await TradingState.findOne({
        userId,
        'monitoredSymbols.orderId': orderId
      });
      
      if (!state) {
        console.log(`⚠️ No symbol found with order ID: ${orderId}`);
        return { success: false, message: 'Symbol not found' };
      }
      
      const symbol = state.monitoredSymbols.find(s => s.orderId === orderId);
      if (!symbol) {
        console.log(`⚠️ Symbol not found for order ID: ${orderId}`);
        return { success: false, message: 'Symbol not found' };
      }
      
      console.log(`📊 Order status update for ${symbol.symbol}: ${status}`);
      
      let newStatus = 'WAITING';
      let shouldRemove = false;
      let shouldMoveToPositions = false;
      let sellOrderResult = null;
      
      switch (status) {
        case 'FILLED':
          // Check if this is a BUY order (by checking orderTag or orderType)
          const isBuyOrder = symbol.orderType === 'BUY_SL_LIMIT' || 
                           (symbol.orderId && symbol.orderId === orderId);
          
          if (isBuyOrder) {
            console.log(`✅ BUY order filled for ${symbol.symbol}, creating active position and placing SELL SL-L order`);
            // Use the real fill price from Fyers if provided
            const fillPrice = fillPriceFromFyers || symbol.hmaValue || symbol.lastHmaValue;
            
            // Create active position immediately when BUY order is filled
            const position = {
              id: `${symbol.symbol}-${Date.now()}`,
              symbol: symbol.symbol,
              type: symbol.type,
              lots: Math.floor(symbol.lots || 1),
              quantity: Math.floor(symbol.lots || 1) * (symbol.index?.lotSize || 75),
              boughtPrice: fillPrice, // Entry price when BUY order filled
              currentPrice: fillPrice,
              target: fillPrice + parseFloat(symbol.targetPoints || 0),
              stopLoss: fillPrice - parseFloat(symbol.stopLossPoints || 0),
              initialStopLoss: fillPrice - parseFloat(symbol.stopLossPoints || 0),
              useTrailingStoploss: symbol.useTrailingStoploss || false,
              trailingX: symbol.trailingX || 20,
              trailingY: symbol.trailingY || 15,
              status: 'Active',
              timestamp: new Date(),
              tradingMode: 'LIVE',
              orderType: 'BUY_SL_LIMIT',
              productType: symbol.productType || 'INTRADAY',
              buyOrderId: orderId, // Store the BUY order ID
              sellOrderId: null, // Will be set when SELL order is placed
              slOrder: null,
              reEntryCount: symbol.reEntryCount || 0,
              pnl: 0,
              pnlPercentage: 0,
              hmaValue: symbol.hmaValue,
              index: symbol.index || { name: 'NIFTY', lotSize: 75 },
              slStopPrice: null, // Will be set when SELL order is placed
              slModifications: [], // Track SL modifications
              invested: (Math.floor(symbol.lots || 1) * (symbol.index?.lotSize || 75)) * fillPrice // Qty * bought price
            };
            
            // Add to active positions
            await TradingState.updateOne(
              { userId },
              { $push: { activePositions: position } }
            );
            
            console.log(`✅ ${symbol.symbol} moved to active positions with invested amount: ₹${position.invested}`);
            
            // Place SELL SL-L order immediately for stop loss protection
            console.log(`🛡️ Placing SELL SL-L order for ${symbol.symbol} at stop loss price`);
            sellOrderResult = await this.placeSellSLLOrder(symbol, orderId, fillPrice, userId);
            
            if (sellOrderResult.success) {
              // Update the active position with SELL order details
              await TradingState.updateOne(
                { userId, 'activePositions.buyOrderId': orderId },
                {
                  $set: {
                    'activePositions.$.sellOrderId': sellOrderResult.sellOrderId,
                    'activePositions.$.slStopPrice': sellOrderResult.stopLossPrice,
                    'activePositions.$.slTriggerPrice': sellOrderResult.triggerPrice
                  }
                }
              );
              
              console.log(`✅ SELL SL-L order placed for ${symbol.symbol} - Order ID: ${sellOrderResult.sellOrderId}`);
              console.log(`📊 Stop Loss Price: ${sellOrderResult.stopLossPrice}, Trigger Price: ${sellOrderResult.triggerPrice}`);
            } else {
              console.log(`❌ SELL SL-L order placement failed for ${symbol.symbol}: ${sellOrderResult.error}`);
            }
            
            // Remove from monitored symbols since it's now an active position
            await TradingState.updateOne(
              { userId },
              { $pull: { monitoredSymbols: { id: symbol.id } } }
            );
            
            shouldMoveToPositions = true;
            newStatus = 'ENTERED';
          } else {
            // This is a SELL order (stop loss hit) - position should be closed
            console.log(`✅ SELL order filled for ${symbol.symbol} (stop loss hit), closing position`);
            
            // Find and update the active position
            await TradingState.updateOne(
              { userId, 'activePositions.sellOrderId': orderId },
              {
                $set: {
                  'activePositions.$.status': 'CLOSED',
                  'activePositions.$.exitPrice': symbol.hmaValue || symbol.lastHmaValue,
                  'activePositions.$.exitTimestamp': new Date()
                }
              }
            );
            
            newStatus = 'CLOSED';
          }
          break;
          
        case 'REJECTED':
          // Show ORDER_REJECTED status first, then allow re-entry
          newStatus = 'ORDER_REJECTED';
          console.log(`❌ Order rejected for ${symbol.symbol}, showing rejection status`);
          
          // After a delay, allow re-entry (this will be handled by the monitoring cycle)
          // The symbol stays in monitoring with ORDER_REJECTED status
          break;
          
        case 'CANCELLED':
          newStatus = 'WAITING';
          console.log(`🔄 Order cancelled for ${symbol.symbol}, resetting to waiting`);
          break;
          
        default:
          console.log(`📊 Unknown order status: ${status} for ${symbol.symbol}`);
          return { success: false, message: 'Unknown order status' };
      }
      
      // Update symbol status (only if still in monitored symbols)
      if (!shouldMoveToPositions) {
        await TradingState.updateOne(
          { userId, 'monitoredSymbols.id': symbol.id },
          {
            $set: {
              'monitoredSymbols.$.triggerStatus': newStatus,
              'monitoredSymbols.$.orderStatus': status
            }
          }
        );
      }
      
      // If should remove, remove from monitored symbols
      if (shouldRemove) {
        await TradingState.updateOne(
          { userId },
          { $pull: { monitoredSymbols: { id: symbol.id } } }
        );
        console.log(`🗑️ ${symbol.symbol} removed from monitoring`);
      }
      
      return { 
        success: true, 
        symbolRemoved: shouldRemove,
        movedToPositions: shouldMoveToPositions,
        newStatus,
        sellOrderPlaced: sellOrderResult?.success || false
      };
      
    } catch (error) {
      console.error('Error handling order status update:', error);
      return { success: false, message: error.message };
    }
  }

  /**
   * Exit an active position
   * @param {string} positionId - Position ID to exit
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Exit result
   */
  static async exitPosition(positionId, userId) {
    try {
      const TradingState = require('../models/TradingState');
      
      // Find the position
      const state = await TradingState.findOne({
        userId,
        'activePositions.id': positionId
      });
      
      if (!state) {
        throw new Error('Position not found');
      }
      
      const position = state.activePositions.find(p => p.id === positionId);
      if (!position) {
        throw new Error('Position not found');
      }
      
      console.log(`🔄 Exiting position for ${position.symbol}`);
      
      // Cancel any pending SELL SL-L order
      if (position.sellOrderId) {
        try {
          await TradeService.cancelOrder(position.sellOrderId, userId);
          console.log(`✅ Cancelled SELL SL-L order ${position.sellOrderId} for ${position.symbol}`);
        } catch (error) {
          console.error(`❌ Failed to cancel SELL SL-L order: ${error.message}`);
        }
      }
      
      // Place market sell order to exit position
      const exitOrderData = {
        symbol: position.symbol,
        qty: position.quantity,
        type: 2, // Market Order
        side: -1, // Sell
        productType: position.productType || 'INTRADAY',
        limitPrice: 0,
        stopPrice: 0,
        disclosedQty: 0,
        validity: 'DAY',
        offlineOrder: false,
        stopLoss: 0,
        takeProfit: 0,
        orderTag: `VICTORYEXIT${Date.now().toString().slice(-8)}`
      };
      
      const exitResult = await TradeService.placeLiveTrade({
        symbol: position.symbol,
        quantity: position.quantity,
        price: 0, // Market order
        action: 'SELL',
        orderType: 'MARKET',
        productType: position.productType || 'INTRADAY',
        userId,
        offlineOrder: false,
        orderData: exitOrderData
      });
      
      if (exitResult.success) {
        // Update position status
        await TradingState.updateOne(
          { userId, 'activePositions.id': positionId },
          {
            $set: {
              'activePositions.$.status': 'CLOSED',
              'activePositions.$.exitPrice': position.currentPrice || position.boughtPrice,
              'activePositions.$.exitTimestamp': new Date(),
              'activePositions.$.exitOrderId': exitResult.orderId
            }
          }
        );
        
        console.log(`✅ Position exited successfully for ${position.symbol}`);
        
        return {
          success: true,
          message: 'Position exited successfully',
          orderId: exitResult.orderId
        };
      } else {
        throw new Error(`Failed to place exit order: ${exitResult.message}`);
      }
      
    } catch (error) {
      console.error(`❌ Error exiting position:`, error);
      return {
        success: false,
        message: error.message
      };
    }
  }

  /**
   * Create trade log with remarks for order status updates
   * @param {string} orderId - Order ID
   * @param {string} status - Order status
   * @param {string} remarks - Remarks from Fyers
   * @param {string} userId - User ID
   * @param {Object} symbol - Symbol data
   */
  static async createTradeLogWithRemarks(orderId, status, remarks, userId, symbol) {
    try {
      const TradeLog = require('../models/TradeLog');
      
      // Map status to action
      let action = 'ORDER_PLACED';
      let remarksText = remarks || `Order status: ${status}`;
      
      switch (status) {
        case 'FILLED':
          action = 'ORDER_FILLED';
          remarksText = `Order executed successfully - ${remarks || ''}`;
          break;
        case 'REJECTED':
          action = 'ORDER_REJECTED';
          remarksText = `Order rejected by exchange - ${remarks || ''}`;
          break;
        case 'CANCELLED':
          action = 'ORDER_CANCELLED';
          remarksText = `Order cancelled - ${remarks || ''}`;
          break;
        case 'PARTIALLY_FILLED':
          action = 'ORDER_FILLED';
          remarksText = `Order partially filled - ${remarks || ''}`;
          break;
        case 'MODIFIED':
          action = 'ORDER_MODIFIED';
          remarksText = `Order modified - ${remarks || ''}`;
          break;
      }
      
      const tradeLog = new TradeLog({
        userId,
        symbol: symbol.symbol,
        orderId: orderId,
        action: action,
        orderType: symbol.orderType || 'LIMIT',
        quantity: symbol.quantity || symbol.lots * (symbol.index?.lotSize || 75),
        price: symbol.hmaValue || symbol.lastHmaValue || 0,
        side: symbol.orderType?.includes('BUY') ? 'BUY' : 'SELL',
        productType: symbol.productType || 'INTRADAY',
        status: status.toUpperCase(),
        reason: symbol.reason || 'ENTRY',
        timestamp: new Date(),
        details: {
          symbol: symbol.symbol,
          orderId: orderId,
          status: status
        },
        pnl: 0,
        pnlPercentage: 0,
        tradeType: 'LIVE',
        remarks: remarksText,
        fyersOrderId: orderId,
        fyersOrderStatus: status,
        fyersRemarks: remarks || ''
      });
      
      await tradeLog.save();
      console.log(`📝 Trade log created for ${symbol.symbol} - ${status}: ${remarksText}`);
      
      return tradeLog;
    } catch (error) {
      console.error('Error creating trade log with remarks:', error);
      throw error;
    }
  }

  /**
   * Place a limit order for a specific monitored symbol
   * @param {string} symbolId - The ID of the monitored symbol
   * @param {string} userId - The user ID
   * @returns {Object} Result of the order placement
   */
  static async placeLimitOrderForSymbol(symbolId, userId) {
    try {
      // Get the current trading state
      const state = await TradingState.findOne({ userId });
      if (!state) {
        return {
          success: false,
          message: 'Trading state not found'
        };
      }

      // Find the symbol in monitored symbols
      const symbol = state.monitoredSymbols.find(s => s.id === symbolId);
      if (!symbol) {
        return {
          success: false,
          message: 'Symbol not found in monitored symbols'
        };
      }

      // Check if order is already placed
      if (symbol.orderPlaced && symbol.orderStatus === 'PENDING' && symbol.orderId) {
        return {
          success: false,
          message: 'Order already placed and pending'
        };
      }

      // Get current HMA value
      const hmaValue = symbol.hmaValue || 0;
      if (hmaValue <= 0) {
        return {
          success: false,
          message: 'HMA value not available'
        };
      }

      // Get current LTP
      const ltp = await this.getLiveQuote(symbol.symbol, userId);
      if (!ltp) {
        return {
          success: false,
          message: 'Unable to get live quote'
        };
      }

      console.log(`🎯 Manually placing limit order for ${symbol.symbol} at HMA: ${hmaValue}, LTP: ${ltp}`);

      // Place limit order at HMA value
      const now = new Date();
      const position = await this.executeLimitOrder(symbol, hmaValue, now, userId);

      if (position) {
        // Update symbol status to ORDER_PLACED
        await TradingState.updateOne(
          { userId, 'monitoredSymbols.id': symbolId },
          {
            $set: {
              'monitoredSymbols.$.triggerStatus': 'ORDER_PLACED',
              'monitoredSymbols.$.orderPlaced': true,
              'monitoredSymbols.$.orderPlacedAt': now,
              'monitoredSymbols.$.orderId': position.buyOrderId,
              'monitoredSymbols.$.orderStatus': 'PENDING',
              'monitoredSymbols.$.lastHmaValue': hmaValue,
              'monitoredSymbols.$.orderModificationReason': 'Manual limit order placement'
            }
          }
        );

        console.log(`✅ Manual limit order placed for ${symbol.symbol} at ${hmaValue}`);
        
        return {
          success: true,
          message: `Limit order placed successfully for ${symbol.symbol}`,
          data: {
            symbol: symbol.symbol,
            orderId: position.buyOrderId,
            limitPrice: hmaValue,
            ltp: ltp
          }
        };
      } else {
        // Order was rejected
        await TradingState.updateOne(
          { userId, 'monitoredSymbols.id': symbolId },
          {
            $set: {
              'monitoredSymbols.$.triggerStatus': 'ORDER_REJECTED',
              'monitoredSymbols.$.orderStatus': 'REJECTED',
              'monitoredSymbols.$.orderPlacedAt': now,
              'monitoredSymbols.$.orderModificationReason': 'Manual order placement failed'
            }
          }
        );

        return {
          success: false,
          message: 'Order placement failed'
        };
      }
    } catch (error) {
      console.error('Error placing manual limit order:', error);
      
      // Update status to rejected
      await TradingState.updateOne(
        { userId, 'monitoredSymbols.id': symbolId },
        {
          $set: {
            'monitoredSymbols.$.triggerStatus': 'ORDER_REJECTED',
            'monitoredSymbols.$.orderStatus': 'REJECTED',
            'monitoredSymbols.$.orderPlacedAt': new Date(),
            'monitoredSymbols.$.orderModificationReason': error.message
          }
        }
      );

      return {
        success: false,
        message: `Error placing order: ${error.message}`
      };
    }
  }
}

module.exports = { MonitoringService }; 