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

module.exports = router; 