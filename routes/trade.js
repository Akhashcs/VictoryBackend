/**
 * Trade Service Routes
 */
const express = require('express');
const router = express.Router();
const { TradeService } = require('../services/tradeService');
const auth = require('../middleware/auth');

/**
 * @route   POST /api/trade/live
 * @desc    Place a live trade
 * @access  Private
 */
router.post('/live', auth, async (req, res) => {
  try {
    const { symbol, quantity, price, action, orderType, fyersAccessToken } = req.body;
    
    // Validate required fields
    if (!symbol || !quantity || !price) {
      return res.status(400).json({ 
        success: false, 
        message: 'Symbol, quantity, and price are required' 
      });
    }
    
    if (!fyersAccessToken) {
      return res.status(400).json({ 
        success: false, 
        message: 'Fyers access token is required for live trading' 
      });
    }
    
    // Add user ID to trade data
    const tradeData = {
      symbol,
      quantity,
      price,
      action: action || 'BUY',
      orderType: orderType || 'MARKET',
      userId: req.user.id,
      fyersAccessToken
    };
    
    const tradeLog = await TradeService.placeLiveTrade(tradeData);
    
    return res.json({
      success: true,
      data: tradeLog
    });
  } catch (error) {
    console.error('Error placing live trade:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error placing live trade' 
    });
  }
});

/**
 * @route   GET /api/trade/logs
 * @desc    Get today's trade logs for the user
 * @access  Private
 */
router.get('/logs', auth, async (req, res) => {
  try {
    console.log(`[Trade Route] Fetching today's trade logs for user: ${req.user.id}`);
    const logs = await TradeService.getTradeLogs(req.user.id);
    console.log(`[Trade Route] Returning ${logs.length} trade logs for today`);
    
    return res.json({
      success: true,
      data: logs
    });
  } catch (error) {
    console.error('Error fetching trade logs:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error fetching trade logs' 
    });
  }
});

/**
 * @route   GET /api/trade/logs/all
 * @desc    Get all trade logs for the user
 * @access  Private
 */
router.get('/logs/all', auth, async (req, res) => {
  try {
    console.log(`[Trade Route] Fetching all trade logs for user: ${req.user.id}`);
    const logs = await TradeService.getAllTradeLogs(req.user.id);
    console.log(`[Trade Route] Returning ${logs.length} total trade logs`);
    
    return res.json({
      success: true,
      data: logs
    });
  } catch (error) {
    console.error('Error fetching all trade logs:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error fetching all trade logs' 
    });
  }
});

/**
 * @route   GET /api/trade/logs/date/:date
 * @desc    Get trade logs for a specific date
 * @access  Private
 */
router.get('/logs/date/:date', auth, async (req, res) => {
  try {
    const date = new Date(req.params.date);
    
    if (isNaN(date.getTime())) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid date format' 
      });
    }
    
    const logs = await TradeService.getTradeLogsByDate(req.user.id, date);
    
    return res.json({
      success: true,
      data: logs
    });
  } catch (error) {
    console.error('Error fetching trade logs by date:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error fetching trade logs by date' 
    });
  }
});

/**
 * @route   GET /api/trade/stats
 * @desc    Get trade statistics for the user
 * @access  Private
 */
router.get('/stats', auth, async (req, res) => {
  try {
    const stats = await TradeService.getTradeStats(req.user.id);
    
    return res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error fetching trade statistics:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error fetching trade statistics' 
    });
  }
});

/**
 * @route   POST /api/trade/state
 * @desc    Save trading state for the user
 * @access  Private
 */
router.post('/state', auth, async (req, res) => {
  try {
    console.log('[Trade Route] Full request body:', JSON.stringify(req.body, null, 2));
    
    const { state } = req.body;
    
    console.log('[Trade Route] Received state save request');
    console.log('[Trade Route] State type:', typeof state);
    console.log('[Trade Route] State keys:', Object.keys(state || {}));
    console.log('[Trade Route] MonitoredSymbols type:', typeof state?.monitoredSymbols);
    console.log('[Trade Route] MonitoredSymbols isArray:', Array.isArray(state?.monitoredSymbols));
    console.log('[Trade Route] MonitoredSymbols length:', state?.monitoredSymbols?.length);
    console.log('[Trade Route] MonitoredSymbols value:', state?.monitoredSymbols);
    
    if (!state || typeof state !== 'object') {
      return res.status(400).json({ 
        success: false, 
        message: 'Valid trading state object is required' 
      });
    }
    
    const success = await TradeService.saveTradingState(state, req.user.id);
    
    if (!success) {
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to save trading state' 
      });
    }
    
    return res.json({
      success: true,
      message: 'Trading state saved successfully'
    });
  } catch (error) {
    console.error('Error saving trading state:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error saving trading state' 
    });
  }
});

/**
 * @route   GET /api/trade/state
 * @desc    Load trading state for the user
 * @access  Private
 */
router.get('/state', auth, async (req, res) => {
  try {
    console.log('[Trade Route] Loading trading state for user:', req.user.id);
    
    const state = await TradeService.loadTradingState(req.user.id);
    
    console.log('[Trade Route] Loaded state:', {
      hasState: !!state,
      stateType: typeof state,
      stateKeys: state ? Object.keys(state) : null,
      monitoredSymbolsType: typeof state?.monitoredSymbols,
      monitoredSymbolsIsArray: Array.isArray(state?.monitoredSymbols),
      monitoredSymbolsLength: state?.monitoredSymbols?.length,
      monitoredSymbolsSample: state?.monitoredSymbols?.[0]
    });
    
    return res.json({
      success: true,
      data: state
    });
  } catch (error) {
    console.error('Error loading trading state:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error loading trading state' 
    });
  }
});

/**
 * @route   DELETE /api/trade/state
 * @desc    Clear trading state for the user
 * @access  Private
 */
router.delete('/state', auth, async (req, res) => {
  try {
    const success = await TradeService.clearTradingState(req.user.id);
    
    if (!success) {
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to clear trading state' 
      });
    }
    
    return res.json({
      success: true,
      message: 'Trading state cleared successfully'
    });
  } catch (error) {
    console.error('Error clearing trading state:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error clearing trading state' 
    });
  }
});

/**
 * @route   POST /api/trade/state/reset
 * @desc    Reset trading state for the user (clear and create fresh)
 * @access  Private
 */
router.post('/state/reset', auth, async (req, res) => {
  try {
    // First clear any existing state
    await TradeService.clearTradingState(req.user.id);
    
    // Create a fresh state with empty arrays
    const freshState = {
      monitoredSymbols: [],
      activePositions: [],
      tradeExecutionState: {
        isMonitoring: false,
        lastMarketDataUpdate: null,
        lastHMAUpdate: null,
        monitoringStartTime: null,
        totalTradesExecuted: 0,
        totalPnL: 0
      },
      settings: {},
      lastUpdated: new Date()
    };
    
    const success = await TradeService.saveTradingState(freshState, req.user.id);
    
    if (!success) {
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to reset trading state' 
      });
    }
    
    return res.json({
      success: true,
      message: 'Trading state reset successfully',
      data: freshState
    });
  } catch (error) {
    console.error('Error resetting trading state:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error resetting trading state' 
    });
  }
});

/**
 * @route   GET /api/trade/logs/today
 * @desc    Get today's trade logs
 * @access  Private
 */
router.get('/logs/today', auth, async (req, res) => {
  try {
    const { TradeLogService } = require('../services/tradeLogService');
    const logs = await TradeLogService.getTodayLogs(req.user.id);
    
    res.json({
      success: true,
      data: logs,
      message: `Retrieved ${logs.length} trade logs for today`
    });
  } catch (error) {
    console.error('Error getting today logs:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving today\'s trade logs'
    });
  }
});

/**
 * @route   GET /api/trade/logs/history
 * @desc    Get 3 months of trade logs
 * @access  Private
 */
router.get('/logs/history', auth, async (req, res) => {
  try {
    const { TradeLogService } = require('../services/tradeLogService');
    const logs = await TradeLogService.getThreeMonthsLogs(req.user.id);
    
    res.json({
      success: true,
      data: logs,
      message: `Retrieved ${logs.length} trade logs for last 3 months`
    });
  } catch (error) {
    console.error('Error getting history logs:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving trade history'
    });
  }
});

/**
 * @route   GET /api/trade/logs/action/:action
 * @desc    Get trade logs by action type
 * @access  Private
 */
router.get('/logs/action/:action', auth, async (req, res) => {
  try {
    const { TradeLogService } = require('../services/tradeLogService');
    const { action } = req.params;
    const { days = 30 } = req.query;
    
    const logs = await TradeLogService.getLogsByAction(req.user.id, action, parseInt(days));
    
    res.json({
      success: true,
      data: logs,
      message: `Retrieved ${logs.length} ${action} logs for last ${days} days`
    });
  } catch (error) {
    console.error('Error getting logs by action:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving logs by action'
    });
  }
});

/**
 * @route   POST /api/trade/logs/cleanup
 * @desc    Clean up duplicate trade logs, prioritizing Fyers logs
 * @access  Private
 */
router.post('/logs/cleanup', auth, async (req, res) => {
  try {
    console.log(`[Trade Route] Starting cleanup of duplicate logs for user: ${req.user.id}`);
    
    const { TradeLogService } = require('../services/tradeLogService');
    const result = await TradeLogService.cleanupDuplicateLogs(req.user.id);
    
    return res.json({
      success: true,
      message: 'Duplicate logs cleanup completed',
      data: result
    });
  } catch (error) {
    console.error('Error cleaning up duplicate logs:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error while cleaning up duplicate logs' 
    });
  }
});

module.exports = router;
