/**
 * Trade Log Service
 * Handles logging trade actions and status changes
 */
const TradeLog = require('../models/TradeLog');
const Notification = require('../models/Notification');
const LoggerService = require('./loggerService');

class TradeLogService {
  /**
   * Log order placement
   * @param {Object} params Order placement details
   * @returns {Object} Saved trade log entry
   */
  static async logOrderPlaced({
    userId,
    symbol,
    quantity,
    price,
    orderType = 'MARKET',
    side = 'BUY',
    productType = 'INTRADAY',
    orderId = null,
    reason = 'ENTRY',
    details = {},
    source = 'APP'
  }) {
    // Only log FYERS source logs, skip APP logs
    if (source === 'APP') {
      LoggerService.info('TradeLogService', `Skipping APP log for ${symbol} - only FYERS logs allowed`);
      return null;
    }
    
    try {
      // Check if we already have a log for this order with ORDER_PLACED status
      if (orderId) {
        const existingLog = await TradeLog.findOne({
          userId,
          orderId,
          action: 'ORDER_PLACED'
        });

        if (existingLog) {
          // If the existing log is from APP and current is from FYERS, update it
          if (existingLog.details?.source === 'APP' && source === 'FYERS') {
            LoggerService.info('TradeLogService', `Upgrading existing APP log to FYERS log for order ${orderId}`);
            existingLog.details = {
              ...existingLog.details,
              ...details,
              source: 'FYERS'
            };
            await existingLog.save();
            return existingLog;
          } else if (existingLog.details?.source === 'FYERS' && source === 'APP') {
            // Skip app logs if Fyers log already exists
            LoggerService.info('TradeLogService', `Skipping APP log - FYERS log already exists for order ${orderId}`);
            return existingLog;
          } else {
            LoggerService.info('TradeLogService', `Order ${orderId} already has a PLACED log entry. Skipping.`);
            return existingLog;
          }
        }
      }

      const tradeLog = new TradeLog({
        userId,
        symbol,
        action: 'ORDER_PLACED',
        orderType,
        quantity,
        price,
        side,
        productType,
        status: 'PENDING',
        reason,
        orderId,
        details: {
          ...details,
          source: source
        }
      });

      await tradeLog.save();
      LoggerService.info('TradeLogService', `Order placed log created for ${symbol} ${side} ${quantity} @ ${price} [Source: ${source}]`);
      
      // Send real-time update via WebSocket
      try {
        const WebSocketService = require('./websocketService');
        const wsService = WebSocketService.getInstance();
        if (wsService) {
          wsService.sendTradeLogUpdate(userId, tradeLog);
        }
      } catch (wsError) {
        LoggerService.error('TradeLogService', 'Error sending WebSocket update:', wsError);
      }
      
      // Create notification for the order placement
      try {
        await Notification.create({
          userId,
          type: 'info',
          title: `Order Placed: ${symbol}`,
          message: `${side} order for ${quantity} ${symbol} @ ₹${price} placed`,
          data: {
            symbol,
            action: 'ORDER_PLACED',
            quantity,
            price,
            source
          },
          read: false
        });
      } catch (notificationError) {
        LoggerService.error('TradeLogService', 'Error creating order placement notification:', notificationError);
      }

      return tradeLog;
    } catch (error) {
      LoggerService.error('TradeLogService', 'Error logging order placement:', error);
      throw error;
    }
  }

  /**
   * Log order filled
   * @param {Object} params Order fill details
   * @returns {Object} Saved trade log entry
   */
  static async logOrderFilled({
    userId,
    symbol,
    orderId,
    filledPrice,
    filledQuantity,
    orderType = 'MARKET',
    reason = 'ENTRY',
    details = {},
    source = 'APP'
  }) {
    // Only log FYERS source logs, skip APP logs
    if (source === 'APP') {
      LoggerService.info('TradeLogService', `Skipping APP log for ${symbol} - only FYERS logs allowed`);
      return null;
    }
    
    try {
      // Check if we already have a log for this order with ORDER_FILLED status
      if (orderId) {
        const existingLog = await TradeLog.findOne({
          userId,
          orderId,
          action: 'ORDER_FILLED'
        });

        if (existingLog) {
          // If the existing log is from APP and current is from FYERS, update it
          if (existingLog.details?.source === 'APP' && source === 'FYERS') {
            LoggerService.info('TradeLogService', `Upgrading existing APP log to FYERS log for order ${orderId}`);
            existingLog.details = {
              ...existingLog.details,
              ...details,
              source: 'FYERS'
            };
            await existingLog.save();
            return existingLog;
          } else if (existingLog.details?.source === 'FYERS' && source === 'APP') {
            // Skip app logs if Fyers log already exists
            LoggerService.info('TradeLogService', `Skipping APP log - FYERS log already exists for order ${orderId}`);
            return existingLog;
          } else {
            LoggerService.info('TradeLogService', `Order ${orderId} already has a FILLED log entry. Skipping.`);
            return existingLog;
          }
        }
      }

      // Find the original order to get the side
      const originalOrder = await TradeLog.findOne({
        userId,
        orderId,
        action: 'ORDER_PLACED'
      });

      const side = originalOrder ? originalOrder.side : 'BUY';

      const tradeLog = new TradeLog({
        userId,
        symbol,
        action: 'ORDER_FILLED',
        orderType,
        quantity: filledQuantity,
        price: filledPrice,
        side,
        status: 'FILLED',
        reason,
        orderId,
        details: {
          ...details,
          filledAt: new Date(),
          source: source
        }
      });

      await tradeLog.save();
      LoggerService.info('TradeLogService', `Order filled log created for ${symbol} ${filledQuantity} @ ${filledPrice} [Source: ${source}]`);
      
      // Create notification for the order fill
      try {
        await Notification.create({
          userId,
          type: 'success',
          title: `Order Filled: ${symbol}`,
          message: `${side} order for ${filledQuantity} ${symbol} @ ₹${filledPrice} filled`,
          data: {
            symbol,
            action: 'ORDER_FILLED',
            quantity: filledQuantity,
            price: filledPrice,
            source
          },
          read: false
        });
      } catch (notificationError) {
        LoggerService.error('TradeLogService', 'Error creating order filled notification:', notificationError);
      }

      return tradeLog;
    } catch (error) {
      LoggerService.error('TradeLogService', 'Error logging order fill:', error);
      throw error;
    }
  }

  /**
   * Log order rejection
   * @param {Object} params Order rejection details
   * @returns {Object} Saved trade log entry
   */
  static async logOrderRejected({
    userId,
    symbol,
    orderId,
    orderType = 'MARKET',
    quantity = 0,
    price = 0,
    reason = 'ENTRY',
    errorMessage = 'Order rejected',
    details = {},
    source = 'APP'
  }) {
    // Only log FYERS source logs, skip APP logs
    if (source === 'APP') {
      LoggerService.info('TradeLogService', `Skipping APP log for ${symbol} - only FYERS logs allowed`);
      return null;
    }
    
    try {
      // Check if we already have a log for this order with ORDER_REJECTED status
      if (orderId) {
        const existingLog = await TradeLog.findOne({
          userId,
          orderId,
          action: 'ORDER_REJECTED'
        });

        if (existingLog) {
          // If the existing log is from APP and current is from FYERS, update it with Fyers data
          if (existingLog.details?.source === 'APP' && source === 'FYERS') {
            LoggerService.info('TradeLogService', `Upgrading existing APP log to FYERS log for rejected order ${orderId}`);
            existingLog.details = {
              ...existingLog.details,
              ...details,
              errorMessage,
              source: 'FYERS'
            };
            await existingLog.save();
            return existingLog;
          } else if (existingLog.details?.source === 'FYERS' && source === 'APP') {
            // Skip app logs if Fyers log already exists
            LoggerService.info('TradeLogService', `Skipping APP log - FYERS log already exists for rejected order ${orderId}`);
            return existingLog;
          } else {
            LoggerService.info('TradeLogService', `Order ${orderId} already has a REJECTED log entry. Skipping.`);
            return existingLog;
          }
        }
      }

      // Find the original order to get the side
      const originalOrder = await TradeLog.findOne({
        userId,
        orderId,
        action: 'ORDER_PLACED'
      });

      const side = originalOrder ? originalOrder.side : 'BUY';

      const tradeLog = new TradeLog({
        userId,
        symbol,
        action: 'ORDER_REJECTED',
        orderType,
        quantity,
        price,
        side,
        status: 'REJECTED',
        reason,
        orderId,
        details: {
          ...details,
          errorMessage,
          rejectedAt: new Date(),
          source: source
        }
      });

      await tradeLog.save();
      LoggerService.info('TradeLogService', `Order rejected log created for ${symbol}: ${errorMessage} [Source: ${source}]`);
      
      // Create notification for the order rejection
      try {
        await Notification.create({
          userId,
          type: 'error',
          title: `Order Rejected: ${symbol}`,
          message: `${symbol} order was rejected: ${errorMessage}`,
          data: {
            symbol,
            action: 'ORDER_REJECTED',
            errorMessage,
            source
          },
          read: false
        });
      } catch (notificationError) {
        LoggerService.error('TradeLogService', 'Error creating order rejection notification:', notificationError);
      }

      return tradeLog;
    } catch (error) {
      LoggerService.error('TradeLogService', 'Error logging order rejection:', error);
      throw error;
    }
  }

  /**
   * Log stop loss hit
   * @param {Object} params Stop loss details
   * @returns {Object} Saved trade log entry
   */
  static async logStopLossHit({
    userId,
    symbol,
    entryPrice,
    stopLossPrice,
    exitPrice,
    quantity,
    pnl = 0,
    orderId,
    details = {},
    source = 'APP'
  }) {
    // Only log FYERS source logs, skip APP logs
    if (source === 'APP') {
      LoggerService.info('TradeLogService', `Skipping APP log for ${symbol} - only FYERS logs allowed`);
      return null;
    }
    
    try {
      // Check if we already have a log for this order with STOP_LOSS_HIT status
      if (orderId) {
        const existingLog = await TradeLog.findOne({
          userId,
          orderId,
          action: 'STOP_LOSS_HIT'
        });

        if (existingLog) {
          // If the existing log is from APP and current is from FYERS, update it
          if (existingLog.details?.source === 'APP' && source === 'FYERS') {
            LoggerService.info('TradeLogService', `Upgrading existing APP log to FYERS log for stop loss ${orderId}`);
            existingLog.details = {
              ...existingLog.details,
              ...details,
              source: 'FYERS'
            };
            await existingLog.save();
            return existingLog;
          } else if (existingLog.details?.source === 'FYERS' && source === 'APP') {
            // Skip app logs if Fyers log already exists
            LoggerService.info('TradeLogService', `Skipping APP log - FYERS log already exists for stop loss ${orderId}`);
            return existingLog;
          } else {
            LoggerService.info('TradeLogService', `Order ${orderId} already has a STOP_LOSS_HIT log entry. Skipping.`);
            return existingLog;
          }
        }
      }

      const tradeLog = new TradeLog({
        userId,
        symbol,
        action: 'STOP_LOSS_HIT',
        orderType: 'SL-M',
        quantity,
        price: exitPrice,
        side: 'SELL', // Always SELL for stop loss
        status: 'FILLED',
        reason: 'STOP_LOSS',
        orderId,
        pnl,
        details: {
          ...details,
          entryPrice,
          stopLossPrice,
          exitPrice,
          pnl,
          source
        }
      });

      await tradeLog.save();
      LoggerService.info('TradeLogService', `Stop loss hit log created for ${symbol} @ ${exitPrice}, PnL: ${pnl} [Source: ${source}]`);
      
      // Create notification for stop loss hit
      try {
        await Notification.create({
          userId,
          type: 'warning',
          title: `Stop Loss Hit: ${symbol}`,
          message: `Stop loss hit for ${symbol} @ ₹${exitPrice}, PnL: ₹${pnl}`,
          data: {
            symbol,
            action: 'STOP_LOSS_HIT',
            exitPrice,
            pnl,
            source
          },
          read: false
        });
      } catch (notificationError) {
        LoggerService.error('TradeLogService', 'Error creating stop loss notification:', notificationError);
      }

      return tradeLog;
    } catch (error) {
      LoggerService.error('TradeLogService', 'Error logging stop loss hit:', error);
      throw error;
    }
  }

  /**
   * Log target hit
   * @param {Object} params Target hit details
   * @returns {Object} Saved trade log entry
   */
  static async logTargetHit({
    userId,
    symbol,
    entryPrice,
    targetPrice,
    exitPrice,
    quantity,
    pnl = 0,
    orderId,
    details = {},
    source = 'APP'
  }) {
    // Only log FYERS source logs, skip APP logs
    if (source === 'APP') {
      LoggerService.info('TradeLogService', `Skipping APP log for ${symbol} - only FYERS logs allowed`);
      return null;
    }
    
    try {
      // Check if we already have a log for this order with TARGET_HIT status
      if (orderId) {
        const existingLog = await TradeLog.findOne({
          userId,
          orderId,
          action: 'TARGET_HIT'
        });

        if (existingLog) {
          // If the existing log is from APP and current is from FYERS, update it
          if (existingLog.details?.source === 'APP' && source === 'FYERS') {
            LoggerService.info('TradeLogService', `Upgrading existing APP log to FYERS log for target hit ${orderId}`);
            existingLog.details = {
              ...existingLog.details,
              ...details,
              source: 'FYERS'
            };
            await existingLog.save();
            return existingLog;
          } else if (existingLog.details?.source === 'FYERS' && source === 'APP') {
            // Skip app logs if Fyers log already exists
            LoggerService.info('TradeLogService', `Skipping APP log - FYERS log already exists for target hit ${orderId}`);
            return existingLog;
          } else {
            LoggerService.info('TradeLogService', `Order ${orderId} already has a TARGET_HIT log entry. Skipping.`);
            return existingLog;
          }
        }
      }

      const tradeLog = new TradeLog({
        userId,
        symbol,
        action: 'TARGET_HIT',
        orderType: 'MARKET',
        quantity,
        price: exitPrice,
        side: 'SELL', // Always SELL for target hit
        status: 'FILLED',
        reason: 'TARGET',
        orderId,
        pnl,
        details: {
          ...details,
          entryPrice,
          targetPrice,
          exitPrice,
          pnl,
          source
        }
      });

      await tradeLog.save();
      LoggerService.info('TradeLogService', `Target hit log created for ${symbol} @ ${exitPrice}, PnL: ${pnl} [Source: ${source}]`);
      
      // Create notification for target hit
      try {
        await Notification.create({
          userId,
          type: 'success',
          title: `Target Hit: ${symbol}`,
          message: `Target hit for ${symbol} @ ₹${exitPrice}, PnL: ₹${pnl}`,
          data: {
            symbol,
            action: 'TARGET_HIT',
            exitPrice,
            pnl,
            source
          },
          read: false
        });
      } catch (notificationError) {
        LoggerService.error('TradeLogService', 'Error creating target hit notification:', notificationError);
      }

      return tradeLog;
    } catch (error) {
      LoggerService.error('TradeLogService', 'Error logging target hit:', error);
      throw error;
    }
  }

  /**
   * Log manual exit
   * @param {Object} params Manual exit details
   * @returns {Object} Saved trade log entry
   */
  static async logManualExit({
    userId,
    symbol,
    entryPrice,
    exitPrice,
    quantity,
    pnl = 0,
    orderId,
    details = {},
    source = 'APP'
  }) {
    // Only log FYERS source logs, skip APP logs
    if (source === 'APP') {
      LoggerService.info('TradeLogService', `Skipping APP log for ${symbol} - only FYERS logs allowed`);
      return null;
    }
    
    try {
      // For manual exits, we don't need to check for duplicates
      // since they're intentional user actions
      const tradeLog = new TradeLog({
        userId,
        symbol,
        action: 'POSITION_CLOSED',
        orderType: 'MARKET',
        quantity,
        price: exitPrice,
        side: 'SELL', // Always SELL for position close
        status: 'FILLED',
        reason: 'MANUAL',
        orderId,
        pnl,
        details: {
          ...details,
          entryPrice,
          exitPrice,
          pnl,
          source
        }
      });

      await tradeLog.save();
      LoggerService.info('TradeLogService', `Manual exit log created for ${symbol} @ ${exitPrice}, PnL: ${pnl} [Source: ${source}]`);

      return tradeLog;
    } catch (error) {
      LoggerService.error('TradeLogService', 'Error logging manual exit:', error);
      throw error;
    }
  }

  /**
   * Helper method to deduplicate logs
   * @param {Object} query - Query to find existing logs
   * @param {string} source - Source of the log (APP or FYERS)
   * @returns {boolean} true if the log should be skipped
   */
  static async shouldSkipDuplicateLog(query, source) {
    const existingLog = await TradeLog.findOne(query);
    
    if (!existingLog) {
      return false; // No duplicate found, proceed with creating log
    }
    
    // If existing log is from APP and current is from FYERS, update it
    if (existingLog.details?.source === 'APP' && source === 'FYERS') {
      return false; // Don't skip, we'll update the APP log with FYERS data
    }
    
    // If existing log is already from FYERS, or current is from APP, skip it
    return true;
  }

  /**
   * Filter logs to prioritize Fyers logs over app logs
   * @param {Array} logs - Array of trade logs
   * @returns {Array} Filtered logs with Fyers logs prioritized
   */
  static prioritizeFyersLogs(logs) {
    const logMap = new Map(); // orderId_action -> log
    
    logs.forEach(log => {
      const key = `${log.orderId}_${log.action}`;
      const existingLog = logMap.get(key);
      
      if (!existingLog) {
        // First log for this order+action, add it
        logMap.set(key, log);
      } else {
        // Check if we should replace the existing log
        const existingSource = existingLog.details?.source || 'APP';
        const currentSource = log.details?.source || 'APP';
        
        // If existing is APP and current is FYERS, replace it
        if (existingSource === 'APP' && currentSource === 'FYERS') {
          logMap.set(key, log);
        }
        // If both are FYERS or both are APP, keep the first one (chronological order)
        // If existing is FYERS and current is APP, keep the existing FYERS log
      }
    });
    
    // Convert back to array and sort by timestamp
    const filteredLogs = Array.from(logMap.values()).sort((a, b) => b.timestamp - a.timestamp);
    
    // Additional filtering: Remove duplicate entries with same orderId and action but different sources
    const finalLogs = [];
    const seenKeys = new Set();
    
    filteredLogs.forEach(log => {
      const key = `${log.orderId}_${log.action}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        finalLogs.push(log);
      }
    });
    
    return finalLogs;
  }

  /**
   * Get today's trade logs (prioritizing Fyers logs)
   * @param {string} userId User ID
   * @returns {Promise<Array>} Today's trade logs
   */
  static async getTradeLogs(userId) {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      LoggerService.debug('TradeLogService', `Fetching trade logs for user ${userId} from ${today} to ${tomorrow}`);
      
      // Get all logs for today
      const allLogs = await TradeLog.find({
        userId,
        timestamp: { $gte: today, $lt: tomorrow }
      }).sort({ timestamp: -1 }).exec();
      
      // Filter to prioritize Fyers logs over app logs
      const filteredLogs = this.prioritizeFyersLogs(allLogs);
      
      LoggerService.debug('TradeLogService', `Found ${allLogs.length} total logs, ${filteredLogs.length} after Fyers prioritization`);
      
      return filteredLogs;
    } catch (error) {
      LoggerService.error('TradeLogService', 'Failed to get trade logs:', error);
      return [];
    }
  }

  /**
   * Get trade logs for a specific date (prioritizing Fyers logs)
   * @param {string} userId User ID
   * @param {Date} date Date to get logs for
   * @returns {Promise<Array>} Trade logs for the date
   */
  static async getTradeLogsByDate(userId, date) {
    try {
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      
      const endOfDay = new Date(startOfDay);
      endOfDay.setDate(endOfDay.getDate() + 1);
      
      // Get all logs for the date
      const allLogs = await TradeLog.find({
        userId,
        timestamp: { $gte: startOfDay, $lt: endOfDay }
      }).sort({ timestamp: -1 }).exec();
      
      // Filter to prioritize Fyers logs over app logs
      const filteredLogs = this.prioritizeFyersLogs(allLogs);
      
      LoggerService.debug('TradeLogService', `Found ${allLogs.length} total logs, ${filteredLogs.length} after Fyers prioritization for ${date}`);
      
      return filteredLogs;
    } catch (error) {
      LoggerService.error('TradeLogService', `Failed to get trade logs for ${date}:`, error);
      return [];
    }
  }

  /**
   * Get all trade logs for a user (prioritizing Fyers logs)
   * @param {string} userId User ID
   * @returns {Promise<Array>} All trade logs
   */
  static async getAllTradeLogs(userId) {
    try {
      LoggerService.debug('TradeLogService', `Querying all trade logs for user ${userId}`);
      // Get logs for the past 30 days (per requirements)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      // Get all logs for the period
      const allLogs = await TradeLog.find({ 
        userId,
        timestamp: { $gte: thirtyDaysAgo }
      }).sort({ timestamp: -1 }).exec();
      
      // Filter to prioritize Fyers logs over app logs
      const filteredLogs = this.prioritizeFyersLogs(allLogs);
      
      LoggerService.debug('TradeLogService', `Found ${allLogs.length} total logs, ${filteredLogs.length} after Fyers prioritization`);
      return filteredLogs;
    } catch (error) {
      LoggerService.error('TradeLogService', 'Failed to get all trade logs:', error);
      return [];
    }
  }

  /**
   * Clean up duplicate logs (can be run as a maintenance task)
   * @param {string} userId User ID
   * @returns {Promise<Object>} Cleanup results
   */
  static async cleanupDuplicateLogs(userId) {
    try {
      const result = {
        processed: 0,
        deleted: 0,
        upgraded: 0,
        unchanged: 0
      };

      // Find all orders with multiple logs of the same action
      const duplicateCandidates = await TradeLog.aggregate([
        { $match: { userId: userId } },
        { $group: {
            _id: { orderId: "$orderId", action: "$action" },
            count: { $sum: 1 },
            docs: { $push: "$$ROOT" }
          }
        },
        { $match: { count: { $gt: 1 } } }
      ]);

      // Process each set of duplicates
      for (const candidate of duplicateCandidates) {
        result.processed++;
        
        // Sort by source (FYERS first, then APP)
        const sorted = candidate.docs.sort((a, b) => {
          if (a.details?.source === 'FYERS' && b.details?.source !== 'FYERS') return -1;
          if (a.details?.source !== 'FYERS' && b.details?.source === 'FYERS') return 1;
          return 0;
        });
        
        // Keep the first one (FYERS if available), delete or mark others
        const keep = sorted[0];
        
        for (let i = 1; i < sorted.length; i++) {
          await TradeLog.deleteOne({ _id: sorted[i]._id });
          result.deleted++;
        }
      }

      return result;
    } catch (error) {
      LoggerService.error('TradeLogService', 'Error cleaning up duplicate logs:', error);
      return { error: error.message };
    }
  }
}

module.exports = { TradeLogService }; 