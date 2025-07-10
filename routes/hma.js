/**
 * HMA Service Routes
 */
const express = require('express');
const router = express.Router();
const { HMAService } = require('../services/hmaService');
const auth = require('../middleware/auth');
const User = require('../models/User');
const HullSuiteService = require('../services/hullSuiteService');
const LoggerService = require('../services/loggerService');

// Hull Suite HMA9 Strategy Routes

/**
 * @route   GET /api/hma/hull-suite-signals
 * @desc    Get Hull Suite signals for all stocks
 * @access  Private
 */
router.get('/hull-suite-signals', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const signals = await HullSuiteService.getHullSuiteSignals(userId);
    
    res.json({
      success: true,
      data: signals,
      count: signals.length
    });
  } catch (error) {
    LoggerService.error('HMA Routes', 'Error getting Hull Suite signals:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching Hull Suite signals',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/hma/hull-suite-signals/:symbol
 * @desc    Get Hull Suite signal for specific stock
 * @access  Private
 */
router.get('/hull-suite-signals/:symbol', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { symbol } = req.params;
    
    const signal = await HullSuiteService.getHullSuiteSignalForSymbol(userId, symbol);
    
    res.json({
      success: true,
      data: signal
    });
  } catch (error) {
    LoggerService.error('HMA Routes', `Error getting Hull Suite signal for ${req.params.symbol}:`, error);
    res.status(500).json({
      success: false,
      message: 'Error fetching Hull Suite signal',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/hma/update-hull-suite-signals
 * @desc    Update Hull Suite signals for all stocks
 * @access  Private
 */
router.post('/update-hull-suite-signals', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await HullSuiteService.updateHullSuiteSignals(userId);
    
    res.json({
      success: true,
      message: 'Hull Suite signals updated successfully',
      data: result
    });
  } catch (error) {
    LoggerService.error('HMA Routes', 'Error updating Hull Suite signals:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating Hull Suite signals',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/hma/calc
 * @desc    Calculate HMA for a symbol (fetches data and calculates HMA)
 * @access  Private
 */
router.get('/calc', auth, async (req, res) => {
  try {
    const { symbol } = req.query;
    
    if (!symbol) {
      return res.status(400).json({ 
        success: false, 
        message: 'Symbol parameter is required' 
      });
    }
    
    console.log(`🎯 HMA calculation requested for symbol: ${symbol}`);
    
    // Use the HMAService to fetch and calculate HMA
    const result = await HMAService.fetchAndCalculateHMA(symbol, req.user);
    
    return res.json({
      success: true,
      data: {
        currentHMA: result.currentHMA,
        period: result.period,
        data: result.data,
        lastUpdate: result.lastUpdate,
        status: result.status,
        message: result.message || 'HMA calculation completed successfully'
      }
    });
  } catch (error) {
    console.error('Error calculating HMA:', error);
    return res.status(500).json({ 
      success: false, 
      message: error.message || 'Server error calculating HMA' 
    });
  }
});

/**
 * @route   GET /api/hma/test
 * @desc    Test HMA calculation without trading hours filter
 * @access  Private
 */
router.get('/test', auth, async (req, res) => {
  try {
    const { symbol } = req.query;
    
    if (!symbol) {
      return res.status(400).json({ 
        success: false, 
        message: 'Symbol parameter is required' 
      });
    }
    
    console.log(`🧪 TEST: HMA calculation requested for symbol: ${symbol}`);
    
    // Use the HMAService test function
    const result = await HMAService.fetchAndCalculateHMATest(symbol, req.user);
    
    return res.json({
      success: true,
      data: {
        currentHMA: result.currentHMA,
        period: result.period,
        data: result.data,
        lastUpdate: result.lastUpdate,
        status: result.status,
        message: result.message || 'Test HMA calculation completed successfully'
      }
    });
  } catch (error) {
    console.error('Error in test HMA calculation:', error);
    return res.status(500).json({ 
      success: false, 
      message: error.message || 'Server error in test HMA calculation' 
    });
  }
});

/**
 * @route   GET /api/hma/cache-stats
 * @desc    Get HMA cache statistics
 * @access  Private
 */
router.get('/cache-stats', auth, async (req, res) => {
  try {
    const stats = HMAService.getCacheStats();
    
    return res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error getting HMA cache stats:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error getting HMA cache stats' 
    });
  }
});

/**
 * @route   DELETE /api/hma/cache/clear
 * @desc    Clear HMA cache for a symbol
 * @access  Private
 */
router.delete('/cache/clear', auth, async (req, res) => {
  try {
    const { symbol } = req.query;
    
    if (!symbol) {
      return res.status(400).json({ 
        success: false, 
        message: 'Symbol parameter is required' 
      });
    }
    
    const result = HMAService.clearCache(symbol);
    
    return res.json({
      success: result,
      message: result ? 'Cache cleared successfully' : 'Failed to clear cache'
    });
  } catch (error) {
    console.error('Error clearing HMA cache:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error clearing HMA cache' 
    });
  }
});

/**
 * @route   POST /api/hma/calculate
 * @desc    Calculate HMA for given data
 * @access  Private
 */
router.post('/calculate', auth, async (req, res) => {
  try {
    const { data, period, priceKey } = req.body;
    
    if (!data || !Array.isArray(data) || data.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid data array provided' 
      });
    }
    
    if (!period || period <= 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid period provided' 
      });
    }
    
    const hmaValues = HMAService.calculateHMA(data, period, priceKey || 'close');
    
    return res.json({
      success: true,
      data: hmaValues
    });
  } catch (error) {
    console.error('Error calculating HMA:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error calculating HMA' 
    });
  }
});

/**
 * @route   POST /api/hma/signals
 * @desc    Calculate HMA signals for given data
 * @access  Private
 */
router.post('/signals', auth, async (req, res) => {
  try {
    const { data, fastPeriod, slowPeriod, priceKey } = req.body;
    
    if (!data || !Array.isArray(data) || data.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid data array provided' 
      });
    }
    
    const options = {
      fastPeriod: fastPeriod || 9,
      slowPeriod: slowPeriod || 21,
      priceKey: priceKey || 'close'
    };
    
    const signals = HMAService.calculateHMASignals(data, options);
    
    return res.json({
      success: true,
      data: signals
    });
  } catch (error) {
    console.error('Error calculating HMA signals:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error calculating HMA signals' 
    });
  }
});

/**
 * @route   POST /api/hma/multiple
 * @desc    Calculate multiple HMAs with different periods
 * @access  Private
 */
router.post('/multiple', auth, async (req, res) => {
  try {
    const { data, periods, priceKey } = req.body;
    
    if (!data || !Array.isArray(data) || data.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid data array provided' 
      });
    }
    
    if (!periods || !Array.isArray(periods) || periods.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid periods array provided' 
      });
    }
    
    const hmaValues = HMAService.calculateMultipleHMAs(data, periods, priceKey || 'close');
    
    return res.json({
      success: true,
      data: hmaValues
    });
  } catch (error) {
    console.error('Error calculating multiple HMAs:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error calculating multiple HMAs' 
    });
  }
});

/**
 * @route   POST /api/hma/trend-strength
 * @desc    Calculate HMA trend strength
 * @access  Private
 */
router.post('/trend-strength', auth, async (req, res) => {
  try {
    const { hma, lookback } = req.body;
    
    if (!hma || !Array.isArray(hma)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid HMA array provided' 
      });
    }
    
    const trendStrength = HMAService.calculateTrendStrength(hma, lookback || 5);
    
    return res.json({
      success: true,
      data: {
        trendStrength
      }
    });
  } catch (error) {
    console.error('Error calculating HMA trend strength:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error calculating HMA trend strength' 
    });
  }
});

/**
 * Update HMA with latest 5-minute data (for real-time monitoring)
 * POST /api/hma/update
 */
router.post('/update', auth, async (req, res) => {
  try {
    const { symbol, existingCandles = [] } = req.body;
    
    if (!symbol) {
      return res.status(400).json({ 
        success: false, 
        error: 'Symbol is required' 
      });
    }
    
    console.log(`🔄 Real-time HMA update requested for ${symbol}`);
    
    // Get user's Fyers access token
    const user = await User.findById(req.user.id);
    if (!user || !user.fyersData || !user.fyersData.accessToken) {
      return res.status(401).json({ 
        success: false, 
        error: 'Fyers access token not found. Please connect your Fyers account.' 
      });
    }
    
    const accessToken = user.fyersData.accessToken;
    
    // Update HMA with latest data
    const hmaData = await HMAService.updateHMAWithLatestData(symbol, accessToken, existingCandles);
    
    console.log(`✅ Real-time HMA update completed for ${symbol}: ${hmaData.currentHMA}`);
    
    res.json({
      success: true,
      data: hmaData
    });
    
  } catch (error) {
    console.error(`❌ Error in real-time HMA update:`, error);
    
    // Handle specific error cases
    if (error.message.includes('503')) {
      return res.status(503).json({
        success: false,
        error: 'Fyers API is temporarily unavailable. Please try again later.',
        retryAfter: 60 // Retry after 1 minute
      });
    } else if (error.message.includes('401')) {
      return res.status(401).json({
        success: false,
        error: 'Fyers authentication failed. Please reconnect your account.',
        requiresReauth: true
      });
    } else if (error.message.includes('Insufficient candles')) {
      return res.status(400).json({
        success: false,
        error: error.message,
        requiresFullCalculation: true
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to update HMA with latest data',
        details: error.message
      });
    }
  }
});

/**
 * @route   POST /api/hma/convert-symbol
 * @desc    Convert frontend symbol to Fyers symbol format
 * @access  Private
 */
router.post('/convert-symbol', auth, async (req, res) => {
  try {
    const { symbol, spotPrice } = req.body;
    
    if (!symbol) {
      return res.status(400).json({ 
        success: false, 
        message: 'Symbol parameter is required' 
      });
    }
    
    console.log(`🔄 Symbol conversion requested: ${symbol}`);
    
    // Use the SymbolService to convert the symbol
    const { SymbolService } = require('../services/symbolService');
    const fyersSymbol = SymbolService.convertToFyersSymbol(symbol, spotPrice || 25000);
    
    return res.json({
      success: true,
      frontendSymbol: symbol,
      fyersSymbol: fyersSymbol,
      message: 'Symbol converted successfully'
    });
  } catch (error) {
    console.error('Error converting symbol:', error);
    return res.status(400).json({ 
      success: false, 
      message: error.message || 'Failed to convert symbol' 
    });
  }
});

// Get Hull Suite signals for all stocks
router.get('/hull-suite-signals', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const signals = await HullSuiteService.getHullSuiteSignals(userId);
    
    res.json({
      success: true,
      data: signals,
      count: signals.length
    });
  } catch (error) {
    LoggerService.error('HMA Routes', 'Error getting Hull Suite signals:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching Hull Suite signals',
      error: error.message
    });
  }
});

// Get Hull Suite signal for specific stock
router.get('/hull-suite-signals/:symbol', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { symbol } = req.params;
    
    const signal = await HullSuiteService.getHullSuiteSignalForSymbol(userId, symbol);
    
    res.json({
      success: true,
      data: signal
    });
  } catch (error) {
    LoggerService.error('HMA Routes', `Error getting Hull Suite signal for ${req.params.symbol}:`, error);
    res.status(500).json({
      success: false,
      message: 'Error fetching Hull Suite signal',
      error: error.message
    });
  }
});

// Update Hull Suite signals for all stocks
router.post('/update-hull-suite-signals', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await HullSuiteService.updateHullSuiteSignals(userId);
    
    res.json({
      success: true,
      message: 'Hull Suite signals updated successfully',
      data: result
    });
  } catch (error) {
    LoggerService.error('HMA Routes', 'Error updating Hull Suite signals:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating Hull Suite signals',
      error: error.message
    });
  }
});

module.exports = router;
