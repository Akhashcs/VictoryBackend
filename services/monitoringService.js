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
      
      // Fetch current LTP and HMA values to determine initial status
      let initialStatus = 'WAITING_FOR_REVERSAL'; // Default fallback
      let orderModificationReason = 'Initial status - waiting for data';
      let pendingSignal = null;
      
      try {
        const User = require('../models/User');
        const user = await User.findById(userId);
        if (user) {
          // Fetch HMA value
          const hmaData = await HMAService.fetchAndCalculateHMA(symbolData.symbol, user);
          const hmaValue = hmaData.currentHMA || hmaData.hmaValue;
          
          // Fetch current LTP
          const liveQuote = await this.getLiveQuote(symbolData.symbol, userId);
          const ltp = liveQuote?.ltp;
          
          if (hmaValue && ltp) {
            console.log(`🔍 ${symbolData.symbol}: LTP=${ltp}, HMA=${hmaValue}`);
            
            if (ltp > hmaValue) {
              // LTP > HMA: Waiting for Reversal
              initialStatus = 'WAITING_FOR_REVERSAL';
              orderModificationReason = 'LTP above HMA - waiting for reversal crossover';
              pendingSignal = {
                direction: 'REVERSAL',
                triggeredAt: new Date(),
                hmaAtTrigger: hmaValue,
                ltpAtTrigger: ltp,
                state: 'WAITING',
                reversalDetected: false,
                confirmationTimer: null
              };
            } else {
              // LTP ≤ HMA: Waiting for Entry
              initialStatus = 'WAITING_FOR_ENTRY';
              orderModificationReason = 'LTP below HMA - ready for bullish crossover entry';
              pendingSignal = {
                direction: 'ENTRY',
                triggeredAt: new Date(),
                hmaAtTrigger: hmaValue,
                ltpAtTrigger: ltp,
                state: 'WAITING',
                reversalConfirmed: true,
                entryReadyAt: new Date()
              };
            }
            
            console.log(`✅ ${symbolData.symbol}: Categorized as ${initialStatus}`);
          } else {
            console.log(`⚠️ ${symbolData.symbol}: Could not fetch LTP or HMA, using default status`);
          }
        } else {
          console.error(`User not found for userId: ${userId}`);
        }
      } catch (error) {
        console.error(`Error fetching initial data for ${symbolData.symbol}:`, error);
      }
      
      const newSymbol = {
        id: `${symbolData.symbol}-${Date.now()}`,
        ...symbolData,
        useTrailingStoploss: symbolData.useTrailingStoploss || false,
        trailingX: symbolData.trailingX || 20,
        trailingY: symbolData.trailingY || 15,
        triggerStatus: initialStatus,
        pendingSignal: pendingSignal,
        orderModificationReason: orderModificationReason,
        lastUpdate: new Date(),
        tradesToday: 0, // Track number of trades taken today
        opportunityActive: false, // Track if an opportunity is being processed
        lastOpportunityTime: null, // Timestamp of last opportunity
        maxPerDay: 4 // Default daily trade limit
      };
      
      state.monitoredSymbols.push(newSymbol);
      await state.save();
      
      console.log(`📊 Added ${symbolData.symbol} to monitoring for user ${userId} with status: ${initialStatus}`);
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
        // Only log this once per minute per user to reduce spam
        const now = Date.now();
        if (!this.lastNoStateLogs || !this.lastNoStateLogs[userId] || (now - this.lastNoStateLogs[userId]) > 60000) {
          console.log(`📊 No trading state or monitored symbols found for user ${userId}`);
          if (!this.lastNoStateLogs) this.lastNoStateLogs = {};
          this.lastNoStateLogs[userId] = now;
        }
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
      
      // Check if user has valid Fyers connection
      if (!user || !user.fyers || !user.fyers.connected) {
        console.warn(`[MonitoringService] User ${userId} has no valid Fyers connection - skipping monitoring cycle`);
        return results;
      }
      
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
          
          // Keep symbols in monitoring regardless of trade status
          if (updatedSymbol.executed) {
            results.executed++;
            console.log(`✅ Trade executed for ${symbol.symbol}, keeping in monitoring for next opportunity`);
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
      
      // REMOVED: Update monitoredSymbols array to persist symbol removals
      // updateFields['monitoredSymbols'] = state.monitoredSymbols;
      
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
    
    // Only allow up to maxPerDay trades per day
    if (symbol.tradesToday >= (symbol.maxPerDay || 4)) {
      console.log(`🚫 Max trades per day reached for ${symbol.symbol}`);
      // Don't return here; allow state machine to update status
    }

    // If order was rejected, keep it in monitoring with REJECTED status (no re-entry)
    if (symbol.orderStatus === 'REJECTED') {
      console.log(`❌ Order was rejected for ${symbol.symbol} - keeping in monitoring with REJECTED status`);
      // Do nothing - keep symbol in monitoring with REJECTED status until user manually removes it
      return result;
    }

    // --- STATE MACHINE LOGIC FOR EXISTING STATES ONLY ---
    // This method only handles state transitions, NOT initial categorization
    // Initial categorization (LTP > HMA vs LTP <= HMA) happens only in addSymbolToMonitoring()
    
    const TradingState = require('../models/TradingState');

    // Only process if symbol already has a pendingSignal (was categorized during addSymbolToMonitoring)
    if (!symbol.pendingSignal) {
      console.log(`📊 ${symbol.symbol}: No pending signal - skipping state machine processing`);
      return result;
    }

    // Handle REVERSAL state transitions
    if (symbol.pendingSignal.direction === 'REVERSAL') {
      if (symbol.pendingSignal.state === 'WAITING') {
        // We're already waiting for reversal - check if LTP has crossed below HMA
        if (ltp <= hma) {
          // Reversal detected! Start 15-minute confirmation timer
          symbol.pendingSignal.state = 'CONFIRMING';
          symbol.pendingSignal.reversalDetected = true;
          symbol.pendingSignal.confirmationStartTime = now;
          symbol.pendingSignal.confirmationEndTime = new Date(now.getTime() + 15 * 60 * 1000); // 15 minutes
          // Update status to CONFIRMING_REVERSAL
          await TradingState.updateOne(
            { userId, 'monitoredSymbols.id': symbol.id },
            {
              $set: {
                'monitoredSymbols.$.triggerStatus': 'CONFIRMING_REVERSAL',
                'monitoredSymbols.$.pendingSignal': symbol.pendingSignal,
                'monitoredSymbols.$.orderModificationReason': 'Reversal detected - 15-minute confirmation timer started'
              }
            }
          );
          console.log(`⏰ ${symbol.symbol}: 15-minute confirmation timer started, ends at ${symbol.pendingSignal.confirmationEndTime}`);
        }
      } else if (symbol.pendingSignal.state === 'CONFIRMING') {
        // We're in confirmation phase - check if timer has expired or if LTP went back above HMA
        if (ltp > hma) {
          // LTP went back above HMA during confirmation - cancel timer and go back to waiting
          symbol.pendingSignal.state = 'WAITING';
          symbol.pendingSignal.reversalDetected = false;
          symbol.pendingSignal.confirmationStartTime = null;
          symbol.pendingSignal.confirmationEndTime = null;
          // Update status back to WAITING_FOR_REVERSAL
          await TradingState.updateOne(
            { userId, 'monitoredSymbols.id': symbol.id },
            {
              $set: {
                'monitoredSymbols.$.triggerStatus': 'WAITING_FOR_REVERSAL',
                'monitoredSymbols.$.pendingSignal': symbol.pendingSignal,
                'monitoredSymbols.$.opportunityActive': false, // Reset opportunity flag when confirmation is canceled
                'monitoredSymbols.$.orderModificationReason': 'Confirmation canceled - LTP back above HMA'
              }
            }
          );
          console.log(`🔄 ${symbol.symbol}: Back to waiting for reversal`);
        } else if (now >= symbol.pendingSignal.confirmationEndTime) {
          // 15-minute timer expired and LTP is still below HMA - move to "Waiting for Entry" state
          symbol.pendingSignal.direction = 'ENTRY';
          symbol.pendingSignal.state = 'WAITING';
          symbol.pendingSignal.reversalConfirmed = true;
          symbol.pendingSignal.entryReadyAt = now;
          // Update status to WAITING_FOR_ENTRY
          await TradingState.updateOne(
            { userId, 'monitoredSymbols.id': symbol.id },
            {
              $set: {
                'monitoredSymbols.$.triggerStatus': 'WAITING_FOR_ENTRY',
                'monitoredSymbols.$.pendingSignal': symbol.pendingSignal,
                'monitoredSymbols.$.orderModificationReason': 'Reversal confirmed - waiting for bullish crossover'
              }
            }
          );
          console.log(`🎯 ${symbol.symbol}: Ready for entry - waiting for LTP to cross above HMA`);
        } else {
          // Still in confirmation phase - show remaining time
          const remainingTime = Math.max(0, symbol.pendingSignal.confirmationEndTime - now);
          const remainingMinutes = Math.floor(remainingTime / (60 * 1000));
          const remainingSeconds = Math.floor((remainingTime % (60 * 1000)) / 1000);
          console.log(`⏰ ${symbol.symbol}: Confirming reversal - ${remainingMinutes}m ${remainingSeconds}s remaining`);
        }
      }
    }
    
    // Handle ENTRY state transitions
    if (symbol.pendingSignal.direction === 'ENTRY') {
      if (symbol.pendingSignal.state === 'WAITING') {
        // We're in "Waiting for Entry" state - check for bullish crossover
        if (ltp > hma) {
          // Bullish crossover detected! Start 5-minute candle confirmation
          console.log(`🚀 ${symbol.symbol}: Bullish crossover detected! LTP (${ltp}) > HMA (${hma}) - Starting 5-minute candle confirmation`);
          
          symbol.pendingSignal.state = 'CONFIRMING';
          symbol.pendingSignal.crossoverDetected = true;
          symbol.pendingSignal.crossoverTime = now;
          
          // Calculate the end of current 5-minute candle (MM:59)
          const currentMinute = now.getMinutes();
          const currentSecond = now.getSeconds();
          
          // Find the next 5-minute boundary (MM:59)
          const nextFiveMinBoundary = Math.ceil(currentMinute / 5) * 5 - 1; // 4, 9, 14, 19, 24, 29, 34, 39, 44, 49, 54, 59
          const minutesUntilBoundary = nextFiveMinBoundary - currentMinute;
          const secondsUntilBoundary = 59 - currentSecond;
          
          const totalSecondsUntilBoundary = minutesUntilBoundary * 60 + secondsUntilBoundary;
          symbol.pendingSignal.confirmationEndTime = new Date(now.getTime() + totalSecondsUntilBoundary * 1000);
          
          // Update status to CONFIRMING_ENTRY
          await TradingState.updateOne(
            { userId, 'monitoredSymbols.id': symbol.id },
            {
              $set: {
                'monitoredSymbols.$.triggerStatus': 'CONFIRMING_ENTRY',
                'monitoredSymbols.$.pendingSignal': symbol.pendingSignal,
                'monitoredSymbols.$.orderModificationReason': 'Bullish crossover detected - waiting for 5-minute candle close confirmation'
              }
            }
          );
          
          console.log(`⏰ ${symbol.symbol}: 5-minute candle confirmation started, ends at ${symbol.pendingSignal.confirmationEndTime}`);
        }
      } else if (symbol.pendingSignal.state === 'CONFIRMING') {
        // We're in confirmation phase - check if LTP went back below HMA or if timer expired
        if (ltp <= hma) {
          // LTP went back below HMA during confirmation - cancel confirmation and go back to waiting
          console.log(`❌ ${symbol.symbol}: LTP (${ltp}) went back below HMA (${hma}) during confirmation - canceling entry`);
          
          symbol.pendingSignal.state = 'WAITING';
          symbol.pendingSignal.crossoverDetected = false;
          symbol.pendingSignal.crossoverTime = null;
          symbol.pendingSignal.confirmationEndTime = null;
          
          // Update status back to WAITING_FOR_ENTRY
          await TradingState.updateOne(
            { userId, 'monitoredSymbols.id': symbol.id },
            {
              $set: {
                'monitoredSymbols.$.triggerStatus': 'WAITING_FOR_ENTRY',
                'monitoredSymbols.$.pendingSignal': symbol.pendingSignal,
                'monitoredSymbols.$.opportunityActive': false, // Reset opportunity flag when confirmation is canceled
                'monitoredSymbols.$.orderModificationReason': 'Entry confirmation canceled - LTP back below HMA'
              }
            }
          );
          
          console.log(`🔄 ${symbol.symbol}: Back to waiting for entry`);
        } else if (now >= symbol.pendingSignal.confirmationEndTime) {
          // 5-minute candle confirmation completed and LTP is still above HMA - execute market order
          console.log(`✅ ${symbol.symbol}: 5-minute candle confirmation completed! LTP still above HMA - executing market order`);
          console.log(`🔍 [DEBUG] ${symbol.symbol}: Current time: ${now}, Confirmation end time: ${symbol.pendingSignal.confirmationEndTime}`);
          console.log(`🔍 [DEBUG] ${symbol.symbol}: LTP: ${ltp}, HMA: ${hma}, LTP > HMA: ${ltp > hma}`);
          
          try {
            // Place market order immediately
            const position = await this.executeMarketOrder(symbol, now, userId);
            
            if (position) {
              // Update symbol status to ORDER_PLACED
              await TradingState.updateOne(
                { userId, 'monitoredSymbols.id': symbol.id },
                {
                  $set: {
                    'monitoredSymbols.$.triggerStatus': 'ORDER_PLACED',
                    'monitoredSymbols.$.orderPlaced': true,
                    'monitoredSymbols.$.orderPlacedAt': now,
                    'monitoredSymbols.$.orderId': position.buyOrderId,
                    'monitoredSymbols.$.orderStatus': 'PENDING',
                    'monitoredSymbols.$.lastHmaValue': hma,
                    'monitoredSymbols.$.opportunityActive': false, // Reset to false since order is placed
                    'monitoredSymbols.$.lastOpportunityTime': now,
                    'monitoredSymbols.$.orderModificationReason': 'Market order placed at bullish crossover confirmation',
                    'monitoredSymbols.$.pendingSignal': null // Clear pending signal
                  }
                }
              );
              
              // Add to active positions immediately
              await TradingState.updateOne(
                { userId },
                { $push: { activePositions: position } }
              );
              
              console.log(`✅ Market order placed for ${symbol.symbol} at bullish crossover confirmation`);
              console.log(`📊 Added ${symbol.symbol} to active positions while keeping in monitoring`);
              
              // Place SL-M order after 5 seconds
              setTimeout(async () => {
                try {
                  console.log(`🛡️ Placing SL-M order for ${symbol.symbol} after 5-second delay`);
                  const slOrderResult = await this.placeSLMOrder(position, userId);
                  
                  if (slOrderResult.success) {
                    console.log(`✅ SL-M order placed for ${symbol.symbol} - Order ID: ${slOrderResult.sellOrderId}`);
                  } else {
                    console.error(`❌ Failed to place SL-M order for ${symbol.symbol}: ${slOrderResult.error}`);
                  }
                } catch (error) {
                  console.error(`❌ Error placing SL-M order for ${symbol.symbol}:`, error);
                }
              }, 5000);
              
              result.executed = true;
              result.position = position;
            } else {
              console.error(`❌ Failed to execute market order for ${symbol.symbol}`);
              
              // Reset to waiting for entry if order placement failed
              symbol.pendingSignal.state = 'WAITING';
              symbol.pendingSignal.crossoverDetected = false;
              symbol.pendingSignal.crossoverTime = null;
              symbol.pendingSignal.confirmationEndTime = null;
              
              await TradingState.updateOne(
                { userId, 'monitoredSymbols.id': symbol.id },
                {
                  $set: {
                    'monitoredSymbols.$.triggerStatus': 'WAITING_FOR_ENTRY',
                    'monitoredSymbols.$.pendingSignal': symbol.pendingSignal,
                    'monitoredSymbols.$.opportunityActive': false, // Reset opportunity flag on failure
                    'monitoredSymbols.$.orderModificationReason': 'Market order placement failed - retrying on next crossover'
                  }
                }
              );
            }
          } catch (error) {
            console.error(`❌ Error executing market order for ${symbol.symbol}:`, error);
            
            // Reset to waiting for entry if order placement failed
            symbol.pendingSignal.state = 'WAITING';
            symbol.pendingSignal.crossoverDetected = false;
            symbol.pendingSignal.crossoverTime = null;
            symbol.pendingSignal.confirmationEndTime = null;
            
            await TradingState.updateOne(
              { userId, 'monitoredSymbols.id': symbol.id },
              {
                $set: {
                  'monitoredSymbols.$.triggerStatus': 'WAITING_FOR_ENTRY',
                  'monitoredSymbols.$.pendingSignal': symbol.pendingSignal,
                  'monitoredSymbols.$.opportunityActive': false, // Reset opportunity flag on failure
                  'monitoredSymbols.$.orderModificationReason': 'Market order placement failed - retrying on next crossover'
                }
              }
            );
          }
        } else {
          // Still in confirmation phase - show remaining time
          const remainingTime = Math.max(0, symbol.pendingSignal.confirmationEndTime - now);
          const remainingMinutes = Math.floor(remainingTime / 60);
          const remainingSeconds = remainingTime % 60;
          
          console.log(`⏰ ${symbol.symbol}: Confirming entry - ${remainingMinutes}m ${remainingSeconds}s remaining`);
        }
      }
    }

    // --- ONLY BLOCK ORDER PLACEMENT BELOW ---
    // Only place a buy order if not already processing an opportunity
    if (symbol.tradesToday >= (symbol.maxPerDay || 4)) {
      return result;
    }
    if (symbol.orderPlaced && symbol.orderStatus === 'PENDING') {
      return result;
    }
    if (symbol.orderPlaced && symbol.orderStatus === 'PENDING' && symbol.orderId) {
      // Check if HMA has changed significantly
      if (symbol.lastHmaValue && Math.abs(hma - symbol.lastHmaValue) >= 0.5) {
        console.log(`🔄 HMA changed for ${symbol.symbol}: ${symbol.lastHmaValue} → ${hma}, modifying order`);
        await this.modifyPendingOrderForHMAChange(symbol, symbol.lastHmaValue, hma, userId);
      }
      return result;
    }

    // For symbols with pendingSignal (new state machine), don't use opportunityActive check
    // as it interferes with the confirmation timer logic
    if (!symbol.pendingSignal) {
      // Only apply opportunityActive check for legacy symbols without pendingSignal
      if (symbol.opportunityActive) {
        return result;
      }

      // ADDITIONAL RACE CONDITION PROTECTION: Check database state atomically
      const dbSymbol = await TradingState.findOne(
        { 
          userId, 
          'monitoredSymbols.id': symbol.id,
          'monitoredSymbols.orderPlaced': { $ne: true }, // Only proceed if order not already placed
          'monitoredSymbols.opportunityActive': { $ne: true } // Only proceed if opportunity not already active
        }
      );
      if (!dbSymbol) {
        console.log(`⏳ Order already placed or opportunity active for ${symbol.symbol} (database check) - skipping`);
        return result;
      }

      // Set opportunityActive immediately to prevent race conditions
      await TradingState.updateOne(
        { userId, 'monitoredSymbols.id': symbol.id },
        {
          $set: {
            'monitoredSymbols.$.opportunityActive': true,
            'monitoredSymbols.$.lastOpportunityTime': now
          }
        }
      );
      
      console.log(`🔒 Set opportunityActive=true for ${symbol.symbol} to prevent duplicate orders`);
    }

    // --- LEGACY ORDER PLACEMENT LOGIC (for backward compatibility) ---
    // This section handles the old order placement logic that doesn't use the three-state system
    // It will only run if the symbol doesn't have a pendingSignal (old monitoring style)
    
    if (!symbol.pendingSignal) {
      console.log(`📊 ${symbol.symbol}: No pending signal - using legacy order placement logic`);
      
      // Calculate the end of current 5-minute candle (MM:59)
      const currentMinute = now.getMinutes();
      const currentSecond = now.getSeconds();
      
      console.log(`🔍 [DEBUG] ${symbol.symbol}: LTP=${ltp}, HMA=${hma}, Minute=${currentMinute}, Second=${currentSecond}`);
      
      // Check current state and LTP vs HMA relationship
      if (ltp > hma) {
        // LTP is above HMA - "Waiting for Reversal" state
        console.log(`📈 ${symbol.symbol}: LTP (${ltp}) > HMA (${hma}) - In "Waiting for Reversal" state`);
        
        // Check if we have a pending reversal signal
        if (!symbol.pendingSignal) {
          // Start monitoring for reversal (crossover down)
          symbol.pendingSignal = {
            direction: 'REVERSAL',
            triggeredAt: now,
            hmaAtTrigger: hma,
            ltpAtTrigger: ltp,
            state: 'WAITING',
            reversalDetected: false,
            confirmationTimer: null
          };
          
          // Update status to WAITING_FOR_REVERSAL
          await TradingState.updateOne(
            { userId, 'monitoredSymbols.id': symbol.id },
            {
              $set: {
                'monitoredSymbols.$.triggerStatus': 'WAITING_FOR_REVERSAL',
                'monitoredSymbols.$.pendingSignal': symbol.pendingSignal,
                'monitoredSymbols.$.orderModificationReason': 'LTP above HMA - waiting for reversal crossover'
              }
            }
          );
          
          console.log(`⏳ ${symbol.symbol}: Started monitoring for reversal (LTP to cross below HMA)`);
        }
      } else {
        // LTP is below or equal to HMA
        if (symbol.pendingSignal && symbol.pendingSignal.direction === 'ENTRY' && symbol.pendingSignal.state === 'WAITING') {
          // We're in "Waiting for Entry" state - check for bullish crossover
          console.log(`📊 ${symbol.symbol}: LTP (${ltp}) <= HMA (${hma}) - In "Waiting for Entry" state`);
          
          // Check if we're at the end of a 5-minute candle (MM:59) for crossover confirmation
          const isCandleClose = currentSecond >= 59;
          const isFiveMinuteBoundary = currentMinute % 5 === 4; // 4, 9, 14, 19, 24, 29, 34, 39, 44, 49, 54, 59
          
          if (ltp > hma && isCandleClose && isFiveMinuteBoundary) {
            // Bullish crossover confirmed at 5-minute candle close - execute trade
            console.log(`🚀 ${symbol.symbol}: Bullish crossover confirmed at 5-minute candle close - executing market order`);
            
            try {
              // Place market order immediately
              const position = await this.executeMarketOrder(symbol, now, userId);
              
              if (position) {
                // Update symbol status to ORDER_PLACED
                await TradingState.updateOne(
                  { userId, 'monitoredSymbols.id': symbol.id },
                  {
                    $set: {
                      'monitoredSymbols.$.triggerStatus': 'ORDER_PLACED',
                      'monitoredSymbols.$.orderPlaced': true,
                      'monitoredSymbols.$.orderPlacedAt': now,
                      'monitoredSymbols.$.orderId': position.buyOrderId,
                      'monitoredSymbols.$.orderStatus': 'PENDING',
                      'monitoredSymbols.$.lastHmaValue': hma,
                      'monitoredSymbols.$.opportunityActive': false, // Reset to false since order is placed
                      'monitoredSymbols.$.lastOpportunityTime': now,
                      'monitoredSymbols.$.orderModificationReason': 'Market order placed at bullish crossover confirmation',
                      'monitoredSymbols.$.pendingSignal': null // Clear pending signal
                    }
                  }
                );
                
                // Add to active positions immediately
                await TradingState.updateOne(
                  { userId },
                  { $push: { activePositions: position } }
                );
                
                console.log(`✅ Market order placed for ${symbol.symbol} at bullish crossover confirmation`);
                console.log(`📊 Added ${symbol.symbol} to active positions while keeping in monitoring`);
                
                // Place SL-M order after 5 seconds
                setTimeout(async () => {
                  try {
                    console.log(`🛡️ Placing SL-M order for ${symbol.symbol} after 5-second delay`);
                    const slOrderResult = await this.placeSLMOrder(position, userId);
                    
                    if (slOrderResult.success) {
                      // Update active position with SL order details
                      await TradingState.updateOne(
                        { userId, 'activePositions.buyOrderId': position.buyOrderId },
                        {
                          $set: {
                            'activePositions.$.slOrderId': slOrderResult.slOrderId,
                            'activePositions.$.slStopPrice': slOrderResult.stopLossPrice,
                            'activePositions.$.slTriggerPrice': slOrderResult.triggerPrice,
                            'activePositions.$.slOrderDetails': {
                              orderId: slOrderResult.slOrderId,
                              stopLossPrice: slOrderResult.stopLossPrice,
                              triggerPrice: slOrderResult.triggerPrice,
                              placedAt: new Date(),
                              modifications: []
                            }
                          }
                        }
                      );
                      
                      console.log(`✅ SL-M order placed for ${symbol.symbol}:`, slOrderResult);
                    } else {
                      console.error(`❌ Failed to place SL-M order for ${symbol.symbol}:`, slOrderResult.error);
                    }
                  } catch (error) {
                    console.error(`❌ Error placing SL-M order for ${symbol.symbol}:`, error);
                  }
                }, 5000);
                
                result.executed = true;
                result.position = position;
              } else {
                console.error(`❌ Failed to execute market order for ${symbol.symbol}`);
              }
            } catch (error) {
              console.error(`❌ Error executing market order for ${symbol.symbol}:`, error);
            }
          } else if (ltp > hma) {
            // Potential bullish crossover but not at candle close
            console.log(`📈 ${symbol.symbol}: Potential bullish crossover (LTP > HMA) but waiting for 5-minute candle close`);
          } else {
            // Still waiting for bullish crossover
            console.log(`⏳ ${symbol.symbol}: Still waiting for bullish crossover - LTP (${ltp}) <= HMA (${hma})`);
          }
        } else if (!symbol.pendingSignal) {
          // No pending signal and LTP <= HMA - this means we should be in "Waiting for Entry" state
          // since LTP is already below HMA, we're waiting for bullish crossover
          console.log(`📊 ${symbol.symbol}: LTP (${ltp}) <= HMA (${hma}) - No pending signal, moving to entry state`);
          
          // Start monitoring for entry (waiting for LTP to cross above HMA)
          symbol.pendingSignal = {
            direction: 'ENTRY',
            triggeredAt: now,
            hmaAtTrigger: hma,
            ltpAtTrigger: ltp,
            state: 'WAITING',
            reversalConfirmed: true, // Since LTP is already below HMA, reversal is confirmed
            entryReadyAt: now
          };
          
          // Update status to WAITING_FOR_ENTRY
          await TradingState.updateOne(
            { userId, 'monitoredSymbols.id': symbol.id },
            {
              $set: {
                'monitoredSymbols.$.triggerStatus': 'WAITING_FOR_ENTRY',
                'monitoredSymbols.$.pendingSignal': symbol.pendingSignal,
                'monitoredSymbols.$.orderModificationReason': 'LTP below HMA - ready for bullish crossover entry'
              }
            }
          );
          
          console.log(`🎯 ${symbol.symbol}: Ready for entry - waiting for LTP to cross above HMA`);
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
      const getLotSize = (symbolString) => {
        // Extract index name from symbol string (e.g., "NSE:NIFTY2571725150PE" -> "NIFTY")
        const symbolUpper = symbolString?.toUpperCase() || '';
        
        if (symbolUpper.includes('NIFTY') && !symbolUpper.includes('BANKNIFTY')) {
          return 75; // Minimum lot size for NIFTY
        } else if (symbolUpper.includes('BANKNIFTY')) {
          return 35; // Minimum lot size for BANKNIFTY
        } else if (symbolUpper.includes('SENSEX')) {
          return 20; // Minimum lot size for SENSEX
        } else {
          // Default to NIFTY lot size
          console.log(`⚠️ Unknown index type for symbol ${symbolString}, defaulting to NIFTY lot size (75)`);
          return 75;
        }
      };
      
      // Round limit price to nearest tick size (0.0500)
      const roundToTickSize = (price, tickSize = 0.05) => {
        return Math.round(price / tickSize) * tickSize;
      };
      
      const lotSize = getLotSize(symbol.symbol);
      // Ensure lots is a whole number and calculate quantity
      const lots = Math.floor(symbol.lots || 1); // Ensure lots is a whole number
      const quantity = lots * lotSize; // Calculate quantity based on lots and lot size
      const roundedLimitPrice = roundToTickSize(limitPrice);
      
      // Debug logging to check symbol data
      console.log(`🔍 [DEBUG] Symbol data for BUY SL-L order placement:`, {
        symbol: symbol.symbol,
        lots: symbol.lots,
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
      
      // Log the order rejection
      try {
        await TradeLogService.logOrderRejected({
          userId: userId,
          symbol: symbol.symbol,
          orderId: null, // No order ID since placement failed
          orderType: 'SL-L',
          quantity: symbol.quantity || 0,
          price: limitPrice || 0,
          reason: 'ENTRY',
          errorMessage: error.message,
          source: 'FYERS'
        });
      } catch (logError) {
        console.error('Error logging order rejection:', logError);
      }
      
      // Get lot size for error logging (define function here for scope)
      const getLotSizeForError = (symbolString) => {
        // Extract index name from symbol string (e.g., "NSE:NIFTY2571725150PE" -> "NIFTY")
        const symbolUpper = symbolString?.toUpperCase() || '';
        
        if (symbolUpper.includes('NIFTY') && !symbolUpper.includes('BANKNIFTY')) {
          return 75; // Minimum lot size for NIFTY
        } else if (symbolUpper.includes('BANKNIFTY')) {
          return 35; // Minimum lot size for BANKNIFTY
        } else if (symbolUpper.includes('SENSEX')) {
          return 20; // Minimum lot size for SENSEX
        } else {
          return 75; // Default to NIFTY lot size
        }
      };
      
      // Round limit price for error logging
      const roundToTickSize = (price, tickSize = 0.05) => {
        return Math.round(price / tickSize) * tickSize;
      };
      const roundedLimitPrice = roundToTickSize(limitPrice);
      
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
      const getLotSize = (symbolString) => {
        // Extract index name from symbol string (e.g., "NSE:NIFTY2571725150PE" -> "NIFTY")
        const symbolUpper = symbolString?.toUpperCase() || '';
        
        if (symbolUpper.includes('NIFTY') && !symbolUpper.includes('BANKNIFTY')) {
          return 75; // Minimum lot size for NIFTY
        } else if (symbolUpper.includes('BANKNIFTY')) {
          return 35; // Minimum lot size for BANKNIFTY
        } else if (symbolUpper.includes('SENSEX')) {
          return 20; // Minimum lot size for SENSEX
        } else {
          // Default to NIFTY lot size
          console.log(`⚠️ Unknown index type for symbol ${symbolString}, defaulting to NIFTY lot size (75)`);
          return 75;
        }
      };
      
      // Round prices to nearest tick size (0.0500)
      const roundToTickSize = (price, tickSize = 0.05) => {
        return Math.round(price / tickSize) * tickSize;
      };
      
      const lotSize = getLotSize(symbol.symbol);
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
   * Place SELL SL-L (Stop Limit) order for stop loss protection
   * @param {Object} symbol - Symbol configuration
   * @param {string} buyOrderId - BUY order ID
   * @param {number} buyPrice - BUY order fill price
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Order result
   */
  static async placeSellSLLOrder(symbol, buyOrderId, buyPrice, userId) {
    try {
      // Get the correct lot size based on the index
      const getLotSize = (symbolString) => {
        // Extract index name from symbol string (e.g., "NSE:NIFTY2571725150PE" -> "NIFTY")
        const symbolUpper = symbolString?.toUpperCase() || '';
        
        if (symbolUpper.includes('NIFTY') && !symbolUpper.includes('BANKNIFTY')) {
          return 75; // Minimum lot size for NIFTY
        } else if (symbolUpper.includes('BANKNIFTY')) {
          return 35; // Minimum lot size for BANKNIFTY
        } else if (symbolUpper.includes('SENSEX')) {
          return 20; // Minimum lot size for SENSEX
        } else {
          // Default to NIFTY lot size
          console.log(`⚠️ Unknown index type for symbol ${symbolString}, defaulting to NIFTY lot size (75)`);
          return 75;
        }
      };
      
      // Round prices to nearest tick size (0.0500)
      const roundToTickSize = (price, tickSize = 0.05) => {
        return Math.round(price / tickSize) * tickSize;
      };
      
      const lotSize = getLotSize(symbol.symbol);
      // Ensure lots is a whole number and calculate quantity
      const lots = Math.floor(symbol.lots || 1); // Ensure lots is a whole number
      const quantity = lots * lotSize;
      const stopLossPoints = parseFloat(symbol.stopLossPoints || 0);
      const stopLossPrice = buyPrice - stopLossPoints;
      const roundedStopLossPrice = roundToTickSize(stopLossPrice);
      
      // For SELL SL-L: limitPrice should be the stop loss price, stopPrice (trigger) should be 0.5 higher
      const limitPrice = roundedStopLossPrice; // Limit price = stop loss price
      const triggerPrice = roundedStopLossPrice + 0.5; // Trigger 0.5 points ABOVE limit price for SELL
      
      // Create alphanumeric order tag (max 30 chars, no special characters)
      const orderTag = `VICTORYSELL${Date.now().toString().slice(-8)}`;
      
      const sellOrderData = {
        symbol: symbol.symbol,
        qty: quantity,
        type: 4, // Stop Limit Order (SL-L)
        side: -1, // Sell
        productType: symbol.productType || 'INTRADAY',
        limitPrice: limitPrice, // Stop loss price as limit
        stopPrice: triggerPrice, // Trigger price 0.5 higher
        disclosedQty: 0,
        validity: 'DAY',
        offlineOrder: false,
        stopLoss: 0,
        takeProfit: 0,
        orderTag: orderTag // Alphanumeric only, max 30 chars
      };
      
      console.log(`📋 [SELL SL-L ORDER] Placing SELL SL-L order:`, sellOrderData);
      
      // Use live trade service to place SELL SL-L order
      const tradeResult = await TradeService.placeLiveTrade({
        symbol: symbol.symbol,
        quantity: quantity,
        price: limitPrice,
        action: 'SELL',
        orderType: 'SL_LIMIT', // SELL SL-L order type
        productType: symbol.productType || 'INTRADAY',
        userId,
        offlineOrder: false,
        orderData: sellOrderData
      });
      
      // Check if order was rejected during placement
      if (!tradeResult || !tradeResult.success) {
        throw new Error(`SELL SL-L order placement failed: ${tradeResult?.message || 'Unknown error'}`);
      }
      
      console.log(`✅ [SELL SL-L ORDER] SELL SL-L order placed for ${symbol.symbol} at ${limitPrice}`);
      
      // Note: Trade logging will be handled by Fyers WebSocket when order status updates are received
      
      return {
        success: true,
        sellOrderId: tradeResult?.orderId,
        stopLossPrice: limitPrice,
        triggerPrice: triggerPrice
      };
      
    } catch (error) {
      console.error(`❌ SELL SL-L order placement failed for ${symbol.symbol}:`, error);
      
      // Note: Trade logging will be handled by Fyers WebSocket when order status updates are received
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Place market sell order for immediate exit
   * @param {Object} position - Active position object
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Order result
   */
  static async placeMarketSellOrder(position, userId) {
    try {
      // Get the correct lot size based on the index
      const getLotSize = (symbolString) => {
        const symbolUpper = symbolString?.toUpperCase() || '';
        
        if (symbolUpper.includes('NIFTY') && !symbolUpper.includes('BANKNIFTY')) {
          return 75;
        } else if (symbolUpper.includes('BANKNIFTY')) {
          return 35;
        } else if (symbolUpper.includes('SENSEX')) {
          return 20;
        } else {
          return 75; // Default
        }
      };
      
      const lotSize = getLotSize(position.symbol);
      const quantity = Math.floor(position.lots || 1) * lotSize;
      
      // Create alphanumeric order tag (max 30 chars, no special characters)
      const orderTag = `VICTORYEXIT${Date.now().toString().slice(-8)}`;
      
      const marketSellOrderData = {
        symbol: position.symbol,
        qty: quantity,
        type: 2, // Market Order
        side: -1, // Sell
        productType: position.productType || 'INTRADAY',
        limitPrice: 0, // Market order - no limit price
        stopPrice: 0, // Market order - no stop price
        disclosedQty: 0,
        validity: 'DAY',
        offlineOrder: false,
        stopLoss: 0,
        takeProfit: 0,
        orderTag: orderTag
      };
      
      console.log(`📋 [MARKET SELL ORDER] Placing market sell order:`, marketSellOrderData);
      
      // Use live trade service to place market sell order
      const tradeResult = await TradeService.placeLiveTrade({
        symbol: position.symbol,
        quantity: quantity,
        price: 0, // Market order
        action: 'SELL',
        orderType: 'MARKET',
        productType: position.productType || 'INTRADAY',
        userId,
        offlineOrder: false,
        orderData: marketSellOrderData
      });
      
      // Check if order was rejected during placement
      if (!tradeResult || !tradeResult.success) {
        throw new Error(`Market sell order placement failed: ${tradeResult?.message || 'Unknown error'}`);
      }
      
      console.log(`✅ [MARKET SELL ORDER] Market sell order placed for ${position.symbol}`);
      
      return {
        success: true,
        orderId: tradeResult?.orderId
      };
      
    } catch (error) {
      console.error(`❌ Market sell order placement failed for ${position.symbol}:`, error);
      
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
          // Get lot size based on symbol
          const getLotSize = (symbolString) => {
            const symbolUpper = symbolString?.toUpperCase() || '';
            if (symbolUpper.includes('NIFTY') && !symbolUpper.includes('BANKNIFTY')) {
              return 75;
            } else if (symbolUpper.includes('BANKNIFTY')) {
              return 35;
            } else if (symbolUpper.includes('SENSEX')) {
              return 20;
            } else {
              return 75; // Default
            }
          };
          const lotSize = getLotSize(position.symbol);
        position.pnl = (ltp - position.boughtPrice) * Math.floor(position.lots || 1) * lotSize;
        position.pnlPercentage = ((ltp - position.boughtPrice) / position.boughtPrice) * 100;
        
        // Check for target or stop loss
          if (ltp >= position.target) {
          position.status = 'Target Hit';
          closed++;
              
              // Target hit - cancel SL-L order and place market sell order for immediate exit
              if (position.slOrderId) {
                console.log(`🎯 Target hit for ${position.symbol} - canceling SL-L order and placing market sell order for profit exit`);
                position.orderStatus = 'TARGET_EXIT_PENDING';
                
                try {
                  // Cancel the SL-L order first
                  const cancelResult = await this.cancelOrder(position.slOrderId, userId);
                  
                  if (cancelResult.success) {
                    console.log(`✅ Successfully canceled SL-L order for ${position.symbol}`);
                    
                    // Place market sell order for immediate exit
                    const marketSellResult = await this.placeMarketSellOrder(position, userId);
                    
                    if (marketSellResult.success) {
                      console.log(`✅ Successfully placed market sell order for ${position.symbol} - Target exit initiated`);
                      position.orderStatus = 'TARGET_EXIT_EXECUTED';
                      position.exitOrderId = marketSellResult.orderId;
                      
                      // Create trade log for target exit
                      await this.createTradeLogWithRemarks(
                        marketSellResult.orderId,
                        'TARGET_HIT',
                        `Target hit at ${ltp} - SL-L order canceled and market sell order placed for profit exit`,
                        userId,
                        position.symbol
                      );
                    } else {
                      console.error(`❌ Failed to place market sell order for ${position.symbol}`);
                      position.orderStatus = 'TARGET_EXIT_FAILED';
                    }
                  } else {
                    console.error(`❌ Failed to cancel SL-L order for ${position.symbol}`);
                    position.orderStatus = 'TARGET_EXIT_FAILED';
                  }
                } catch (error) {
                  console.error(`❌ Error handling target exit for ${position.symbol}:`, error);
                  position.orderStatus = 'TARGET_EXIT_FAILED';
                  
                  // Create trade log for failed target exit
                  await this.createTradeLogWithRemarks(
                    position.slOrderId,
                    'TARGET_EXIT_FAILED',
                    `Failed to handle target exit: ${error.message}`,
                    userId,
                    position.symbol
                  );
                }
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
            triggerStatus: 'WAITING_FOR_REVERSAL', // Use new enum value instead of 'WAITING'
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
      
      const response = await axios.delete(`https://api-t1.fyers.in/api/v3/orders/${orderId}`, {
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
            
            // Get lot size based on symbol
            const getLotSize = (symbolString) => {
              const symbolUpper = symbolString?.toUpperCase() || '';
              if (symbolUpper.includes('NIFTY') && !symbolUpper.includes('BANKNIFTY')) {
                return 75;
              } else if (symbolUpper.includes('BANKNIFTY')) {
                return 35;
              } else if (symbolUpper.includes('SENSEX')) {
                return 20;
              } else {
                return 75; // Default
              }
            };
            const lotSize = getLotSize(symbol.symbol);
            
            // Create active position immediately when BUY order is filled
            const position = {
              id: `${symbol.symbol}-${Date.now()}`,
              symbol: symbol.symbol,
              type: symbol.type,
              lots: Math.floor(symbol.lots || 1),
              quantity: Math.floor(symbol.lots || 1) * lotSize,
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
              slOrderDetails: null,
              reEntryCount: symbol.reEntryCount || 0,
              pnl: 0,
              pnlPercentage: 0,
              hmaValue: symbol.hmaValue,
              index: symbol.index || { name: 'NIFTY', lotSize: 75 },
              slStopPrice: null, // Will be set when SELL order is placed
              slModifications: [], // Track SL modifications
              invested: (Math.floor(symbol.lots || 1) * lotSize) * fillPrice // Qty * bought price
            };
            
            // Add to active positions
            await TradingState.updateOne(
              { userId },
              { $push: { activePositions: position } }
            );
            
            console.log(`✅ ${symbol.symbol} moved to active positions with invested amount: ₹${position.invested}`);
            
            // Place SELL SL-L order after 5 seconds for stop loss protection
            console.log(`🛡️ Scheduling SELL SL-L order for ${symbol.symbol} in 5 seconds`);
            
            // Schedule SL-L order placement after 5 seconds
            setTimeout(async () => {
              try {
                console.log(`🛡️ Placing SELL SL-L order for ${symbol.symbol} at stop loss price`);
                const slOrderResult = await this.placeSellSLLOrder(symbol, orderId, fillPrice, userId);
                
                if (slOrderResult.success) {
                  // Update the active position with SELL order details
                  await TradingState.updateOne(
                    { userId, 'activePositions.buyOrderId': orderId },
                    {
                      $set: {
                        'activePositions.$.sellOrderId': slOrderResult.sellOrderId,
                        'activePositions.$.slStopPrice': slOrderResult.stopLossPrice,
                        'activePositions.$.slTriggerPrice': slOrderResult.triggerPrice,
                        'activePositions.$.slOrderDetails': {
                          orderId: slOrderResult.sellOrderId,
                          stopPrice: slOrderResult.stopLossPrice,
                          triggerPrice: slOrderResult.triggerPrice,
                          placedAt: new Date()
                        }
                      }
                    }
                  );
                  
                  console.log(`✅ SELL SL-L order placed for ${symbol.symbol} - Order ID: ${slOrderResult.sellOrderId}`);
                  console.log(`📊 Stop Loss Price: ${slOrderResult.stopLossPrice}, Trigger Price: ${slOrderResult.triggerPrice}`);
                } else {
                  console.log(`❌ SELL SL-L order placement failed for ${symbol.symbol}: ${slOrderResult.error}`);
                }
              } catch (error) {
                console.error(`❌ Error placing SELL SL-L order for ${symbol.symbol}:`, error);
              }
            }, 5000); // 5 seconds delay
            
            // SL-L order will be placed after 5 seconds via setTimeout above
            
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
            const positionUpdate = await TradingState.updateOne(
              { userId, 'activePositions.sellOrderId': orderId },
              {
                $set: {
                  'activePositions.$.status': 'CLOSED',
                  'activePositions.$.exitPrice': fillPriceFromFyers || symbol.hmaValue || symbol.lastHmaValue,
                  'activePositions.$.exitTimestamp': new Date(),
                  'activePositions.$.exitOrderId': orderId
                }
              }
            );
            
            if (positionUpdate.modifiedCount > 0) {
              // Get the closed position to determine re-entry status
              const state = await TradingState.findOne({ userId });
              const closedPosition = state.activePositions.find(p => p.sellOrderId === orderId);
              
              if (closedPosition) {
                // Check if LTP is above or below HMA for re-entry decision
                const User = require('../models/User');
                const user = await User.findById(userId);
                const liveQuote = await this.getLiveQuote(closedPosition.symbol, userId);
                const hmaData = await HMAService.fetchAndCalculateHMA(closedPosition.symbol, user);
                
                if (liveQuote && hmaData) {
                  const ltp = liveQuote.ltp;
                  const hmaValue = hmaData.currentHMA || hmaData.hmaValue;
                  
                  let reEntryStatus = 'WAITING_FOR_REVERSAL';
                  if (ltp <= hmaValue) {
                    reEntryStatus = 'WAITING_FOR_ENTRY';
                  }
                  
                  // Add symbol back to monitoring with appropriate status
                  const symbolData = {
                    symbol: closedPosition.symbol,
                    type: closedPosition.type,
                    lots: closedPosition.lots,
                    targetPoints: closedPosition.target - closedPosition.boughtPrice,
                    stopLossPoints: closedPosition.boughtPrice - closedPosition.stopLoss,
                    productType: closedPosition.productType,
                    index: closedPosition.index
                  };
                  
                  await this.addSymbolToMonitoring(userId, symbolData);
                  
                  // Update the symbol status
                  await TradingState.updateOne(
                    { userId, 'monitoredSymbols.symbol': closedPosition.symbol },
                    {
                      $set: {
                        'monitoredSymbols.$.triggerStatus': reEntryStatus,
                        'monitoredSymbols.$.orderModificationReason': `Position closed at ${closedPosition.exitPrice} - LTP ${ltp > hmaValue ? 'above' : 'below'} HMA - ${reEntryStatus}`
                      }
                    }
                  );
                  
                  console.log(`🔄 ${closedPosition.symbol} added back to monitoring with status: ${reEntryStatus}`);
                }
              }
            }
            
            newStatus = 'CLOSED';
          }
          break;
          
        case 'REJECTED':
          // Show ORDER_REJECTED status and prevent further attempts
          newStatus = 'ORDER_REJECTED';
          console.log(`❌ Order rejected for ${symbol.symbol}, setting to REJECTED with no retries`);
          
          // Update symbol status to REJECTED and prevent further order attempts
          await TradingState.updateOne(
            { userId, 'monitoredSymbols.id': symbol.id },
            {
              $set: {
                'monitoredSymbols.$.triggerStatus': 'ORDER_REJECTED',
                'monitoredSymbols.$.orderStatus': 'REJECTED',
                'monitoredSymbols.$.orderModificationReason': 'Order rejected - no further attempts will be made',
                'monitoredSymbols.$.pendingSignal': null // Clear pending signal
              }
            }
          );
          
          // The symbol stays in monitoring with ORDER_REJECTED status - no retries
          break;
          
        case 'CANCELLED':
          newStatus = 'ORDER_CANCELLED';
          console.log(`🔄 Order cancelled for ${symbol.symbol}, resetting to WAITING for immediate retry`);
          
          // Reset opportunity state for immediate retry
          await TradingState.updateOne(
            { userId, 'monitoredSymbols.id': symbol.id },
            {
              $set: {
                'monitoredSymbols.$.triggerStatus': 'WAITING_FOR_REVERSAL', // Use new enum value instead of 'WAITING'
                'monitoredSymbols.$.orderStatus': 'CANCELLED',
                'monitoredSymbols.$.opportunityActive': false,
                'monitoredSymbols.$.orderModificationReason': 'Order cancelled by user - ready for immediate retry'
              }
            }
          );
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
      
              // After a BUY order is filled and position is closed (SL/target), increment tradesToday and reset opportunityActive
        // This should be done when a position is closed (status is 'CLOSED')
        if (status === 'CLOSED' || status === 'Target Hit' || status === 'Stop Loss Hit') {
          await TradingState.updateOne(
            { userId, 'monitoredSymbols.id': symbol.id },
            {
              $inc: { 'monitoredSymbols.$.tradesToday': 1 },
              $set: { 
                'monitoredSymbols.$.opportunityActive': false,
                'monitoredSymbols.$.triggerStatus': 'WAITING_REENTRY',
                'monitoredSymbols.$.orderModificationReason': `Trade closed (${status}) - waiting 5s for re-entry`
              }
            }
          );
          
          // Set a timeout to reset to WAITING_FOR_REVERSAL after 5 seconds
          setTimeout(async () => {
            await TradingState.updateOne(
              { userId, 'monitoredSymbols.id': symbol.id },
              {
                $set: {
                  'monitoredSymbols.$.triggerStatus': 'WAITING_FOR_REVERSAL', // Use new enum value instead of 'WAITING'
                  'monitoredSymbols.$.orderModificationReason': 'Ready for next opportunity'
                }
              }
            );
            console.log(`🔄 ${symbol.symbol} reset to WAITING_FOR_REVERSAL after trade exit`);
          }, 5000);
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
      
      // Get lot size based on symbol
      const getLotSize = (symbolString) => {
        const symbolUpper = symbolString?.toUpperCase() || '';
        if (symbolUpper.includes('NIFTY') && !symbolUpper.includes('BANKNIFTY')) {
          return 75;
        } else if (symbolUpper.includes('BANKNIFTY')) {
          return 35;
        } else if (symbolUpper.includes('SENSEX')) {
          return 20;
        } else {
          return 75; // Default
        }
      };
      const lotSize = getLotSize(symbol.symbol);
      
      const tradeLog = new TradeLog({
        userId,
        symbol: symbol.symbol,
        orderId: orderId,
        action: action,
        orderType: symbol.orderType || 'LIMIT',
        quantity: symbol.quantity || symbol.lots * lotSize,
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
        // Add position to activePositions array
        await TradingState.updateOne(
          { userId },
          {
            $push: { activePositions: position }
          }
        );

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

        // Ensure WebSocket is connected for order status updates
        await this.manageWebSocketConnection(userId);

        console.log(`✅ Manual limit order placed for ${symbol.symbol} at ${hmaValue} and added to active positions`);
        
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

  // Add this function to MonitoringService
  static async resetDailyTradeCounters(userId) {
    const TradingState = require('../models/TradingState');
    const state = await TradingState.findOne({ userId });
    if (!state) return;
    for (const symbol of state.monitoredSymbols) {
      symbol.tradesToday = 0;
      symbol.opportunityActive = false;
      symbol.lastOpportunityTime = null;
    }
    await state.save();
    console.log(`🔄 Daily trade counters reset for user ${userId}`);
  }

  /**
   * Reset opportunity state for a specific symbol (manual intervention)
   * @param {string} userId - User ID
   * @param {string} symbolId - Symbol ID
   * @returns {Promise<boolean>} Success status
   */
  static async resetSymbolOpportunity(userId, symbolId) {
    try {
      const TradingState = require('../models/TradingState');
      await TradingState.updateOne(
        { userId, 'monitoredSymbols.id': symbolId },
        {
          $set: {
            'monitoredSymbols.$.opportunityActive': false,
            'monitoredSymbols.$.orderStatus': 'WAITING',
            'monitoredSymbols.$.triggerStatus': 'WAITING_FOR_REVERSAL', // Use new enum value instead of 'WAITING'
            'monitoredSymbols.$.orderPlaced': false,
            'monitoredSymbols.$.orderPlacedAt': null,
            'monitoredSymbols.$.orderId': null,
            'monitoredSymbols.$.orderModificationReason': 'Manually reset for retry'
          }
        }
      );
      console.log(`🔄 Opportunity state reset for symbol ${symbolId} for user ${userId}`);
      return true;
    } catch (error) {
      console.error('Error resetting symbol opportunity:', error);
      return false;
    }
  }

  /**
   * Execute market order for a symbol
   * @param {Object} symbol - Symbol data
   * @param {Date} now - Current time
   * @param {string} userId - User ID
   * @returns {Promise<Object|null>} Position data or null if failed
   */
  static async executeMarketOrder(symbol, now, userId) {
    try {
      console.log(`🚀 [EXECUTE MARKET ORDER] Starting market order execution for ${symbol.symbol}`);
      console.log(`🔍 [DEBUG] Symbol data:`, {
        symbol: symbol.symbol,
        lots: symbol.lots,
        productType: symbol.productType,
        hmaValue: symbol.hmaValue
      });
      
      // Get lot size based on symbol
      const getLotSize = (symbolString) => {
        const symbolUpper = symbolString?.toUpperCase() || '';
        if (symbolUpper.includes('NIFTY') && !symbolUpper.includes('BANKNIFTY')) {
          return 75;
        } else if (symbolUpper.includes('BANKNIFTY')) {
          return 35;
        } else if (symbolUpper.includes('SENSEX')) {
          return 20;
        } else {
          return 75; // Default
        }
      };
      
      const lotSize = getLotSize(symbol.symbol);
      const quantity = Math.floor(symbol.lots || 1) * lotSize;
      
      console.log(`📋 Placing market order for ${symbol.symbol}:`, {
        quantity,
        lots: symbol.lots,
        lotSize,
        productType: symbol.productType || 'INTRADAY'
      });
      
      // Create market order data
      const orderData = {
        symbol: symbol.symbol,
        qty: quantity,
        type: 2, // Market Order
        side: 1, // Buy
        productType: symbol.productType || 'INTRADAY',
        limitPrice: 0, // Market order - no limit price
        stopPrice: 0,
        disclosedQty: 0,
        validity: 'DAY',
        offlineOrder: false,
        stopLoss: 0,
        takeProfit: 0,
        orderTag: `VICTORYMARKET${Date.now().toString().slice(-8)}`
      };
      
      console.log(`🔍 [DEBUG] Market order data:`, orderData);
      
      // Place market order
      console.log('🔍 [DEBUG] TradeService type:', typeof TradeService);
      console.log('🔍 [DEBUG] TradeService.placeLiveTrade type:', typeof TradeService.placeLiveTrade);
      console.log('🔍 [DEBUG] TradeService keys:', Object.keys(TradeService));
      
      const result = await TradeService.placeLiveTrade({
        symbol: symbol.symbol,
        quantity: quantity,
        price: 0, // Market order
        action: 'BUY',
        orderType: 'MARKET',
        productType: symbol.productType || 'INTRADAY',
        userId,
        offlineOrder: false,
        orderData: orderData
      });
      
      if (result.success) {
        console.log(`✅ Market order placed successfully for ${symbol.symbol}:`, result);
        
        // Create position object
        const position = {
          id: `${symbol.symbol}-${Date.now()}`,
          symbol: symbol.symbol,
          type: symbol.type || 'CE',
          lots: Math.floor(symbol.lots || 1),
          quantity: quantity,
          boughtPrice: result.fillPrice || 0, // Will be updated when order is filled
          currentPrice: result.fillPrice || 0,
          target: (result.fillPrice || 0) + parseFloat(symbol.targetPoints || 0),
          stopLoss: (result.fillPrice || 0) - parseFloat(symbol.stopLossPoints || 0),
          initialStopLoss: (result.fillPrice || 0) - parseFloat(symbol.stopLossPoints || 0),
          useTrailingStoploss: symbol.useTrailingStoploss || false,
          trailingX: symbol.trailingX || 20,
          trailingY: symbol.trailingY || 15,
          status: 'Active',
          timestamp: now,
          tradingMode: 'LIVE',
          orderType: 'MARKET',
          productType: symbol.productType || 'INTRADAY',
          buyOrderId: result.orderId,
          sellOrderId: null,
          slOrderDetails: null,
          reEntryCount: symbol.reEntryCount || 0,
          pnl: 0,
          pnlPercentage: 0,
          hmaValue: symbol.hmaValue,
          index: symbol.index || { name: 'NIFTY', lotSize: 75 },
          slStopPrice: null,
          slModifications: [],
          invested: quantity * (result.fillPrice || 0)
        };
        
        return position;
      } else {
        console.error(`❌ Market order failed for ${symbol.symbol}:`, result.message);
        
        // Handle specific Fyers rejection reasons
        if (result.message && result.message.includes('blocked one day ahead of expiry')) {
          console.log(`⚠️ ${symbol.symbol}: Options contract blocked due to expiry proximity`);
          // Remove from monitoring since this symbol can't be traded
          await this.removeSymbolFromMonitoring(userId, symbol.id);
          return null;
        } else if (result.message && result.message.includes('Freeze qty including square off order')) {
          console.log(`⚠️ ${symbol.symbol}: Freeze quantity limit exceeded - position size too large`);
          // Keep in monitoring but mark as temporarily blocked
          return null;
        }
        
        return null;
      }
    } catch (error) {
      console.error(`❌ Error executing market order for ${symbol.symbol}:`, error);
      
      // Handle specific Fyers rejection reasons in error message
      if (error.message && error.message.includes('blocked one day ahead of expiry')) {
        console.log(`⚠️ ${symbol.symbol}: Options contract blocked due to expiry proximity`);
        // Remove from monitoring since this symbol can't be traded
        await this.removeSymbolFromMonitoring(userId, symbol.id);
        return null;
      } else if (error.message && error.message.includes('Freeze qty including square off order')) {
        console.log(`⚠️ ${symbol.symbol}: Freeze quantity limit exceeded - position size too large`);
        // Keep in monitoring but mark as temporarily blocked
        return null;
      }
      
      return null;
    }
  }

  /**
   * Place SL-M (Stop Loss Market) order for a position
   * @param {Object} position - Position data
   * @param {string} userId - User ID
   * @returns {Promise<Object>} SL order result
   */
  static async placeSLMOrder(position, userId) {
    try {
      console.log(`🛡️ Placing SL-M order for ${position.symbol} at stop loss price`);
      
      // Get lot size based on symbol
      const getLotSize = (symbolString) => {
        const symbolUpper = symbolString?.toUpperCase() || '';
        if (symbolUpper.includes('NIFTY') && !symbolUpper.includes('BANKNIFTY')) {
          return 75;
        } else if (symbolUpper.includes('BANKNIFTY')) {
          return 35;
        } else if (symbolUpper.includes('SENSEX')) {
          return 20;
        } else {
          return 75; // Default
        }
      };
      
      const lotSize = getLotSize(position.symbol);
      const quantity = Math.floor(position.lots || 1) * lotSize;
      
      // Create SL-M order data
      const orderData = {
        symbol: position.symbol,
        qty: quantity,
        type: 4, // Stop Loss Market Order
        side: -1, // Sell
        productType: position.productType || 'INTRADAY',
        limitPrice: 0, // Market order
        stopPrice: position.stopLoss, // Stop loss price
        disclosedQty: 0,
        validity: 'DAY',
        offlineOrder: false,
        stopLoss: 0,
        takeProfit: 0,
        orderTag: `VICTORYSL${Date.now().toString().slice(-8)}`
      };
      
      // Place SL-M order
      console.log('🔍 [DEBUG] TradeService type (SL-M):', typeof TradeService);
      console.log('🔍 [DEBUG] TradeService.placeLiveTrade type (SL-M):', typeof TradeService.placeLiveTrade);
      console.log('🔍 [DEBUG] TradeService keys (SL-M):', Object.keys(TradeService));
      
      const result = await TradeService.placeLiveTrade({
        symbol: position.symbol,
        quantity: quantity,
        price: 0, // Market order
        action: 'SELL',
        orderType: 'SL-M',
        productType: position.productType || 'INTRADAY',
        stopPrice: position.stopLoss,
        userId,
        offlineOrder: false,
        orderData: orderData
      });
      
      if (result.success) {
        console.log(`✅ SL-M order placed successfully for ${position.symbol}:`, result);
        
        return {
          success: true,
          slOrderId: result.orderId,
          stopLossPrice: position.stopLoss,
          triggerPrice: position.stopLoss,
          message: 'SL-M order placed successfully'
        };
      } else {
        console.error(`❌ SL-M order failed for ${position.symbol}:`, result.message);
        
        return {
          success: false,
          error: result.message,
          message: 'Failed to place SL-M order'
        };
      }
    } catch (error) {
      console.error(`❌ Error placing SL-M order for ${position.symbol}:`, error);
      
      return {
        success: false,
        error: error.message,
        message: 'Error placing SL-M order'
      };
    }
  }

  /**
   * Check if a symbol is tradeable (not blocked by exchange)
   * @param {string} symbol - Symbol to check
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} Whether symbol is tradeable
   */
  static async isSymbolTradeable(symbol, userId) {
    try {
      // Get current date and check if symbol is near expiry
      const now = new Date();
      const symbolUpper = symbol.toUpperCase();
      
      // Check for expiry date in symbol name (e.g., 25JUL, 17JUL)
      const expiryMatch = symbolUpper.match(/(\d{2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)/);
      if (expiryMatch) {
        const day = parseInt(expiryMatch[1]);
        const month = expiryMatch[2];
        const currentDay = now.getDate();
        const currentMonth = now.toLocaleString('en-US', { month: 'short' }).toUpperCase();
        
        // If same month and within 1 day of expiry, block
        if (month === currentMonth && Math.abs(day - currentDay) <= 1) {
          console.log(`⚠️ ${symbol}: Blocked - within 1 day of expiry (${day}${month})`);
          return false;
        }
      }
      
      // Check for specific blocked symbols
      const blockedSymbols = [
        'CRUDEOIL.*17JUL', // CRUDEOIL 17th July contracts
        'NATURALGAS.*17JUL' // NATURALGAS 17th July contracts
      ];
      
      for (const blockedPattern of blockedSymbols) {
        if (new RegExp(blockedPattern).test(symbolUpper)) {
          console.log(`⚠️ ${symbol}: Blocked - matches pattern ${blockedPattern}`);
          return false;
        }
      }
      
      return true;
    } catch (error) {
      console.error(`Error checking if symbol ${symbol} is tradeable:`, error);
      return true; // Default to tradeable if check fails
    }
  }
}

module.exports = { MonitoringService }; 