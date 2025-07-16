/**
 * Market Service for backend
 * Handles market status and real-time market data operations
 */
const axios = require('axios');
const mongoose = require('mongoose');
const { getMarketDepth, getFyersAppId } = require('../fyersService');
const TradingState = require('../models/TradingState');
const LoggerService = require('./loggerService');
const SymbolConfig = require('../models/SymbolConfig');

// Define a schema for market data subscriptions
const MarketSubscriptionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  symbols: {
    type: [String],
    default: []
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  }
});

// Create a model if it doesn't exist
let MarketSubscription;
try {
  MarketSubscription = mongoose.model('MarketSubscription');
} catch (error) {
  MarketSubscription = mongoose.model('MarketSubscription', MarketSubscriptionSchema);
}

// Import the complete symbol list from liveMarketDataService
// We'll use our own dynamic symbols instead of importing from liveMarketDataService

// Removed FUTURES_SYMBOLS as we no longer need to fetch futures data

class MarketService {
  // Cache for market data
  static marketDataCache = {
    quotes: new Map(),
    indices: new Map()
  };

  // Cache TTL in milliseconds
  static CACHE_TTL = {
    quotes: 5000,    // 5 seconds
    indices: 10000   // 10 seconds
  };

  // Polling intervals
  static POLLING_INTERVALS = {
    combined: 5000   // 5 seconds for all market data (combined indices + monitored) - increased from 1s to prevent rate limits
  };

  // Polling timers
  static pollingTimers = {
    combined: null
  };

  // Cache for symbol configurations from MongoDB
  static symbolConfigCache = {
    symbols: [],
    lastUpdated: 0,
    cacheTTL: 30000  // 30 seconds cache TTL
  };

  // Cache for monitored symbols
  static monitoredSymbolsCache = {
    symbols: new Set(),
    lastUpdated: 0,
    cacheTTL: 5000   // 5 seconds cache TTL for monitored symbols
  };

  // Rate limit tracking
  static rateLimitStats = {
    requestsThisMinute: 0,
    requestsThisSecond: 0,
    lastMinuteReset: Date.now(),
    lastSecondReset: Date.now()
  };

  /**
   * Get market status
   * @returns {Object} Market status
   */
  static getMarketStatus() {
    const isOpen = this.isMarketOpenNow();
    
    return {
      status: isOpen ? 'open' : 'closed',
      isOpen,
      nextOpenTime: this.getNextMarketOpenTime(),
      nextCloseTime: this.getNextMarketCloseTime()
    };
  }

  /**
   * Check if market is open now
   * @returns {boolean} Is market open
   */
  static isMarketOpenNow() {
    const now = new Date();
    
    // Use proper timezone conversion to IST (same as frontend)
    const istTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const hours = istTime.getHours();
    const minutes = istTime.getMinutes();
    const currentTime = hours * 100 + minutes;
    
    // Check if it's a weekday (Monday-Friday)
    const dayOfWeek = istTime.getDay();
    const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
    
    // Market hours: 9:00 AM to 4:00 PM IST (matching old implementation)
    const marketOpen = 900; // 9:00 AM
    const marketClose = 1600; // 4:00 PM
    const isMarketHours = currentTime >= marketOpen && currentTime <= marketClose;
    
    return isWeekday && isMarketHours;
  }

  /**
   * Get next market open time
   * @returns {Date} Next market open time
   */
  static getNextMarketOpenTime() {
    const now = new Date();
    
    // Use proper timezone conversion to IST
    const istTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const hours = istTime.getHours();
    const minutes = istTime.getMinutes();
    const dayOfWeek = istTime.getDay();
    
    // Create a new date object for the next market open time
    const nextOpenTime = new Date(istTime);
    
    // Set the time to 9:00 AM IST
    nextOpenTime.setHours(9, 0, 0, 0);
    
    // If it's already past 9:00 AM IST today
    if (hours > 9 || (hours === 9 && minutes >= 0)) {
      // Move to the next day
      nextOpenTime.setDate(nextOpenTime.getDate() + 1);
    }
    
    // If it's Friday after market hours or weekend, move to Monday
    if ((dayOfWeek === 5 && (hours > 16 || (hours === 16 && minutes > 0))) || dayOfWeek === 6) {
      // Calculate days until Monday
      const daysUntilMonday = dayOfWeek === 5 ? 3 : dayOfWeek === 6 ? 2 : 1;
      nextOpenTime.setDate(nextOpenTime.getDate() + daysUntilMonday);
    }
    
    return nextOpenTime;
  }

  /**
   * Get next market close time
   * @returns {Date} Next market close time
   */
  static getNextMarketCloseTime() {
    const now = new Date();
    
    // Use proper timezone conversion to IST
    const istTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const hours = istTime.getHours();
    const minutes = istTime.getMinutes();
    const dayOfWeek = istTime.getDay();
    
    // Create a new date object for the next market close time
    const nextCloseTime = new Date(istTime);
    
    // Set the time to 4:00 PM IST
    nextCloseTime.setHours(16, 0, 0, 0);
    
    // If it's already past 4:00 PM IST today
    if (hours > 16 || (hours === 16 && minutes > 0)) {
      // Move to the next day
      nextCloseTime.setDate(nextCloseTime.getDate() + 1);
    }
    
    // If it's Friday after market hours or weekend, move to Monday
    if ((dayOfWeek === 5 && (hours > 16 || (hours === 16 && minutes > 0))) || dayOfWeek === 6) {
      // Calculate days until Monday
      const daysUntilMonday = dayOfWeek === 5 ? 3 : dayOfWeek === 6 ? 2 : 1;
      nextCloseTime.setDate(nextCloseTime.getDate() + daysUntilMonday);
    }
    
    return nextCloseTime;
  }

  /**
   * Get quote for a symbol
   * @param {string} symbol - Symbol to get quote for
   * @param {Object} user - User object (optional, for Fyers access)
   * @returns {Promise<Object>} Quote data
   */
  static async getQuote(symbol, user = null) {
    try {
      // Check cache first
      const cachedQuote = this.marketDataCache.quotes.get(symbol);
      if (cachedQuote && (Date.now() - cachedQuote.timestamp < this.CACHE_TTL.quotes)) {
        LoggerService.cacheOperation('hit', symbol);
        return cachedQuote.data;
      }
      
      // Get quote from Fyers API
      const response = await this.fetchQuoteFromFyers(symbol, user);
      
      // Cache the result
      this.marketDataCache.quotes.set(symbol, {
        timestamp: Date.now(),
        data: response
      });
      
      // Use the new quote fetched logger
      LoggerService.quoteFetched(symbol);
      
      return response;
    } catch (error) {
      LoggerService.error('MarketService', `Error getting quote for ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * Get quotes for multiple symbols
   * @param {Array<string>} symbols - Symbols to get quotes for
   * @param {Object} user - User object (optional, for Fyers access)
   * @returns {Promise<Array<Object>>} Array of quote data
   */
  static async getQuotes(symbols, user = null) {
    try {
      // Generate cache key based on symbols
      const cacheKey = symbols.sort().join(',');
      
      // Check cache first
      const cachedQuotes = this.marketDataCache.quotes.get(cacheKey);
      if (cachedQuotes && (Date.now() - cachedQuotes.timestamp < this.CACHE_TTL.quotes)) {
        LoggerService.cacheOperation('hit', `${symbols.length} symbols`);
        return cachedQuotes.data;
      }
      
      // Get quotes from Fyers API
      const response = await this.fetchQuotesFromFyers(symbols, user);
      
      // Cache the result
      this.marketDataCache.quotes.set(cacheKey, {
        timestamp: Date.now(),
        data: response
      });
      
      // Log each symbol fetched
      symbols.forEach(symbol => LoggerService.quoteFetched(symbol));
      
      return response;
    } catch (error) {
      LoggerService.error('MarketService', 'Error getting quotes:', error);
      throw error;
    }
  }

  /**
   * Get indices data
   * @param {Object} user - User object (optional, for Fyers access)
   * @returns {Promise<Array>} Array of index data
   */
  static async getIndices(user = null) {
    try {
      // Check cache first
      const cachedIndices = this.marketDataCache.indices.get('indices');
      if (cachedIndices && (Date.now() - cachedIndices.timestamp < this.CACHE_TTL.indices)) {
        return cachedIndices.data;
      }
      
      // Get quotes from Fyers API
      const allSymbols = await this.getAllMarketSymbols();
      const response = await this.fetchQuotesFromFyers(allSymbols, user);
      
      // Cache the result
      this.marketDataCache.indices.set('indices', {
        timestamp: Date.now(),
        data: response
      });
      
      return response;
    } catch (error) {
      console.error('[MarketService] Error getting indices:', error);
      throw error;
    }
  }

  /**
   * Fetch quote from Fyers API
   * @param {string} symbol - Symbol to fetch
   * @param {Object} user - User object (optional, for Fyers access)
   * @returns {Promise<Object>} Quote data
   */
  static async fetchQuoteFromFyers(symbol, user = null) {
    try {
      // Get access token from user's Fyers connection ONLY
      let accessToken = null;
      if (user && user.fyers && user.fyers.accessToken && user.fyers.connected) {
        const { getFyersAppId } = require('../fyersService');
        const appId = getFyersAppId();
        accessToken = `${appId}:${user.fyers.accessToken}`;
        LoggerService.debug('MarketService', 'Using user Fyers access token for quotes');
      } else {
        LoggerService.error('MarketService', 'No Fyers access token available for user. User must relogin to Fyers.');
        throw new Error('Fyers access token missing or expired. Please relogin to Fyers.');
      }
      
      // Convert symbol to Fyers format if it's not already
      let fyersSymbol = symbol;
      if (!symbol.includes(':')) {
        try {
          const { SymbolService } = require('./symbolService');
          // Use a default spot price based on the index
          let spotPrice = 25000; // Default for NIFTY
          if (symbol.includes('BANKNIFTY')) {
            spotPrice = 48000;
          } else if (symbol.includes('SENSEX')) {
            spotPrice = 72000;
          }
          
          fyersSymbol = SymbolService.convertToFyersSymbol(symbol, spotPrice);
          LoggerService.debug('MarketService', `Converted symbol ${symbol} to Fyers format: ${fyersSymbol}`);
        } catch (conversionError) {
          LoggerService.error('MarketService', `Failed to convert symbol ${symbol} to Fyers format:`, conversionError);
          throw new Error(`Invalid symbol format: ${symbol}`);
        }
      }

      // Fetch real market data from Fyers
      const response = await getMarketDepth(accessToken, [fyersSymbol]);
      
      if (response && response.s && response.s === 'ok' && response.d && response.d.length > 0) {
        const item = response.d[0];
        // Transform Fyers response to our format
        return {
          symbol: item.n,
          ltp: parseFloat(item.ltp) || 0,
          change: parseFloat(item.ch) || 0,
          changePercent: parseFloat(item.chp) || 0,
          volume: parseInt(item.vol) || 0,
          open: parseFloat(item.open_price) || 0,
          high: parseFloat(item.high_price) || 0,
          low: parseFloat(item.low_price) || 0,
          close: parseFloat(item.prev_close_price) || 0,
          timestamp: Date.now()
        };
      } else {
        LoggerService.warn('MarketService', 'Invalid response from Fyers');
        // If Fyers response is invalid, throw error instead of returning mock data
        throw new Error('Invalid response from Fyers API. Please check your connection.');
      }
    } catch (error) {
      LoggerService.error('MarketService', `Error fetching quote from Fyers for ${symbol}:`, error);
      // Re-throw the error instead of returning mock data
      throw error;
    }
  }

  /**
   * Fetch quotes from Fyers API
   * @param {Array<string>} symbols - Symbols to fetch
   * @param {Object} user - User object (optional, for Fyers access)
   * @returns {Promise<Array<Object>>} Array of quote data
   */
  static async fetchQuotesFromFyers(symbols, user = null) {
    try {
      // Track rate limits
      const now = Date.now();
      
      // Reset counters if needed
      if (now - this.rateLimitStats.lastSecondReset >= 1000) {
        this.rateLimitStats.requestsThisSecond = 0;
        this.rateLimitStats.lastSecondReset = now;
      }
      
      if (now - this.rateLimitStats.lastMinuteReset >= 60000) {
        this.rateLimitStats.requestsThisMinute = 0;
        this.rateLimitStats.lastMinuteReset = now;
      }
      
      // Check rate limits
      if (this.rateLimitStats.requestsThisSecond >= 10) {
        throw new Error('Fyers rate limit exceeded: 10 requests per second');
      }
      
      if (this.rateLimitStats.requestsThisMinute >= 200) {
        throw new Error('Fyers rate limit exceeded: 200 requests per minute');
      }
      
      // Increment counters
      this.rateLimitStats.requestsThisSecond++;
      this.rateLimitStats.requestsThisMinute++;
      
      // Get access token from user's Fyers connection ONLY
      let accessToken = null;
      if (user && user.fyers && user.fyers.accessToken && user.fyers.connected) {
        const { getFyersAppId } = require('../fyersService');
        const appId = getFyersAppId();
        accessToken = `${appId}:${user.fyers.accessToken}`;
      } else {
        throw new Error('Fyers access token missing or expired. Please relogin to Fyers.');
      }
      
      // Convert symbols to Fyers format if they're not already
      const { SymbolService } = require('./symbolService');
      const fyersSymbols = [];
      
      for (const symbol of symbols) {
        try {
          // Check if symbol is already in Fyers format (contains ':')
          if (symbol.includes(':')) {
            fyersSymbols.push(symbol);
          } else {
            // Convert to Fyers format - we need a spot price for expiry calculation
            // For now, use a default spot price based on the index
            let spotPrice = 25000; // Default for NIFTY
            if (symbol.includes('BANKNIFTY')) {
              spotPrice = 48000;
            } else if (symbol.includes('SENSEX')) {
              spotPrice = 72000;
            }
            
            const fyersSymbol = SymbolService.convertToFyersSymbol(symbol, spotPrice);
            fyersSymbols.push(fyersSymbol);
          }
        } catch (conversionError) {
          console.error(`[MarketService] Failed to convert symbol ${symbol} to Fyers format:`, conversionError);
          // Skip this symbol if conversion fails
          continue;
        }
      }
      
      if (fyersSymbols.length === 0) {
        throw new Error('No valid symbols to fetch after conversion');
      }

      // Fetch real market data from Fyers
      const response = await getMarketDepth(accessToken, fyersSymbols);
      
      if (response && response.s === 'ok' && response.d) {
        // Transform Fyers response to our format
        // response.d is an object with symbol keys, not an array
        const marketData = [];
        
        for (const [symbol, data] of Object.entries(response.d)) {
          marketData.push({
            symbol: symbol,
            ltp: parseFloat(data.ltp) || 0,
            change: parseFloat(data.ch) || 0,
            changePercent: parseFloat(data.chp) || 0,
            volume: parseInt(data.v) || 0,
            open: parseFloat(data.o) || 0,
            high: parseFloat(data.h) || 0,
            low: parseFloat(data.l) || 0,
            close: parseFloat(data.c) || 0,
            timestamp: Date.now()
          });
        }
        
        return marketData;
      } else {
        console.error('[MarketService] Fyers API error or unexpected response:', response);
        // If Fyers response is invalid, throw error instead of returning mock data
        throw new Error('Invalid response from Fyers API. Please check your connection.');
      }
    } catch (error) {
      console.error('[MarketService] Error fetching quotes from Fyers:', error);
      // Re-throw the error instead of returning mock data
      throw error;
    }
  }

  /**
   * Subscribe to symbols
   * @param {Array<string>} symbols - Symbols to subscribe to
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} Success
   */
  static async subscribeToSymbols(symbols, userId) {
    try {
      // Update or create subscription in database
      await MarketSubscription.findOneAndUpdate(
        { userId },
        { 
          userId,
          $addToSet: { symbols: { $each: symbols } },
          lastUpdated: new Date()
        },
        { upsert: true }
      );
      
      // TODO: Subscribe to Fyers WebSocket
      
      return true;
    } catch (error) {
      console.error('[MarketService] Error subscribing to symbols:', error);
      return false;
    }
  }

  /**
   * Unsubscribe from symbols
   * @param {Array<string>} symbols - Symbols to unsubscribe from
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} Success
   */
  static async unsubscribeFromSymbols(symbols, userId) {
    try {
      // Update subscription in database
      await MarketSubscription.findOneAndUpdate(
        { userId },
        { 
          $pull: { symbols: { $in: symbols } },
          lastUpdated: new Date()
        }
      );
      
      // TODO: Unsubscribe from Fyers WebSocket
      
      return true;
    } catch (error) {
      console.error('[MarketService] Error unsubscribing from symbols:', error);
      return false;
    }
  }

  /**
   * Unsubscribe from all symbols
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} Success
   */
  static async unsubscribeFromAllSymbols(userId) {
    try {
      // Update subscription in database
      await MarketSubscription.findOneAndUpdate(
        { userId },
        { 
          symbols: [],
          lastUpdated: new Date()
        }
      );
      
      // TODO: Unsubscribe from Fyers WebSocket
      
      return true;
    } catch (error) {
      console.error('[MarketService] Error unsubscribing from all symbols:', error);
      return false;
    }
  }

  /**
   * Get user's subscribed symbols
   * @param {string} userId - User ID
   * @returns {Promise<Array<string>>} Subscribed symbols
   */
  static async getSubscribedSymbols(userId) {
    try {
      const subscription = await MarketSubscription.findOne({ userId });
      return subscription ? subscription.symbols : [];
    } catch (error) {
      console.error('[MarketService] Error getting subscribed symbols:', error);
      return [];
    }
  }

  /**
   * Send market data to clients
   * @param {Array<Object>} marketData - Array of market data objects
   */
  static async sendBulkMarketDataToClients(marketData) {
    try {
      // Get WebSocket service
      const { WebSocketService } = require('./websocketService');
      const wsService = WebSocketService.getInstance();
      
      if (wsService && marketData.length > 0) {
        // Only log every 30 seconds to reduce verbosity
        const now = Date.now();
        if (!this.lastSendLog || (now - this.lastSendLog) > 30000) {
          console.log(`[MarketService] Sending ${marketData.length} market data items to WebSocket clients`);
          this.lastSendLog = now;
        }
        
        // Send all data to all connected clients (including unauthenticated for testing)
        wsService.broadcastMarketData(marketData);
        
        // Only log completion every 30 seconds to reduce verbosity
        if (!this.lastCompleteLog || (now - this.lastCompleteLog) > 30000) {
          console.log(`[MarketService] Market data broadcast completed`);
          this.lastCompleteLog = now;
        }
      } else {
        // Only log this once per minute to reduce spam
        const now = Date.now();
        if (!this.lastNoDataLog || (now - this.lastNoDataLog) > 60000) {
          console.log(`[MarketService] No WebSocket service or no market data to send`);
          this.lastNoDataLog = now;
        }
      }
    } catch (error) {
      console.error('[MarketService] Error sending bulk market data to clients:', error);
    }
  }

  /**
   * Send market data to clients
   * @param {string} symbol - Symbol
   * @param {Object} data - Market data
   */
  static async sendMarketDataToClients(symbol, data) {
    try {
      // Get WebSocket service
      const { WebSocketService } = require('./websocketService');
      const wsService = WebSocketService.getInstance();
      
      if (wsService) {
        // Send data to subscribed clients
        wsService.sendMarketData(symbol, data);
      }
    } catch (error) {
      console.error('[MarketService] Error sending market data to clients:', error);
    }
  }

  /**
   * Generate current commodity symbols with correct expiry
   * @returns {Array<string>} Array of commodity symbols
   */
  static generateCurrentCommoditySymbols() {
    const { SymbolService } = require('./symbolService');
    const commodities = ['CRUDEOIL', 'GOLD', 'COPPER', 'SILVER', 'NICKEL'];
    const symbols = [];
    
    commodities.forEach(commodity => {
      try {
        // Generate only the currently active contract symbol
        const currentSymbol = SymbolService.convertRawUnderlyingToFyersSymbol(commodity, 0);
        symbols.push(currentSymbol);
        
        // Only log symbol generation once per hour to reduce verbosity
        const now = Date.now();
        if (!this.lastSymbolGenLog || (now - this.lastSymbolGenLog) > 3600000) {
          console.log(`[MarketService] Generated commodity symbol for ${commodity}: ${currentSymbol}`);
          this.lastSymbolGenLog = now;
        }
      } catch (error) {
        console.error(`[MarketService] Error generating symbol for ${commodity}:`, error);
      }
    });
    
    // Only log all symbols once per hour to reduce verbosity
    const now = Date.now();
    if (!this.lastAllSymbolsLog || (now - this.lastAllSymbolsLog) > 3600000) {
      console.log(`[MarketService] All generated commodity symbols:`, symbols);
      this.lastAllSymbolsLog = now;
    }
    
    return symbols;
  }

  /**
   * Get all current market symbols from MongoDB symbol configuration
   * @returns {Promise<Array<string>>} Array of all symbols
   */
  static async getAllMarketSymbols() {
    try {
      // Check cache first
      const now = Date.now();
      if (this.symbolConfigCache.symbols.length > 0 && 
          (now - this.symbolConfigCache.lastUpdated) < this.symbolConfigCache.cacheTTL) {
        // Only log cache hits every 5 minutes to reduce verbosity
        if (!this.lastCacheLog || (now - this.lastCacheLog) > 300000) {
          console.log(`[MarketService] Using ${this.symbolConfigCache.symbols.length} symbols from cache`);
          this.lastCacheLog = now;
        }
        return this.symbolConfigCache.symbols;
      }

      // Fetch from MongoDB if cache is expired or empty
      const symbolConfigs = await SymbolConfig.find({});
      if (symbolConfigs.length > 0) {
        const symbols = symbolConfigs.map(config => config.symbolInput);
        
              // Update cache
      this.symbolConfigCache.symbols = symbols;
      this.symbolConfigCache.lastUpdated = now;
      
      // Only log cache updates every 5 minutes to reduce verbosity
      if (!this.lastCacheUpdateLog || (now - this.lastCacheUpdateLog) > 300000) {
        console.log(`[MarketService] Fetched ${symbols.length} symbols from MongoDB and updated cache`);
        this.lastCacheUpdateLog = now;
      }
      return symbols;
      }
    } catch (error) {
      console.error('[MarketService] Error getting symbols from MongoDB config:', error);
    }
    
    // Fallback: return cached symbols if available, otherwise empty array
    if (this.symbolConfigCache.symbols.length > 0) {
      // Only log fallback cache usage once per minute to reduce spam
      const now = Date.now();
      if (!this.lastFallbackLog || (now - this.lastFallbackLog) > 60000) {
        console.log(`[MarketService] Using ${this.symbolConfigCache.symbols.length} symbols from fallback cache`);
        this.lastFallbackLog = now;
      }
      return this.symbolConfigCache.symbols;
    }
    
    // Only log no symbols available once per minute to reduce spam
    const now = Date.now();
    if (!this.lastNoSymbolsLog || (now - this.lastNoSymbolsLog) > 60000) {
      console.log('[MarketService] No symbols available in cache or database');
      this.lastNoSymbolsLog = now;
    }
    return [];
  }

  /**
   * Clear symbol configuration cache
   */
  static clearSymbolConfigCache() {
    this.symbolConfigCache.symbols = [];
    this.symbolConfigCache.lastUpdated = 0;
    console.log('[MarketService] Symbol configuration cache cleared');
  }

  /**
   * Clear monitored symbols cache
   */
  static clearMonitoredSymbolsCache() {
    this.monitoredSymbolsCache.symbols.clear();
    this.monitoredSymbolsCache.lastUpdated = 0;
    console.log('[MarketService] Monitored symbols cache cleared');
  }

  /**
   * Clear all caches
   */
  static clearAllCaches() {
    this.clearSymbolConfigCache();
    this.clearMonitoredSymbolsCache();
    console.log('[MarketService] All caches cleared');
  }

  /**
   * Get cache status for debugging
   */
  static getCacheStatus() {
    const now = Date.now();
    const cacheAge = now - this.symbolConfigCache.lastUpdated;
    const isExpired = cacheAge > this.symbolConfigCache.cacheTTL;
    
    return {
      symbolsCount: this.symbolConfigCache.symbols.length,
      lastUpdated: this.symbolConfigCache.lastUpdated,
      cacheAge: cacheAge,
      isExpired: isExpired,
      cacheTTL: this.symbolConfigCache.cacheTTL
    };
  }

  /**
   * Get rate limit statistics
   */
  static getRateLimitStats() {
    return {
      ...this.rateLimitStats,
      requestsPerSecond: this.rateLimitStats.requestsThisSecond,
      requestsPerMinute: this.rateLimitStats.requestsThisMinute,
      secondLimit: 10,
      minuteLimit: 200,
      secondUsage: `${this.rateLimitStats.requestsThisSecond}/10`,
      minuteUsage: `${this.rateLimitStats.requestsThisMinute}/200`
    };
  }

  /**
   * Start market data polling with combined request for all symbols
   */
  static startMarketDataPolling() {
    // Don't start if already running
    if (this.pollingTimers.combined) {
      console.log('[MarketService] Market polling already running, skipping start');
      return;
    }
    
    // Stop any existing polling
    this.stopMarketDataPolling();
    
    // Start combined market data polling (every 1 second) - fetch ALL symbols in ONE request
    this.pollingTimers.combined = setInterval(async () => {
      try {
        // Get all market symbols (indices, stocks, commodities)
        const allSymbols = await this.getAllMarketSymbols();
        
        // Get all monitored symbols
        const allMonitoredSymbols = await this.getAllMonitoredSymbols();
        
        // Combine all symbols into a single array (remove duplicates)
        const combinedSymbols = new Set([...allSymbols, ...allMonitoredSymbols]);
        const symbolsArray = Array.from(combinedSymbols);
        
        // If no symbols, skip
        if (symbolsArray.length === 0) {
          return;
        }
        
        // Get a user with valid Fyers token for background polling
        const User = require('../models/User');
        const userWithFyers = await User.findOne({
          'fyers.connected': true,
          'fyers.accessToken': { $exists: true, $ne: null }
        });
        
        if (!userWithFyers) {
          // Only log this once per minute to reduce spam
          const now = Date.now();
          if (!this.lastNoTokenLog || (now - this.lastNoTokenLog) > 60000) {
            console.log('📊 Market: No Fyers token available for polling');
            this.lastNoTokenLog = now;
          }
          return;
        }
        
        // Fetch ALL quotes in a SINGLE request to Fyers
        const quotes = await this.fetchQuotesFromFyers(symbolsArray, userWithFyers);
        
        // Send all data to clients at once
        await this.sendBulkMarketDataToClients(quotes);
        
        // Only log every 30 seconds to reduce verbosity
        const now = Date.now();
        if (!this.lastMarketLog || (now - this.lastMarketLog) > 30000) {
          console.log(`📊 Market: ${quotes.length} symbols updated (${allSymbols.length} market + ${allMonitoredSymbols.size} monitored)`);
          this.lastMarketLog = now;
        }
      } catch (error) {
        // Handle rate limit errors gracefully
        if (error.message && error.message.includes('request limit reached')) {
          const now = Date.now();
          if (!this.lastRateLimitLog || (now - this.lastRateLimitLog) > 60000) {
            console.error('❌ Market polling: Fyers rate limit reached - pausing for 30 seconds');
            this.lastRateLimitLog = now;
          }
          
          // Pause polling for 30 seconds when rate limit is hit
          this.stopMarketDataPolling();
          setTimeout(() => {
            console.log('🔄 Resuming market polling after rate limit cooldown');
            this.startMarketDataPolling();
          }, 30000);
        } else {
          console.error('❌ Market polling error:', error.message);
        }
      }
    }, this.POLLING_INTERVALS.combined);
    
    console.log(`✅ Market polling started - Combined request: 1s (${this.POLLING_INTERVALS.combined}ms)`);
  }

  /**
   * Stop market data polling
   */
  static stopMarketDataPolling() {
    if (this.pollingTimers.combined) {
      clearInterval(this.pollingTimers.combined);
      this.pollingTimers.combined = null;
    }
    
    console.log('[MarketService] Market data polling stopped');
  }

  /**
   * Get current polling status
   * @returns {Object} Polling status
   */
  static getPollingStatus() {
    return {
      combined: {
        active: this.pollingTimers.combined !== null,
        interval: this.POLLING_INTERVALS.combined,
        description: 'All symbols (market + monitored) in single request - optimized for Fyers rate limits'
      }
    };
  }

  /**
   * Get all monitored symbols from all users with caching
   * @returns {Promise<Set<string>>} Set of monitored symbols
   */
  static async getAllMonitoredSymbols() {
    try {
      // Check cache first
      const now = Date.now();
      if (this.monitoredSymbolsCache.symbols.size > 0 && 
          (now - this.monitoredSymbolsCache.lastUpdated) < this.monitoredSymbolsCache.cacheTTL) {
        // Only log cache hits every 5 minutes to reduce verbosity
        if (!this.lastMonitoredCacheLog || (now - this.lastMonitoredCacheLog) > 300000) {
          console.log(`[MarketService] Using ${this.monitoredSymbolsCache.symbols.size} monitored symbols from cache`);
          this.lastMonitoredCacheLog = now;
        }
        return this.monitoredSymbolsCache.symbols;
      }

      // Fetch from MongoDB if cache is expired or empty
      const allTradingStates = await TradingState.find({});
      
      const allMonitoredSymbols = new Set();
      
      allTradingStates.forEach(state => {
        if (state.monitoredSymbols && state.monitoredSymbols.length > 0) {
          state.monitoredSymbols.forEach(symbol => {
            if (symbol.symbol) {
              allMonitoredSymbols.add(symbol.symbol);
            }
          });
        }
      });
      
      // Update cache
      this.monitoredSymbolsCache.symbols = allMonitoredSymbols;
      this.monitoredSymbolsCache.lastUpdated = now;
      
      // Only log cache updates every 5 minutes to reduce verbosity
      if (!this.lastMonitoredCacheUpdateLog || (now - this.lastMonitoredCacheUpdateLog) > 300000) {
        console.log(`[MarketService] Fetched ${allMonitoredSymbols.size} monitored symbols from MongoDB and updated cache`);
        this.lastMonitoredCacheUpdateLog = now;
      }
      return allMonitoredSymbols;
    } catch (error) {
      console.error('[MarketService] Error getting monitored symbols:', error);
      return new Set();
    }
  }
}

module.exports = { MarketService, getAllMarketSymbols: MarketService.getAllMarketSymbols };
