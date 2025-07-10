/**
 * Market Routes
 */
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { MarketService } = require('../services/marketService');
const { MarketDataService } = require('../services/marketDataService');
const { SymbolService } = require('../services/symbolService');
const { getMultipleLiveMarketData, VALID_INDEX_SYMBOLS } = require('../liveMarketDataService');
const { SymbolService: OldSymbolService } = require('../services/symbolService');
const { MarketDataService: OldMarketDataService } = require('../services/marketDataService');
const LoggerService = require('../services/loggerService');

// Simple in-memory cache for market data
const marketDataCache = {
  historical: new Map(),
  quotes: new Map(), // Add cache for quotes
  
  // Method to clear cache
  clear(cacheType) {
    if (this[cacheType]) {
      this[cacheType].clear();
      LoggerService.cacheOperation('clear', cacheType);
      return true;
    }
    return false;
  },
  
  // Method to get cache stats
  getStats() {
    return {
      historical: this.historical.size,
      quotes: this.quotes.size
    };
  }
};

// Cache TTL in milliseconds (30 seconds for historical, 5 seconds for quotes)
const CACHE_TTL = {
  historical: 30 * 1000,
  quotes: 5 * 1000
};

/**
 * @route   GET /api/market/health
 * @desc    Get server health status
 * @access  Public
 */
router.get('/health', async (req, res) => {
  try {
    return res.json({
      success: true,
      status: 'running',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    LoggerService.error('MarketRoute', 'Error getting server health:', error);
    return res.status(500).json({ 
      success: false, 
      status: 'error',
      message: 'Server error getting health status' 
    });
  }
});

/**
 * @route   GET /api/market/status
 * @desc    Get market status
 * @access  Private
 */
router.get('/status', auth, async (req, res) => {
  try {
    const status = MarketService.getMarketStatus();
    
    return res.json({
      success: true,
      data: status
    });
  } catch (error) {
    LoggerService.error('MarketRoute', 'Error getting market status:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error getting market status' 
    });
  }
});

/**
 * @route   GET /api/market/polling-status
 * @desc    Get market data polling status
 * @access  Private
 */
router.get('/polling-status', auth, async (req, res) => {
  try {
    const pollingStatus = MarketService.getPollingStatus();
    
    return res.json({
      success: true,
      data: pollingStatus
    });
  } catch (error) {
    LoggerService.error('MarketRoute', 'Error getting polling status:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error getting polling status' 
    });
  }
});

/**
 * @route   GET /api/market/data/:symbol
 * @desc    Get historical market data for a symbol
 * @access  Private
 */
router.get('/data/:symbol', auth, async (req, res) => {
  try {
    const { symbol } = req.params;
    const { timeframe = '1d', limit = 100, useCache = 'true' } = req.query;
    
    const data = await MarketDataService.fetchHistoricalData(
      symbol,
      timeframe,
      parseInt(limit),
      useCache === 'true'
    );
    
    return res.json({
      success: true,
      data
    });
  } catch (error) {
    LoggerService.error('MarketRoute', 'Error fetching historical data:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error fetching historical data' 
    });
  }
});

/**
 * @route   POST /api/market/data/indicators
 * @desc    Get market data with indicators
 * @access  Private
 */
router.post('/data/indicators', auth, async (req, res) => {
  try {
    const { symbol, timeframe = '1d', indicators = [] } = req.body;
    
    if (!symbol) {
      return res.status(400).json({ 
        success: false, 
        message: 'Symbol is required' 
      });
    }
    
    const data = await MarketDataService.fetchDataWithIndicators(symbol, timeframe, indicators);
    
    return res.json({
      success: true,
      data
    });
  } catch (error) {
    LoggerService.error('MarketRoute', 'Error fetching data with indicators:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error fetching data with indicators' 
    });
  }
});

/**
 * @route   DELETE /api/market/cache/:symbol
 * @desc    Clear cache for a symbol
 * @access  Private
 */
router.delete('/cache/:symbol', auth, async (req, res) => {
  try {
    const { symbol } = req.params;
    
    const success = await MarketDataService.clearCache(symbol);
    
    return res.json({
      success,
      message: success ? 'Cache cleared successfully' : 'Failed to clear cache'
    });
  } catch (error) {
    LoggerService.error('MarketRoute', 'Error clearing cache:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error clearing cache' 
    });
  }
});

/**
 * @route   DELETE /api/market/cache
 * @desc    Clear all cache
 * @access  Private
 */
router.delete('/cache', auth, async (req, res) => {
  try {
    const success = await MarketDataService.clearAllCache();
    
    return res.json({
      success,
      message: success ? 'All cache cleared successfully' : 'Failed to clear all cache'
    });
  } catch (error) {
    LoggerService.error('MarketRoute', 'Error clearing all cache:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error clearing all cache' 
    });
  }
});

/**
 * @route   GET /api/market/quote/:symbol
 * @desc    Get real-time quote for a symbol
 * @access  Private
 */
router.get('/quote/:symbol', auth, async (req, res) => {
  try {
    const { symbol } = req.params;
    
    const quote = await MarketService.getQuote(symbol, req.user);
    
    return res.json({
      success: true,
      data: quote
    });
  } catch (error) {
    LoggerService.error('MarketRoute', 'Error getting quote:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error getting quote' 
    });
  }
});

/**
 * @route   POST /api/market/quotes
 * @desc    Get real-time quotes for multiple symbols
 * @access  Private
 */
router.post('/quotes', auth, async (req, res) => {
  try {
    const { symbols } = req.body;
    
    if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Valid symbols array is required' 
      });
    }
    
    // Fetch user with Fyers data since auth middleware might not include it
    const User = require('../models/User');
    const userWithFyers = await User.findById(req.user._id);
    
    const quotes = await MarketService.getQuotes(symbols, userWithFyers);
    
    return res.json({
      success: true,
      data: quotes
    });
  } catch (error) {
    LoggerService.error('MarketRoute', 'Error getting quotes:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error getting quotes' 
    });
  }
});

/**
 * @route   GET /api/market/indices
 * @desc    Get index data
 * @access  Private
 */
router.get('/indices', auth, async (req, res) => {
  try {
    const indices = await MarketService.getIndices(req.user);
    
    return res.json({
      success: true,
      data: indices
    });
  } catch (error) {
    LoggerService.error('MarketRoute', 'Error getting indices:', error);
    
    // Check if it's a Fyers connection error
    if (error.message && error.message.includes('Fyers access token')) {
      return res.status(401).json({ 
        success: false, 
        message: error.message,
        requiresReconnection: true
      });
    }
    
    return res.status(500).json({ 
      success: false, 
      message: 'Server error getting indices' 
    });
  }
});

/**
 * @route   GET /api/market/symbols/:index
 * @desc    Get option symbols for an index
 * @access  Private
 */
router.get('/symbols/:index', auth, async (req, res) => {
  try {
    const { index } = req.params;
    const { spotPrice } = req.query;
    
    if (!spotPrice) {
      return res.status(400).json({ 
        success: false, 
        message: 'spotPrice is required' 
      });
    }
    
    const symbols = SymbolService.generateStrikeSymbols(index, parseFloat(spotPrice));
    
    return res.json({
      success: true,
      data: symbols
    });
  } catch (error) {
    LoggerService.error('MarketRoute', 'Error generating option symbols:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error generating option symbols' 
    });
  }
});

/**
 * @route   POST /api/market/subscribe
 * @desc    Subscribe to real-time market data
 * @access  Private
 */
router.post('/subscribe', auth, async (req, res) => {
  try {
    const { symbols } = req.body;
    
    if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Valid symbols array is required' 
      });
    }
    
    // Store the subscription in the user's session
    req.session.subscribedSymbols = symbols;
    
    // Subscribe to symbols
    await MarketService.subscribeToSymbols(symbols, req.user.id);
    
    return res.json({
      success: true,
      message: 'Subscribed to symbols successfully'
    });
  } catch (error) {
    LoggerService.error('MarketRoute', 'Error subscribing to symbols:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error subscribing to symbols' 
    });
  }
});

/**
 * @route   POST /api/market/unsubscribe
 * @desc    Unsubscribe from real-time market data
 * @access  Private
 */
router.post('/unsubscribe', auth, async (req, res) => {
  try {
    const { symbols } = req.body;
    
    if (!symbols || !Array.isArray(symbols)) {
      // Unsubscribe from all symbols
      req.session.subscribedSymbols = [];
      await MarketService.unsubscribeFromAllSymbols(req.user.id);
    } else {
      // Unsubscribe from specific symbols
      req.session.subscribedSymbols = (req.session.subscribedSymbols || [])
        .filter(symbol => !symbols.includes(symbol));
      
      await MarketService.unsubscribeFromSymbols(symbols, req.user.id);
    }
    
    return res.json({
      success: true,
      message: 'Unsubscribed from symbols successfully'
    });
  } catch (error) {
    LoggerService.error('MarketRoute', 'Error unsubscribing from symbols:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error unsubscribing from symbols' 
    });
  }
});

/**
 * @route   POST /api/market/data/batch
 * @desc    Get market data for multiple symbols in batch
 * @access  Private
 */
router.post('/data/batch', auth, async (req, res) => {
  try {
    const { symbols } = req.body;
    
    if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Valid symbols array is required' 
      });
    }
    
    // Fetch user with Fyers data since auth middleware might not include it
    const User = require('../models/User');
    const userWithFyers = await User.findById(req.user._id);
    
    // Get quotes for all symbols using user's Fyers connection
    const data = await MarketService.getQuotes(symbols, userWithFyers);
    
    return res.json({
      success: true,
      data
    });
  } catch (error) {
    LoggerService.error('MarketRoute', 'Error getting batch market data:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error getting batch market data' 
    });
  }
});

/**
 * @route   GET /api/market/test-symbols/:index
 * @desc    Test symbol generation for debugging
 * @access  Public
 */
router.get('/test-symbols/:index', async (req, res) => {
  try {
    const { index } = req.params;
    const { spotPrice = 25500 } = req.query;
    
    LoggerService.debug('MarketRoute', `Testing symbol generation for: ${index} with spot price ${spotPrice}`);
    
    // Test the symbol generation
    const testResult = SymbolService.generateTestSymbols(index, parseFloat(spotPrice));
    
    // Also test the full symbol generation
    const fullSymbols = SymbolService.generateStrikeSymbols(index, parseFloat(spotPrice));
    
    return res.json({
      success: true,
      data: {
        testResult,
        fullSymbols: {
          ceCount: fullSymbols.ce.length,
          peCount: fullSymbols.pe.length,
          sampleCE: fullSymbols.ce[0]?.symbol,
          samplePE: fullSymbols.pe[0]?.symbol,
          atmStrike: fullSymbols.atmStrike
        }
      }
    });
  } catch (error) {
    LoggerService.error('MarketRoute', 'Error testing symbol generation:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error testing symbol generation',
      error: error.message
    });
  }
});

module.exports = router; 