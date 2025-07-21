const express = require('express');
const router = express.Router();
const { MonitoringService } = require('../services/monitoringService');
const auth = require('../middleware/auth');
const TradingState = require('../models/TradingState');

/**
 * @route   GET /api/monitoring/maintenance-status
 * @desc    Get maintenance status
 * @access  Public
 */
router.get('/maintenance-status', async (req, res) => {
  try {
    // For now, return inactive status
    return res.json({
      isActive: false,
      message: 'System is operational'
    });
  } catch (error) {
    console.error('Error getting maintenance status:', error);
    return res.status(500).json({ 
      isActive: false,
      message: 'Error checking maintenance status' 
    });
  }
});

/**
 * @route   POST /api/monitoring/debug-fix
 * @desc    Temporary debug endpoint to fix monitoring state
 * @access  Public (temporary)
 */
router.post('/debug-fix', async (req, res) => {
  try {
    console.log('🔧 Debug fix endpoint called');
    
    // Find all trading states
    const states = await TradingState.find({});
    console.log(`📊 Found ${states.length} trading states`);

    if (states.length === 0) {
      return res.json({ success: false, message: 'No trading states found' });
    }

    let fixedCount = 0;
    let symbolUpdates = 0;

    for (const state of states) {
      console.log(`Processing user ${state.userId}`);
      
      // Enable monitoring if not already enabled
      if (!state.tradeExecutionState?.isMonitoring) {
        await TradingState.updateOne(
          { userId: state.userId },
          { 
            $set: { 
              'tradeExecutionState.isMonitoring': true,
              'tradeExecutionState.lastMonitoringUpdate': new Date()
            }
          }
        );
        fixedCount++;
        console.log(`✅ Enabled monitoring for user ${state.userId}`);
      }
      
      // Update symbol statuses
      if (state.monitoredSymbols && state.monitoredSymbols.length > 0) {
        for (const symbol of state.monitoredSymbols) {
          if (!symbol.triggerStatus || symbol.triggerStatus === 'WAITING') {
            // Determine initial status based on LTP vs HMA
            let newStatus = 'WAITING_FOR_REVERSAL'; // Default
            
            if (symbol.currentLTP && symbol.hmaValue) {
              if (symbol.currentLTP <= symbol.hmaValue) {
                newStatus = 'WAITING_FOR_ENTRY';
              } else {
                newStatus = 'WAITING_FOR_REVERSAL';
              }
            }
            
            await TradingState.updateOne(
              { userId: state.userId, 'monitoredSymbols.id': symbol.id },
              {
                $set: {
                  'monitoredSymbols.$.triggerStatus': newStatus,
                  'monitoredSymbols.$.lastUpdate': new Date()
                }
              }
            );
            symbolUpdates++;
            console.log(`✅ Updated ${symbol.symbol} status to ${newStatus}`);
          }
        }
      }
    }

    console.log(`✅ Debug fix completed: ${fixedCount} users fixed, ${symbolUpdates} symbols updated`);
    
    return res.json({
      success: true,
      message: `Debug fix completed: ${fixedCount} users fixed, ${symbolUpdates} symbols updated`,
      data: { fixedCount, symbolUpdates }
    });

  } catch (error) {
    console.error('❌ Error in debug fix:', error);
    return res.status(500).json({
      success: false,
      message: 'Error in debug fix',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/monitoring/start
 * @desc    Start monitoring for the user
 * @access  Private
 */
router.post('/start', auth, async (req, res) => {
  try {
    const success = await MonitoringService.startMonitoring(req.user.id);
    
    return res.json({
      success,
      message: success ? 'Monitoring started successfully' : 'Failed to start monitoring'
    });
  } catch (error) {
    console.error('Error starting monitoring:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error starting monitoring' 
    });
  }
});

/**
 * @route   POST /api/monitoring/stop
 * @desc    Stop monitoring for the user
 * @access  Private
 */
router.post('/stop', auth, async (req, res) => {
  try {
    const success = await MonitoringService.stopMonitoring(req.user.id);
    
    return res.json({
      success,
      message: success ? 'Monitoring stopped successfully' : 'Failed to stop monitoring'
    });
  } catch (error) {
    console.error('Error stopping monitoring:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error stopping monitoring' 
    });
  }
});

/**
 * @route   POST /api/monitoring/symbols/add
 * @desc    Add symbol to monitoring
 * @access  Private
 */
router.post('/symbols/add', auth, async (req, res) => {
  try {
    const { 
      symbol, type, lots, targetPoints, stopLossPoints, 
      entryMethod, autoExitOnTarget, autoExitOnStopLoss, 
      trailingStopLoss, trailingStopLossOffset, 
      // New trailing stoploss parameters
      useTrailingStoploss, trailingX, trailingY,
      timeBasedExit, exitAtMarketClose, exitAfterMinutes, 
      maxReEntries, tradingMode, productType, orderType, 
      index, hmaValue, quantity
    } = req.body;
    
    // Validate required fields
    if (!symbol || !type) {
      return res.status(400).json({ 
        success: false, 
        message: 'Symbol and type are required' 
      });
    }
    
    const symbolData = {
      symbol,
      type,
      lots: lots || 1,
      quantity: quantity || 0,
      targetPoints: targetPoints || 0,
      stopLossPoints: stopLossPoints || 0,
      entryMethod: entryMethod || 'HMA_CROSS',
      autoExitOnTarget: autoExitOnTarget !== undefined ? autoExitOnTarget : true,
      autoExitOnStopLoss: autoExitOnStopLoss !== undefined ? autoExitOnStopLoss : true,
      trailingStopLoss: trailingStopLoss || false,
      trailingStopLossOffset: trailingStopLossOffset || 0,
      // New trailing stoploss parameters
      useTrailingStoploss: useTrailingStoploss || false,
      trailingX: trailingX || 20,
      trailingY: trailingY || 15,
      timeBasedExit: timeBasedExit || false,
      exitAtMarketClose: exitAtMarketClose || false,
      exitAfterMinutes: exitAfterMinutes || 0,
      maxReEntries: maxReEntries || 0,
      tradingMode: 'LIVE',
      productType: productType || 'INTRADAY',
      orderType: orderType || 'MARKET',
      index: index || { lotSize: 75 },
      hmaValue: hmaValue || 0
    };
    
    const state = await MonitoringService.addSymbolToMonitoring(req.user.id, symbolData);
    
    // Clear monitored symbols cache to ensure fresh data
    const { MarketService } = require('../services/marketService');
    MarketService.clearMonitoredSymbolsCache();
    
    return res.json({
      success: true,
      data: state,
      message: 'Symbol added to monitoring successfully'
    });
  } catch (error) {
    console.error('Error adding symbol to monitoring:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error adding symbol to monitoring' 
    });
  }
});

/**
 * @route   DELETE /api/monitoring/symbols/:symbolId
 * @desc    Remove symbol from monitoring
 * @access  Private
 */
router.delete('/symbols/:symbolId', auth, async (req, res) => {
  try {
    const { symbolId } = req.params;
    const state = await MonitoringService.removeSymbolFromMonitoring(req.user.id, symbolId);
    
    return res.json({
      success: true,
      data: state,
      message: 'Symbol removed from monitoring'
    });
  } catch (error) {
    console.error('Error removing symbol from monitoring:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error removing symbol from monitoring' 
    });
  }
});

/**
 * @route   DELETE /api/monitoring/symbols
 * @desc    Clear all monitoring
 * @access  Private
 */
router.delete('/symbols', auth, async (req, res) => {
  try {
    const success = await MonitoringService.clearAllMonitoring(req.user.id);
    
    return res.json({
      success,
      message: success ? 'All monitoring cleared' : 'Failed to clear monitoring'
    });
  } catch (error) {
    console.error('Error clearing monitoring:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error clearing monitoring' 
    });
  }
});

/**
 * @route   POST /api/monitoring/hma/update
 * @desc    Update HMA values for monitored symbols
 * @access  Private
 */
router.post('/hma/update', auth, async (req, res) => {
  try {
    const state = await MonitoringService.updateHMAValues(req.user.id);
    
    return res.json({
      success: true,
      data: state,
      message: 'HMA values updated'
    });
  } catch (error) {
    console.error('Error updating HMA values:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error updating HMA values' 
    });
  }
});

/**
 * @route   POST /api/monitoring/cycle/execute
 * @desc    Execute monitoring cycle
 * @access  Private
 */
router.post('/cycle/execute', auth, async (req, res) => {
  try {
    const results = await MonitoringService.executeMonitoringCycle(req.user.id);
    
    return res.json({
      success: true,
      data: results,
      message: `Monitoring cycle executed: ${results.executed} trades executed`
    });
  } catch (error) {
    console.error('Error executing monitoring cycle:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error executing monitoring cycle' 
    });
  }
});

/**
 * @route   POST /api/monitoring/positions/update
 * @desc    Update active positions
 * @access  Private
 */
router.post('/positions/update', auth, async (req, res) => {
  try {
    const results = await MonitoringService.updateActivePositions(req.user.id);
    
    return res.json({
      success: true,
      data: results,
      message: `Positions updated: ${results.updated} updated, ${results.closed} closed`
    });
  } catch (error) {
    console.error('Error updating positions:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error updating positions' 
    });
  }
});

/**
 * @route   GET /api/monitoring/status
 * @desc    Get monitoring status
 * @access  Private
 */
router.get('/status', auth, async (req, res) => {
  try {
    const status = await MonitoringService.getMonitoringStatus(req.user.id);
    
    return res.json({
      success: true,
      data: status
    });
  } catch (error) {
    console.error('Error getting monitoring status:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error getting monitoring status' 
    });
  }
});

/**
 * @route   GET /api/monitoring/maintenance-status
 * @desc    Get maintenance status
 * @access  Public
 */
router.get('/maintenance-status', (req, res) => {
  res.json({ isActive: false, message: '' });
});

/**
 * @route   POST /api/monitoring/symbols/update-hma
 * @desc    Update HMA value for a specific symbol
 * @access  Private
 */
router.post('/symbols/update-hma', auth, async (req, res) => {
  try {
    const { symbolId, hmaValue, lastUpdate } = req.body;
    
    if (!symbolId || hmaValue === undefined) {
      return res.status(400).json({ 
        success: false, 
        message: 'Symbol ID and HMA value are required' 
      });
    }
    
    // Get the current state
    let state = await TradingState.findOne({ userId: req.user.id });
    if (!state) {
      return res.status(404).json({
        success: false,
        message: 'Trading state not found'
      });
    }
    
    // Find the symbol and update its HMA value
    const symbolIndex = state.monitoredSymbols.findIndex(s => s.id === symbolId);
    if (symbolIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Symbol not found in monitored symbols'
      });
    }
    
    // Update the symbol
    state.monitoredSymbols[symbolIndex].hmaValue = hmaValue;
    state.monitoredSymbols[symbolIndex].lastUpdate = lastUpdate || new Date();
    
    // Save the state
    await state.save();
    
    return res.json({
      success: true,
      data: state,
      message: `Updated HMA value for symbol ${symbolId}`
    });
  } catch (error) {
    console.error('Error updating symbol HMA:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error updating symbol HMA' 
    });
  }
});

/**
 * @route   POST /api/monitoring/order-status-update
 * @desc    Handle order status update from Fyers WebSocket
 * @access  Private
 */
router.post('/order-status-update', auth, async (req, res) => {
  try {
    const { orderId, status } = req.body;
    
    if (!orderId || !status) {
      return res.status(400).json({ 
        success: false, 
        message: 'Order ID and status are required' 
      });
    }
    
    const result = await MonitoringService.handleOrderStatusUpdate(orderId, status, req.user.id);
    
    return res.json({
      success: result.success,
      data: result,
      message: result.success ? 'Order status updated' : result.message
    });
  } catch (error) {
    console.error('Error updating order status:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error updating order status' 
    });
  }
});

/**
 * @route   POST /api/monitoring/exit-position
 * @desc    Exit an active position
 * @access  Private
 */
router.post('/exit-position', auth, async (req, res) => {
  try {
    const { positionId } = req.body;
    
    if (!positionId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Position ID is required' 
      });
    }
    
    const result = await MonitoringService.exitPosition(positionId, req.user.id);
    
    return res.json({
      success: result.success,
      message: result.message,
      data: result
    });
  } catch (error) {
    console.error('Error exiting position:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error exiting position' 
    });
  }
});

/**
 * @route   POST /api/monitoring/place-limit-order
 * @desc    Manually place a limit order for a monitored symbol
 * @access  Private
 */
router.post('/place-limit-order', auth, async (req, res) => {
  try {
    const { symbolId } = req.body;
    
    if (!symbolId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Symbol ID is required' 
      });
    }
    
    const result = await MonitoringService.placeLimitOrderForSymbol(symbolId, req.user.id);
    
    return res.json({
      success: result.success,
      message: result.message,
      data: result
    });
  } catch (error) {
    console.error('Error placing limit order:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error placing limit order' 
    });
  }
});

/**
 * @route   GET /api/monitoring/order-modifications/:symbolId
 * @desc    Get order modification history for a specific symbol
 * @access  Private
 */
router.get('/order-modifications/:symbolId', auth, async (req, res) => {
  try {
    const { symbolId } = req.params;
    const userId = req.user.id;

    if (!symbolId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Symbol ID is required' 
      });
    }

    const TradingState = require('../models/TradingState');
    const state = await TradingState.findOne({ userId });
    
    if (!state) {
      return res.status(404).json({ 
        success: false, 
        message: 'Trading state not found' 
      });
    }

    // Find the symbol in monitored symbols
    const symbol = state.monitoredSymbols.find(s => s.id === symbolId);
    if (!symbol) {
      return res.status(404).json({ 
        success: false, 
        message: 'Symbol not found in monitored symbols' 
      });
    }

    // Get modification history
    const modifications = symbol.orderModifications || [];
    
    // Format modifications for frontend
    const formattedModifications = modifications.map(mod => ({
      timestamp: mod.timestamp,
      oldOrderId: mod.oldOrderId,
      newOrderId: mod.newOrderId,
      oldHmaValue: mod.oldHmaValue,
      newHmaValue: mod.newHmaValue,
      oldLimitPrice: mod.oldLimitPrice,
      newLimitPrice: mod.newLimitPrice,
      reason: mod.reason,
      modificationType: mod.modificationType,
      hmaChange: mod.newHmaValue - mod.oldHmaValue,
      priceChange: mod.newLimitPrice - mod.oldLimitPrice
    }));

    return res.json({
      success: true,
      data: {
        symbol: symbol.symbol,
        currentOrderId: symbol.orderId,
        currentStatus: symbol.triggerStatus,
        modificationCount: symbol.orderModificationCount || 0,
        lastModification: symbol.lastOrderModification,
        modifications: formattedModifications
      }
    });
  } catch (error) {
    console.error('Error getting order modifications:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error getting order modifications' 
    });
  }
});

/**
 * @route   POST /api/monitoring/reset-symbol-opportunity
 * @desc    Reset opportunity state for a specific symbol
 * @access  Private
 */
router.post('/reset-symbol-opportunity', auth, async (req, res) => {
  try {
    const { symbolId } = req.body;
    const userId = req.user.id;

    if (!symbolId) {
      return res.status(400).json({ success: false, message: 'Symbol ID is required' });
    }

    const success = await MonitoringService.resetSymbolOpportunity(userId, symbolId);
    
    if (success) {
      res.json({ success: true, message: 'Symbol opportunity state reset successfully' });
    } else {
      res.status(500).json({ success: false, message: 'Failed to reset symbol opportunity state' });
    }
  } catch (error) {
    console.error('Error resetting symbol opportunity:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * @route   POST /api/monitoring/force-schema-update
 * @desc    Force update all monitoredSymbols' triggerStatus to valid enum values
 * @access  Public (TEMPORARY - REMOVE AFTER USE)
 */
router.post('/force-schema-update', async (req, res) => {
  try {
    const TradingState = require('../models/TradingState');
    const VALID_STATUSES = [
      'WAITING', 'ORDER_PLACED', 'ORDER_MODIFIED', 'ORDER_REJECTED',
      'WAITING_REENTRY', 'TRIGGERED', 'CONFIRMED', 'EXECUTED', 'CANCELLED',
      'WAITING_FOR_REVERSAL', 'WAITING_FOR_ENTRY', 'ACTIVE_POSITION', 'CONFIRMING_REVERSAL'
    ];
    const states = await TradingState.find({});
    let updatedCount = 0;
    for (const state of states) {
      let changed = false;
      if (Array.isArray(state.monitoredSymbols)) {
        for (const symbol of state.monitoredSymbols) {
          if (!VALID_STATUSES.includes(symbol.triggerStatus)) {
            symbol.triggerStatus = 'WAITING_FOR_REVERSAL';
            changed = true;
          }
        }
      }
      if (changed) {
        await state.save();
        updatedCount++;
      }
    }
    return res.json({ success: true, updatedCount, message: 'Schema force-update complete.' });
  } catch (error) {
    console.error('Error in force-schema-update:', error);
    return res.status(500).json({ success: false, message: 'Error in force-schema-update', error: error.message });
  }
});

/**
 * @route   POST /api/monitoring/debug-fix
 * @desc    Temporary debug endpoint to fix monitoring state
 * @access  Public (temporary)
 */
router.post('/debug-fix', async (req, res) => {
  try {
    console.log('🔧 Debug fix endpoint called');
    
    // Find all trading states
    const states = await TradingState.find({});
    console.log(`📊 Found ${states.length} trading states`);

    if (states.length === 0) {
      return res.json({ success: false, message: 'No trading states found' });
    }

    let fixedCount = 0;
    let symbolUpdates = 0;

    for (const state of states) {
      console.log(`Processing user ${state.userId}`);
      
      // Enable monitoring if not already enabled
      if (!state.tradeExecutionState?.isMonitoring) {
        await TradingState.updateOne(
          { userId: state.userId },
          { 
            $set: { 
              'tradeExecutionState.isMonitoring': true,
              'tradeExecutionState.lastMonitoringUpdate': new Date()
            }
          }
        );
        fixedCount++;
        console.log(`✅ Enabled monitoring for user ${state.userId}`);
      }
      
      // Update symbol statuses
      if (state.monitoredSymbols && state.monitoredSymbols.length > 0) {
        for (const symbol of state.monitoredSymbols) {
          if (!symbol.triggerStatus || symbol.triggerStatus === 'WAITING') {
            // Determine initial status based on LTP vs HMA
            let newStatus = 'WAITING_FOR_REVERSAL'; // Default
            
            if (symbol.currentLTP && symbol.hmaValue) {
              if (symbol.currentLTP <= symbol.hmaValue) {
                newStatus = 'WAITING_FOR_ENTRY';
              } else {
                newStatus = 'WAITING_FOR_REVERSAL';
              }
            }
            
            await TradingState.updateOne(
              { userId: state.userId, 'monitoredSymbols.id': symbol.id },
              {
                $set: {
                  'monitoredSymbols.$.triggerStatus': newStatus,
                  'monitoredSymbols.$.lastUpdate': new Date()
                }
              }
            );
            symbolUpdates++;
            console.log(`✅ Updated ${symbol.symbol} status to ${newStatus}`);
          }
        }
      }
    }

    console.log(`✅ Debug fix completed: ${fixedCount} users fixed, ${symbolUpdates} symbols updated`);
    
    return res.json({
      success: true,
      message: `Monitoring fixed: ${fixedCount} users, ${symbolUpdates} symbols updated`,
      data: { usersFixed: fixedCount, symbolsUpdated: symbolUpdates }
    });

  } catch (error) {
    console.error('❌ Error in debug fix:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error in debug fix' 
    });
  }
});

/**
 * @route   POST /api/monitoring/move-strike-to-entry
 * @desc    Manually move a strike from CONFIRMING_REVERSAL to WAITING_FOR_ENTRY
 * @access  Public (TEMPORARY - REMOVE AFTER USE)
 */
router.post('/move-strike-to-entry', async (req, res) => {
  try {
    const { symbolId } = req.body;
    const TradingState = require('../models/TradingState');
    
    console.log(`🚀 Manual move strike to entry requested for symbol ID: ${symbolId}`);
    
    // Find the trading state containing this symbol
    const state = await TradingState.findOne({
      'monitoredSymbols.id': symbolId
    });
    
    if (!state) {
      return res.status(404).json({
        success: false,
        message: 'Symbol not found in monitoring'
      });
    }
    
    // Find the specific symbol
    const symbol = state.monitoredSymbols.find(s => s.id === symbolId);
    
    if (!symbol) {
      return res.status(404).json({
        success: false,
        message: 'Symbol not found'
      });
    }
    
    if (symbol.triggerStatus !== 'CONFIRMING_REVERSAL') {
      return res.status(400).json({
        success: false,
        message: 'Symbol is not in CONFIRMING_REVERSAL status'
      });
    }
    
    // Update the symbol to WAITING_FOR_ENTRY status
    const now = new Date();
    
    // Update the pending signal to indicate manual override
    const updatedPendingSignal = {
      ...symbol.pendingSignal,
      direction: 'ENTRY',
      state: 'WAITING',
      reversalConfirmed: true,
      entryReadyAt: now,
      manualOverride: true,
      manualOverrideAt: now
    };
    
    await TradingState.updateOne(
      { _id: state._id, 'monitoredSymbols.id': symbolId },
      {
        $set: {
          'monitoredSymbols.$.triggerStatus': 'WAITING_FOR_ENTRY',
          'monitoredSymbols.$.pendingSignal': updatedPendingSignal,
          'monitoredSymbols.$.orderModificationReason': 'Manual override - moved to Waiting for Entry'
        }
      }
    );
    
    console.log(`✅ Successfully moved ${symbol.symbol} from CONFIRMING_REVERSAL to WAITING_FOR_ENTRY via manual override`);
    
    return res.json({
      success: true,
      message: `Successfully moved ${symbol.symbol} to Waiting for Entry`,
      symbol: symbol.symbol,
      newStatus: 'WAITING_FOR_ENTRY'
    });
  } catch (error) {
    console.error('❌ Error in move strike to entry:', error);
    return res.status(500).json({
      success: false,
      message: 'Error moving strike to entry'
    });
  }
});

/**
 * @route   POST /api/monitoring/recover-orders
 * @desc    Manually recover order statuses from Fyers API
 * @access  Private
 */
router.post('/recover-orders', auth, async (req, res) => {
  try {
    console.log('🔄 Manual order recovery requested by user:', req.user.id);
    
    const { FyersWebSocketService } = require('../services/fyersWebSocketService');
    
    // Start order recovery
    await FyersWebSocketService.recoverOrderStatuses();
    
    // Get updated status
    const status = await MonitoringService.getMonitoringStatus(req.user.id);
    
    return res.json({
      success: true,
      message: 'Order recovery completed successfully',
      data: status
    });
  } catch (error) {
    console.error('Error recovering orders:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error recovering orders' 
    });
  }
});

/**
 * @route   POST /api/monitoring/recover-orders-debug
 * @desc    Debug endpoint to recover order statuses without auth (TEMPORARY)
 * @access  Public (TEMPORARY)
 */
router.post('/recover-orders-debug', async (req, res) => {
  try {
    console.log('🔄 Debug order recovery requested (no auth)');
    
    const { FyersWebSocketService } = require('../services/fyersWebSocketService');
    
    // Start order recovery
    await FyersWebSocketService.recoverOrderStatuses();
    
    return res.json({
      success: true,
      message: 'Order recovery completed successfully (debug mode)'
    });
  } catch (error) {
    console.error('Error recovering orders (debug):', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error recovering orders',
      error: error.message
    });
  }
});

/**
 * @route   DELETE /api/monitoring/orders/:orderId
 * @desc    Cancel an order on Fyers
 * @access  Private
 */
router.delete('/orders/:orderId', auth, async (req, res) => {
  try {
    const { orderId } = req.params;
    
    console.log(`❌ Cancel order requested for order ID: ${orderId} by user: ${req.user.id}`);
    
    const success = await MonitoringService.cancelOrder(orderId, req.user.id);
    
    if (success) {
      return res.json({
        success: true,
        message: `Order ${orderId} cancelled successfully`
      });
    } else {
      return res.status(400).json({
        success: false,
        message: `Failed to cancel order ${orderId}`
      });
    }
  } catch (error) {
    console.error('Error cancelling order:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error cancelling order',
      error: error.message
    });
  }
});

module.exports = router; 