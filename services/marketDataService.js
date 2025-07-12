/**
 * Market Data Service for backend
 * Migrated from frontend to handle market data fetching without browser tab dependency
 */
const axios = require('axios');
const mongoose = require('mongoose');
const { HMAService } = require('./hmaService');
const LoggerService = require('./loggerService');

// Define a schema for caching market data
const MarketDataSchema = new mongoose.Schema({
  symbol: {
    type: String,
    required: true,
    index: true
  },
  timeframe: {
    type: String,
    required: true
  },
  data: {
    type: Array,
    required: true
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  },
  expiresAt: {
    type: Date,
    index: { expires: '1d' } // Auto-expire after 1 day
  }
});

// Create a model if it doesn't exist
let MarketData;
try {
  MarketData = mongoose.model('MarketData');
} catch (error) {
  MarketData = mongoose.model('MarketData', MarketDataSchema);
}

class MarketDataService {
  /**
   * Fetch historical market data
   * @param {string} symbol - Symbol to fetch data for
   * @param {string} timeframe - Timeframe (1m, 5m, 15m, 30m, 1h, 1d)
   * @param {number} limit - Number of candles to fetch
   * @param {boolean} useCache - Whether to use cached data
   * @param {string} accessToken - Fyers access token
   * @returns {Promise<Array>} - Array of candle data
   */
  static async fetchHistoricalData(symbol, timeframe = '1d', limit = 100, useCache = true, accessToken = null) {
    try {
      // Check cache first if enabled
      if (useCache) {
        const cachedData = await this.getCachedData(symbol, timeframe);
        if (cachedData && cachedData.data && cachedData.data.length >= limit) {
          LoggerService.cacheOperation('hit', `${symbol} ${timeframe}`);
          return cachedData.data.slice(-limit);
        }
      }
      
      // Convert timeframe to Fyers format
      const fyersTimeframe = this.convertTimeframeToFyers(timeframe);
      
      // Calculate date range (up to 366 days for daily data as per Fyers limits)
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - Math.min(limit, 366)); // Fyers limit is 366 days
      
      // Format dates as YYYY-MM-DD
      const rangeFrom = startDate.toISOString().split('T')[0];
      const rangeTo = endDate.toISOString().split('T')[0];
      
      console.log(`[MarketDataService] Fetching data for ${symbol}: ${rangeFrom} to ${rangeTo}`);
      
      // Use the correct Fyers API v3 format
      const requestData = {
        symbol: symbol,
        resolution: fyersTimeframe,
        date_format: "1", // Use YYYY-MM-DD format
        range_from: rangeFrom,
        range_to: rangeTo,
        cont_flag: "1"
      };
      
      // Make request to Fyers API v3
      const response = await axios.get(`https://api-t1.fyers.in/api/v3/data/history`, {
        params: requestData,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'axios/1.10.0'
        },
        timeout: 300000 // 5 minute timeout (10x increase for bulk data collection)
      });
      
      console.log(`[MarketDataService] Fyers API response status:`, response.status);
      console.log(`[MarketDataService] Fyers API response data:`, response.data);
      
      if (response.data.s !== 'ok' || !response.data.candles) {
        throw new Error(`Fyers API error: ${response.data.message || JSON.stringify(response.data)}`);
      }
      
      // Transform data to our format
      const candles = response.data.candles.map(candle => ({
        timestamp: candle[0] * 1000, // Convert epoch to milliseconds
        open: candle[1],
        high: candle[2],
        low: candle[3],
        close: candle[4],
        volume: candle[5]
      }));
      
      console.log(`[MarketDataService] Transformed ${candles.length} candles for ${symbol}`);
      
      // Cache the data
      await this.cacheData(symbol, timeframe, candles);
      
      return candles;
    } catch (error) {
      LoggerService.error('MarketDataService', `Error fetching historical data for ${symbol} ${timeframe}:`, error);
      
      // Try to return cached data even if it's expired or less than requested limit
      const cachedData = await this.getCachedData(symbol, timeframe, true);
      if (cachedData && cachedData.data && cachedData.data.length > 0) {
        LoggerService.info('MarketDataService', `Returning expired cached data for ${symbol} ${timeframe}`);
        return cachedData.data;
      }
      
      throw error;
    }
  }
  
  /**
   * Get cached market data
   * @param {string} symbol - Symbol
   * @param {string} timeframe - Timeframe
   * @param {boolean} ignoreExpiry - Whether to ignore expiry
   * @returns {Promise<Object|null>} - Cached data or null
   */
  static async getCachedData(symbol, timeframe, ignoreExpiry = false) {
    try {
      const query = {
        symbol,
        timeframe
      };
      
      if (!ignoreExpiry) {
        query.expiresAt = { $gt: new Date() };
      }
      
      const cachedData = await MarketData.findOne(query).exec();
      return cachedData;
    } catch (error) {
      LoggerService.error('MarketDataService', 'Error getting cached data:', error);
      return null;
    }
  }
  
  /**
   * Cache market data
   * @param {string} symbol - Symbol
   * @param {string} timeframe - Timeframe
   * @param {Array} data - Market data
   * @returns {Promise<boolean>} - Success
   */
  static async cacheData(symbol, timeframe, data) {
    try {
      // Set expiry based on timeframe
      const expiryHours = this.getCacheExpiryHours(timeframe);
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + expiryHours);
      
      await MarketData.findOneAndUpdate(
        { symbol, timeframe },
        {
          symbol,
          timeframe,
          data,
          lastUpdated: new Date(),
          expiresAt
        },
        { upsert: true, new: true }
      );
      
      LoggerService.cacheOperation('set', `${symbol} ${timeframe}`);
      return true;
    } catch (error) {
      LoggerService.error('MarketDataService', 'Error caching data:', error);
      return false;
    }
  }
  
  /**
   * Get cache expiry hours based on timeframe
   * @param {string} timeframe - Timeframe
   * @returns {number} - Hours
   */
  static getCacheExpiryHours(timeframe) {
    switch (timeframe) {
      case '1m':
        return 1;
      case '5m':
        return 2;
      case '15m':
        return 4;
      case '30m':
        return 6;
      case '1h':
        return 12;
      case '1d':
        return 24;
      default:
        return 6;
    }
  }
  
  /**
   * Convert our timeframe format to Fyers format
   * @param {string} timeframe - Our timeframe format
   * @returns {string} - Fyers timeframe format
   */
  static convertTimeframeToFyers(timeframe) {
    switch (timeframe) {
      case '1m':
        return '1';
      case '5m':
        return '5';
      case '15m':
        return '15';
      case '30m':
        return '30';
      case '1h':
        return '60';
      case '1d':
        return 'D';
      default:
        return 'D';
    }
  }
  
  /**
   * Get start date for historical data based on timeframe and limit
   * @param {string} timeframe - Timeframe
   * @param {number} limit - Number of candles
   * @returns {string} - ISO date string
   */
  static getStartDate(timeframe, limit) {
    const date = new Date();
    
    switch (timeframe) {
      case '1m':
        date.setMinutes(date.getMinutes() - limit);
        break;
      case '5m':
        date.setMinutes(date.getMinutes() - limit * 5);
        break;
      case '15m':
        date.setMinutes(date.getMinutes() - limit * 15);
        break;
      case '30m':
        date.setMinutes(date.getMinutes() - limit * 30);
        break;
      case '1h':
        date.setHours(date.getHours() - limit);
        break;
      case '1d':
        date.setDate(date.getDate() - limit);
        break;
      default:
        date.setDate(date.getDate() - limit);
    }
    
    return date.toISOString().split('T')[0];
  }
  
  /**
   * Fetch data with indicators
   * @param {string} symbol - Symbol
   * @param {string} timeframe - Timeframe
   * @param {Array} indicators - Array of indicators to calculate
   * @returns {Promise<Object>} - Data with indicators
   */
  static async fetchDataWithIndicators(symbol, timeframe = '1d', indicators = []) {
    try {
      const candles = await this.fetchHistoricalData(symbol, timeframe);
      
      if (!candles || candles.length === 0) {
        throw new Error(`No data available for ${symbol}`);
      }
      
      const result = {
        symbol,
        timeframe,
        candles,
        indicators: {}
      };
      
      // Calculate indicators
      for (const indicator of indicators) {
        switch (indicator.type) {
          case 'hma':
            const hmaValues = HMAService.calculateHMA(candles, indicator.period, 'close');
            result.indicators[`hma${indicator.period}`] = hmaValues;
            break;
          case 'hma_signals':
            const hmaSignals = HMAService.calculateHMASignals(candles, {
              fastPeriod: indicator.fastPeriod || 9,
              slowPeriod: indicator.slowPeriod || 21
            });
            result.indicators.hmaSignals = hmaSignals;
            break;
          // Add more indicator types as needed
        }
      }
      
      return result;
    } catch (error) {
      LoggerService.error('MarketDataService', `Error fetching data with indicators for ${symbol} ${timeframe}:`, error);
      throw error;
    }
  }
  
  /**
   * Clear cache for a symbol
   * @param {string} symbol - Symbol to clear cache for
   * @returns {Promise<boolean>} - Success
   */
  static async clearCache(symbol) {
    try {
      await MarketData.deleteMany({ symbol });
      LoggerService.cacheOperation('clear', symbol);
      return true;
    } catch (error) {
      LoggerService.error('MarketDataService', `Error clearing cache for ${symbol}:`, error);
      return false;
    }
  }
  
  /**
   * Get live market data for multiple symbols
   * @param {Array<string>} symbols - Array of symbols
   * @returns {Promise<Array>} - Array of market data
   */
  static async getMultipleLiveMarketData(symbols) {
    try {
      if (!symbols || symbols.length === 0) {
        return [];
      }

      // This method should not be used for live data - use MarketService instead
      LoggerService.warn('MarketDataService', 'getMultipleLiveMarketData called - use MarketService for live data');
      throw new Error('Live market data should be fetched through MarketService, not MarketDataService');
    } catch (error) {
      LoggerService.error('MarketDataService', 'Error getting live market data:', error);
      throw error;
    }
  }

  /**
   * Clear all cached data
   * @returns {Promise<boolean>} - Success
   */
  static async clearAllCache() {
    try {
      await MarketData.deleteMany({});
      LoggerService.cacheOperation('clear', 'all');
      return true;
    } catch (error) {
      LoggerService.error('MarketDataService', 'Error clearing all cache:', error);
      return false;
    }
  }
}

module.exports = { MarketDataService };
