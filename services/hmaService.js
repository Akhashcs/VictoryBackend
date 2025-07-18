/**
 * Hull Moving Average Service for backend
 * Migrated from frontend to handle HMA calculations without browser tab dependency
 */
const axios = require('axios');
const LoggerService = require('./loggerService');

class HMAService {
  /**
   * Calculate the latest HMA value using standard Pine Script formula
   * @param {Array} data - Array of price data (objects with close property or numbers)
   * @param {number} period - Period for HMA calculation
   * @param {string} [priceKey='close'] - Key to use for price data
   * @returns {number} - Latest HMA value
   */
  static calculateLatestHMA(data, period, priceKey = 'close') {
    if (!data || data.length === 0 || !period || period <= 0) {
      console.error('[HMAService] Invalid input for HMA calculation');
      return null;
    }

    try {
      // Extract price data - only need the latest 'period' closes
      const prices = data.slice(-period).map(candle => {
        if (typeof candle === 'number') {
          return candle;
        } else if (typeof candle === 'object' && candle !== null) {
          return candle[priceKey] || 0;
        }
        return 0;
      });

      if (prices.length < period) {
        console.error(`[HMAService] Insufficient data for HMA-${period}. Need ${period} points, got ${prices.length}`);
        return null;
      }

      // Calculate WMA with period/2
      const halfPeriod = Math.floor(period / 2);
      const wma1 = this.calculateWMA(prices, halfPeriod);

      // Calculate WMA with period
      const wma2 = this.calculateWMA(prices, period);

      console.log(`[HMA DEBUG] Input length: ${prices.length}, Period: ${period}, HalfPeriod: ${halfPeriod}, SqrtPeriod: ${Math.floor(Math.sqrt(period))}`);
      console.log(`[HMA DEBUG] WMA1 length: ${wma1.length}, Wma2 length: ${wma2.length}`);

      // Calculate raw HMA: 2 * WMA(n/2) - WMA(n)
      // We need to align the WMAs properly - both should have the same number of points
      const rawHMA = [];
      
      // For HMA calculation, we need to align the WMAs
      // WMA1 has more points than WMA2, so we need to use the last points from WMA1
      const wma1Start = wma1.length - wma2.length;
      
      for (let i = 0; i < wma2.length; i++) {
        const wma1Value = wma1[wma1Start + i];
        const wma2Value = wma2[i];
        rawHMA.push(2 * wma1Value - wma2Value);
      }

      console.log(`[HMA DEBUG] Raw HMA length: ${rawHMA.length}`);

      // Calculate final HMA using sqrt(period) WMA
      const sqrtPeriod = Math.floor(Math.sqrt(period));
      
      // If we don't have enough raw HMA values for the final WMA, return the last raw HMA value
      if (rawHMA.length < sqrtPeriod) {
        console.log(`[HMA DEBUG] Not enough raw HMA values for final WMA. Using last raw HMA value.`);
        const latestHMA = rawHMA[rawHMA.length - 1];
        console.log(`[HMA DEBUG] Latest HMA value (from raw): ${latestHMA}`);
        return latestHMA;
      }
      
      const hma = this.calculateWMA(rawHMA, sqrtPeriod);

      console.log(`[HMA DEBUG] Final HMA length: ${hma.length}`);

      // Return the latest HMA value (last element)
      const latestHMA = hma[hma.length - 1];
      console.log(`[HMA DEBUG] Latest HMA value: ${latestHMA}`);
      
      return latestHMA;
    } catch (error) {
      console.error('[HMAService] Error calculating latest HMA:', error);
      return null;
    }
  }

  /**
   * Calculate Hull Moving Average (HMA) - Full array version
   * @param {Array} data - Array of price data
   * @param {number} period - Period for HMA calculation
   * @param {string} [priceKey='close'] - Key to use for price data
   * @returns {Array} - Array of HMA values
   */
  static calculateHMA(data, period, priceKey = 'close') {
    if (!data || data.length === 0 || !period || period <= 0) {
      console.error('[HMAService] Invalid input for HMA calculation');
      return [];
    }

    try {
      // Extract price data
      const prices = data.map(candle => {
        if (typeof candle === 'number') {
          return candle;
        } else if (typeof candle === 'object' && candle !== null) {
          return candle[priceKey] || 0;
        }
        return 0;
      });

      // Calculate WMA with period/2
      const halfPeriod = Math.floor(period / 2);
      const wma1 = this.calculateWMA(prices, halfPeriod);

      // Calculate WMA with period
      const wma2 = this.calculateWMA(prices, period);

      // Calculate raw HMA: 2 * WMA(n/2) - WMA(n)
      // We need to align the WMAs properly - both should have the same number of points
      const rawHMA = [];
      
      // For HMA calculation, we need to align the WMAs
      // WMA1 has more points than WMA2, so we need to use the last points from WMA1
      const wma1Start = wma1.length - wma2.length;
      
      for (let i = 0; i < wma2.length; i++) {
        const wma1Value = wma1[wma1Start + i];
        const wma2Value = wma2[i];
        rawHMA.push(2 * wma1Value - wma2Value);
      }

      // Calculate final HMA using sqrt(period) WMA
      const sqrtPeriod = Math.floor(Math.sqrt(period));
      const hma = this.calculateWMA(rawHMA, sqrtPeriod);

      // Create result array with proper alignment
      const result = new Array(data.length).fill(null);
      
      // Fill the last hma.length positions with HMA values
      const startIndex = data.length - hma.length;
      for (let i = 0; i < hma.length; i++) {
        result[startIndex + i] = hma[i];
      }

      return result;
    } catch (error) {
      console.error('[HMAService] Error calculating HMA:', error);
      return [];
    }
  }

  /**
   * Calculate Weighted Moving Average (WMA) - Pine Script compatible
   * @param {Array} prices - Array of price data
   * @param {number} period - Period for WMA calculation
   * @returns {Array} - Array of WMA values
   */
  static calculateWMA(prices, period) {
    if (!prices || prices.length === 0 || !period || period <= 0) {
      return [];
    }

    const result = [];
    const weightSum = (period * (period + 1)) / 2;

    for (let i = period - 1; i < prices.length; i++) {
      let wma = 0;
      for (let j = 0; j < period; j++) {
        // Weight = (period - j) - Pine Script WMA uses decreasing weights
        // Most recent price gets highest weight (period), oldest gets weight 1
        wma += (prices[i - j] * (period - j));
      }
      result.push(wma / weightSum);
    }

    return result;
  }

  /**
   * Calculate HMA with prefill functionality for backtesting
   * @param {Array} data - Array of price data
   * @param {number} period - Period for HMA calculation
   * @param {string} [priceKey='close'] - Key to use for price data
   * @param {number} [prefillPeriods=0] - Number of periods to prefill before start
   * @returns {Array} - Array of HMA values
   */
  static calculateHMAWithPrefill(data, period, priceKey = 'close', prefillPeriods = 0) {
    if (!data || data.length === 0 || !period || period <= 0) {
      console.error('[HMAService] Invalid input for HMA calculation');
      return [];
    }

    try {
      // Extract price data
      const prices = data.map(candle => {
        if (typeof candle === 'number') {
          return candle;
        } else if (typeof candle === 'object' && candle !== null) {
          return candle[priceKey] || 0;
        }
        return 0;
      });

      // Calculate required prefill periods
      const requiredPrefill = Math.max(prefillPeriods, period);
      
      // If we need prefill, we need to fetch additional data
      if (requiredPrefill > 0 && data.length < requiredPrefill) {
        console.warn(`[HMAService] Insufficient data for HMA-${period} with prefill. Need at least ${requiredPrefill} periods, got ${data.length}`);
        return new Array(data.length).fill(null);
      }

      // Calculate WMA with period/2
      const halfPeriod = Math.floor(period / 2);
      const wma1 = this.calculateWMA(prices, halfPeriod);

      // Calculate WMA with period
      const wma2 = this.calculateWMA(prices, period);

      // Calculate raw HMA: 2 * WMA(n/2) - WMA(n)
      const rawHMA = [];
      
      // Align WMAs properly - WMA1 has more points than WMA2
      const wma1Start = wma1.length - wma2.length;
      
      for (let i = 0; i < wma2.length; i++) {
        const wma1Value = wma1[wma1Start + i];
        const wma2Value = wma2[i];
        rawHMA.push(2 * wma1Value - wma2Value);
      }

      // Calculate final HMA using sqrt(period) WMA
      const sqrtPeriod = Math.floor(Math.sqrt(period));
      const hma = this.calculateWMA(rawHMA, sqrtPeriod);

      // Create result array with proper alignment
      const result = new Array(data.length).fill(null);
      
      // Fill the last hma.length positions with HMA values
      const startIndex = data.length - hma.length;
      for (let i = 0; i < hma.length; i++) {
        result[startIndex + i] = hma[i];
      }

      return result;
    } catch (error) {
      console.error('[HMAService] Error calculating HMA with prefill:', error);
      return [];
    }
  }

  /**
   * Calculate HMA crossovers
   * @param {Array} hma - Array of HMA values
   * @returns {Array} - Array of crossover signals
   */
  static calculateCrossovers(hma) {
    if (!hma || hma.length < 2) {
      return [];
    }

    const signals = [];
    let lastValidIndex = 0;

    // Find first valid HMA value
    while (lastValidIndex < hma.length && hma[lastValidIndex] === null) {
      lastValidIndex++;
    }

    if (lastValidIndex >= hma.length - 1) {
      return signals; // Not enough valid data
    }

    let prevSlope = 0;
    for (let i = lastValidIndex + 1; i < hma.length; i++) {
      if (hma[i] === null) continue;
      
      const currentSlope = hma[i] - hma[i - 1];
      
      // Detect slope change
      if (prevSlope <= 0 && currentSlope > 0) {
        signals.push({
          index: i,
          type: 'buy',
          value: hma[i]
        });
      } else if (prevSlope >= 0 && currentSlope < 0) {
        signals.push({
          index: i,
          type: 'sell',
          value: hma[i]
        });
      }
      
      prevSlope = currentSlope;
    }

    return signals;
  }

  /**
   * Calculate multiple HMAs with different periods
   * @param {Array} data - Array of price data
   * @param {Array} periods - Array of periods for HMA calculation
   * @param {string} [priceKey='close'] - Key to use for price data
   * @returns {Object} - Object with HMA values for each period
   */
  static calculateMultipleHMAs(data, periods, priceKey = 'close') {
    if (!data || data.length === 0 || !periods || periods.length === 0) {
      return {};
    }

    const result = {};
    
    for (const period of periods) {
      result[`hma${period}`] = this.calculateHMA(data, period, priceKey);
    }
    
    return result;
  }

  /**
   * Calculate HMA-based signals for trading
   * @param {Array} data - Array of price data
   * @param {Object} options - Options for signal calculation
   * @param {number} options.fastPeriod - Fast HMA period
   * @param {number} options.slowPeriod - Slow HMA period
   * @param {string} [options.priceKey='close'] - Key to use for price data
   * @returns {Object} - Object with HMA values and signals
   */
  static calculateHMASignals(data, options = {}) {
    const { fastPeriod = 9, slowPeriod = 21, priceKey = 'close' } = options;
    
    if (!data || data.length === 0) {
      return {
        fastHMA: [],
        slowHMA: [],
        signals: []
      };
    }

    try {
      // Calculate fast and slow HMAs
      const fastHMA = this.calculateHMA(data, fastPeriod, priceKey);
      const slowHMA = this.calculateHMA(data, slowPeriod, priceKey);
      
      // Calculate crossover signals
      const signals = [];
      let lastValidIndex = 0;
      
      // Find first index where both HMAs have values
      while (lastValidIndex < data.length && 
             (fastHMA[lastValidIndex] === null || slowHMA[lastValidIndex] === null)) {
        lastValidIndex++;
      }
      
      if (lastValidIndex >= data.length - 1) {
        return { fastHMA, slowHMA, signals };
      }
      
      let prevFastAboveSlow = fastHMA[lastValidIndex] > slowHMA[lastValidIndex];
      
      for (let i = lastValidIndex + 1; i < data.length; i++) {
        if (fastHMA[i] === null || slowHMA[i] === null) continue;
        
        const currentFastAboveSlow = fastHMA[i] > slowHMA[i];
        
        // Detect crossovers
        if (!prevFastAboveSlow && currentFastAboveSlow) {
          signals.push({
            index: i,
            type: 'buy',
            fastValue: fastHMA[i],
            slowValue: slowHMA[i],
            price: data[i][priceKey],
            timestamp: data[i].timestamp || i
          });
        } else if (prevFastAboveSlow && !currentFastAboveSlow) {
          signals.push({
            index: i,
            type: 'sell',
            fastValue: fastHMA[i],
            slowValue: slowHMA[i],
            price: data[i][priceKey],
            timestamp: data[i].timestamp || i
          });
        }
        
        prevFastAboveSlow = currentFastAboveSlow;
      }
      
      return {
        fastHMA,
        slowHMA,
        signals
      };
    } catch (error) {
      console.error('[HMAService] Error calculating HMA signals:', error);
      return {
        fastHMA: [],
        slowHMA: [],
        signals: []
      };
    }
  }

  /**
   * Fetch and calculate HMA for a symbol
   * @param {string} symbol - Symbol to calculate HMA for (can be frontend or Fyers format)
   * @param {Object} user - User object with Fyers connection
   * @returns {Promise<Object>} - HMA calculation result
   */
  static async fetchAndCalculateHMA(symbol, user = null) {
    try {
      LoggerService.info('HMAService', `Fetching real HMA for symbol: ${symbol} using 5-minute candles`);
      
      // Handle symbol format - symbol can be either frontend format or Fyers format
      let fyersSymbol = symbol;
      let originalSymbol = symbol;
      
      if (!symbol.includes(':')) {
        // This is a frontend symbol (e.g., 'NIFTY25300CE'), convert it to Fyers format
        const { SymbolService } = require('./symbolService');
        
        // We need spot price for ATM calculation, but we can use a default or get from user context
        // For now, let's use a reasonable default and log this
        const defaultSpotPrice = 25000; // This should be replaced with actual spot price
        LoggerService.debug('HMAService', `Converting frontend symbol to Fyers symbol using default spot price: ${defaultSpotPrice}`);
        
        try {
          fyersSymbol = SymbolService.convertToFyersSymbol(symbol, defaultSpotPrice);
          LoggerService.debug('HMAService', `Converted ${symbol} to ${fyersSymbol}`);
        } catch (conversionError) {
          LoggerService.error('HMAService', `Failed to convert symbol ${symbol}:`, conversionError);
          throw new Error(`Invalid symbol format: ${symbol}. Expected format like 'NIFTY25300CE' or 'NSE:NIFTY2571025300CE'`);
        }
      } else {
        // This is already a Fyers symbol (e.g., 'NSE:NIFTY2571025300CE')
        LoggerService.debug('HMAService', `Symbol is already in Fyers format: ${symbol}`);
        fyersSymbol = symbol;
      }
      
      // Get access token from user's Fyers connection ONLY
      let accessToken = null;
      if (user && user.fyers && user.fyers.accessToken && user.fyers.connected) {
        const { getFyersAppId } = require('../fyersService');
        const appId = getFyersAppId();
        accessToken = `${appId}:${user.fyers.accessToken}`;
        LoggerService.debug('HMAService', 'Using Fyers access token from user.fyers (formatted with appId)');
      } else {
        // Gracefully handle missing token - don't crash the server
        LoggerService.warn('HMAService', `User ${user?._id || 'unknown'} has no valid Fyers token - skipping HMA calculation`);
        return {
          symbol: originalSymbol,
          currentHMA: null,
          period: 55,
          data: [],
          lastUpdate: new Date(),
          status: 'DISCONNECTED',
          resolution: '5min',
          error: 'Fyers token missing or expired'
        };
      }
      
      // Fetch 5-minute historical data from Fyers using the converted symbol
      const historicalData = await this.fetchHistoricalData(fyersSymbol, accessToken);
      
      // For HMA-55, we need at least 55 candles + small buffer for calculation
      const minRequiredCandles = 60; // 55 for HMA + 5 buffer
      if (!historicalData || historicalData.length < minRequiredCandles) {
        throw new Error(`Insufficient 5-minute historical data for HMA calculation. Need at least ${minRequiredCandles} candles, got ${historicalData?.length || 0}`);
      }
      
      // Calculate HMA using the Pine Script algorithm with 5-minute data
      const hmaResult = this.calculateHMAFromCandles(historicalData);
      
      // Use the new HMA calculated logger
      LoggerService.hmaCalculated(fyersSymbol);
      LoggerService.debug('HMAService', `5-minute data points used: ${historicalData.length}, HMA period: 55`);
      
      return {
        symbol: originalSymbol, // Return the original symbol format that frontend expects
        fyersSymbol: fyersSymbol, // Also include the Fyers symbol for reference
        currentHMA: hmaResult.currentHMA,
        period: 55,
        data: hmaResult.data,
        lastUpdate: new Date(),
        status: 'ACTIVE',
        resolution: '5min'
      };
    } catch (error) {
      LoggerService.error('HMAService', `Error calculating real HMA for ${symbol}:`, error);
      
      // Handle Fyers API errors - no mock data for trading app
      if (error.message && error.message.includes('503')) {
        LoggerService.error('HMAService', 'Fyers API is temporarily unavailable (503 error)');
        throw new Error('Fyers API is temporarily unavailable. Please try again later.');
      }
      
      throw error;
    }
  }

  // Helper: Get previous market day (skipping weekends)
  static getPreviousMarketDay(date) {
    const prev = new Date(date);
    do {
      prev.setDate(prev.getDate() - 1);
    } while (prev.getDay() === 0 || prev.getDay() === 6); // 0=Sunday, 6=Saturday
    return prev;
  }

  // Helper: Format date as yyyy-mm-dd
  static formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Convert UTC timestamp to IST and extract trading hours
   * @param {number} timestamp - UTC timestamp in seconds
   * @returns {Object} - IST date info for trading hours filtering
   */
  static convertUTCToIST(timestamp) {
    // Convert UTC timestamp to IST (UTC+5:30)
    const utcDate = new Date(timestamp * 1000);
    const istDate = new Date(utcDate.getTime() + (5.5 * 60 * 60 * 1000)); // Add 5:30 hours
    
    const hours = istDate.getUTCHours();
    const minutes = istDate.getUTCMinutes();
    const totalMinutes = hours * 60 + minutes;
    
    return {
      istDate,
      hours,
      minutes,
      totalMinutes,
      isTradingHours: totalMinutes >= 555 && totalMinutes <= 930 // 9:15 AM - 3:30 PM IST
    };
  }

  /**
   * Fetch historical data from Fyers API
   * @param {string} symbol - Symbol to fetch data for
   * @param {string} accessToken - Fyers access token
   * @param {Object} options - Options for data fetching
   * @returns {Promise<Array>} - Array of candle data
   */
  static async fetchHistoricalData(symbol, accessToken, options = {}) {
    try {
      const { startDate, endDate, interval = "5" } = options;
      
      LoggerService.info('HMAService', `Fetching ${interval}-minute historical data for ${symbol} from Fyers...`);
      const FyersAPI = require("fyers-api-v3").fyersModel;
      const fyers = new FyersAPI();
      const [appId, token] = accessToken.split(':');
      if (!appId || !token) {
        throw new Error('Invalid access token format. Expected format: "appId:token"');
      }
      fyers.setAppId(appId);
      fyers.setAccessToken(token);
      
      let candles = [];

      // Helper to fetch candles for a date range
      const fetchCandles = async (fromDate, toDate) => {
        const params = {
          symbol: symbol,
          resolution: interval,
          date_format: "1",
          range_from: this.formatDate(fromDate),
          range_to: this.formatDate(toDate),
          cont_flag: "1"
        };
        
        LoggerService.debug('HMAService', `Fetching candles with params:`, params);
        
        const response = await fyers.getHistory(params);
        if (response.s === 'ok' && response.candles && Array.isArray(response.candles)) {
          return response.candles.map(candle => {
            // Convert UTC timestamp to IST for reference (but don't filter)
            const istInfo = this.convertUTCToIST(candle[0]);
            
            return {
              timestamp: candle[0] * 1000,
              istDate: istInfo.istDate,
              istHours: istInfo.hours,
              istMinutes: istInfo.minutes,
              istTotalMinutes: istInfo.totalMinutes,
              isTradingHours: istInfo.isTradingHours,
              open: parseFloat(candle[1]),
              high: parseFloat(candle[2]),
              low: parseFloat(candle[3]),
              close: parseFloat(candle[4]),
              volume: parseInt(candle[5])
            };
          }); // REMOVED: .filter(candle => candle.isTradingHours) - No longer filtering for trading hours
        }
        return [];
      };

      // If custom date range is provided, use it
      if (startDate && endDate) {
        LoggerService.info('HMAService', `Using custom date range: ${startDate} to ${endDate}`);
        candles = await fetchCandles(startDate, endDate);
      } else {
        // Default behavior: fetch sufficient data for HMA 55 calculation
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        
        // Calculate how many days we need based on interval
        let daysToFetch = 3; // Default for 5-minute intervals
        
        if (interval === "1") {
          daysToFetch = 1; // 1-minute: 1 day is sufficient (375 candles)
        } else if (interval === "5") {
          daysToFetch = 3; // 5-minute: 3 days to ensure enough data (225 candles)
        } else if (interval === "15") {
          daysToFetch = 7; // 15-minute: 7 days to ensure enough data (175 candles)
        } else if (interval === "30") {
          daysToFetch = 10; // 30-minute: 10 days to ensure enough data (120 candles)
        } else if (interval === "60") {
          daysToFetch = 20; // 1-hour: 20 days to ensure enough data (120 candles)
        }
        
        // Calculate start date to fetch sufficient data
        const startDate = new Date(today);
        startDate.setDate(startDate.getDate() - daysToFetch);
        
        LoggerService.info('HMAService', `Fetching ${daysToFetch} days of data for ${interval}-minute intervals`);
        candles = await fetchCandles(startDate, now);
        
        // If we still don't have enough candles, fetch more data
        if (candles.length < 100) { // Ensure we have at least 100 candles for HMA 55
          LoggerService.warn('HMAService', `Only got ${candles.length} candles, fetching more data...`);
          const extendedStartDate = new Date(startDate);
          extendedStartDate.setDate(extendedStartDate.getDate() - 7); // Fetch 7 more days
          const additionalCandles = await fetchCandles(extendedStartDate, startDate);
          candles = additionalCandles.concat(candles);
        }
      }

      LoggerService.debug('HMAService', `Total ${interval}-min candles fetched: ${candles.length}`);
      
      // Log data quality information
      if (candles.length > 0) {
        const tradingHoursCandles = candles.filter(c => c.isTradingHours);
        const nonTradingHoursCandles = candles.filter(c => !c.isTradingHours);
        
        LoggerService.info('HMAService', `Data quality: ${tradingHoursCandles.length} trading hours candles, ${nonTradingHoursCandles.length} non-trading hours candles`);
        
        if (candles.length < 55) {
          LoggerService.warn('HMAService', `Warning: Only ${candles.length} candles available for HMA 55 calculation`);
        }
      }
      
      return candles;
    } catch (error) {
      LoggerService.error('HMAService', 'Error fetching historical data:', error);
      
      // Check if it's a token expiration error
      const errorMessage = error.message || '';
      const isTokenExpired = 
        errorMessage.includes('Could not authenticate') ||
        errorMessage.includes('token expired') ||
        errorMessage.includes('invalid token') ||
        errorMessage.includes('unauthorized') ||
        errorMessage.includes('access denied') ||
        errorMessage.includes('code: -16');
      
      if (isTokenExpired) {
        LoggerService.warn('HMAService', 'Token expired - returning empty data instead of crashing');
        return []; // Return empty array instead of throwing error
      }
      
      throw error; // Re-throw other errors
    }
  }

  /**
   * Calculate HMA from candles array using Pine Script logic
   * @param {Array} candles - Array of candle data
   * @returns {Object} - HMA calculation result
   */
  static calculateHMAFromCandles(candles) {
    const HMA_PERIOD = 55;
    
    if (candles.length < HMA_PERIOD) {
      throw new Error(`Insufficient data. Need at least ${HMA_PERIOD} candles for HMA-${HMA_PERIOD}`);
    }
    
    // Transform candles to HMA data format
    const hmaData = candles.map(candle => ({
      timestamp: candle.timestamp,
      close: candle.close,
      hma: 0 // Will be calculated
    }));
    
    // Calculate HMA for each point starting from period-1
    for (let i = HMA_PERIOD - 1; i < hmaData.length; i++) {
      hmaData[i].hma = this.calculateHMAForPoint(hmaData, i, HMA_PERIOD);
    }
    
    const currentHMA = hmaData[hmaData.length - 1]?.hma || 0;
    
    return {
      period: HMA_PERIOD,
      data: hmaData,
      currentHMA
    };
  }

  /**
   * Calculate HMA for a specific point using Pine Script logic
   * @param {Array} data - Array of data points
   * @param {number} index - Current index
   * @param {number} period - HMA period
   * @returns {number} - HMA value
   */
  static calculateHMAForPoint(data, index, period) {
    const halfPeriod = Math.floor(period / 2);
    const sqrtPeriod = Math.floor(Math.sqrt(period));
    
    // Calculate WMA(n/2)
    let wma1 = 0;
    let weightSum1 = 0;
    for (let i = 0; i < halfPeriod; i++) {
      const weight = halfPeriod - i;
      wma1 += data[index - i].close * weight;
      weightSum1 += weight;
    }
    wma1 = wma1 / weightSum1;
    
    // Calculate WMA(n)
    let wma2 = 0;
    let weightSum2 = 0;
    for (let i = 0; i < period; i++) {
      const weight = period - i;
      wma2 += data[index - i].close * weight;
      weightSum2 += weight;
    }
    wma2 = wma2 / weightSum2;
    
    // Calculate raw HMA value: 2 * WMA(n/2) - WMA(n)
    const rawHma = 2 * wma1 - wma2;
    
    // Apply final smoothing if we have enough data
    if (index < period + sqrtPeriod - 2) return rawHma;
    
    // Final smoothing with WMA(sqrt(n))
    let finalHma = 0;
    let weightSum3 = 0;
    
    for (let i = 0; i < sqrtPeriod; i++) {
      const rawValue = 2 * this.calculateWMAForPoint(data, index - i, halfPeriod) - 
                      this.calculateWMAForPoint(data, index - i, period);
      const weight = sqrtPeriod - i;
      finalHma += rawValue * weight;
      weightSum3 += weight;
    }
    
    return finalHma / weightSum3;
  }

  /**
   * Calculate WMA for a specific point
   * @param {Array} data - Array of data points
   * @param {number} index - Current index
   * @param {number} period - WMA period
   * @returns {number} - WMA value
   */
  static calculateWMAForPoint(data, index, period) {
    let wma = 0;
    let weightSum = 0;
    
    for (let i = 0; i < period; i++) {
      const weight = period - i;
      wma += data[index - i].close * weight;
      weightSum += weight;
    }
    
    return wma / weightSum;
  }

  /**
   * Test HMA calculation without trading hours filter
   * @param {string} symbol - Symbol to calculate HMA for
   * @param {Object} user - User object (optional, for Fyers access)
   * @returns {Promise<Object>} - HMA data
   */
  static async fetchAndCalculateHMATest(symbol, user = null) {
    try {
      LoggerService.info('HMAService', `TEST: Fetching real HMA for symbol: ${symbol} using 5-minute candles (test mode)`);
      
      // Use the same real calculation as the main function
      const result = await this.fetchAndCalculateHMA(symbol, user);
      
      // Add test-specific metadata
      return {
        ...result,
        testMode: true,
        candlesUsed: result.data.length,
        resolution: '5min'
      };
    } catch (error) {
      LoggerService.error('HMAService', `Error in test HMA calculation for ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * Get HMA cache statistics
   * @returns {Object} - Cache statistics
   */
  static getCacheStats() {
    return {
      totalEntries: 0,
      memoryUsage: '0 MB',
      hitRate: 0,
      lastCleanup: new Date()
    };
  }

  /**
   * Clear HMA cache for a symbol
   * @param {string} symbol - Symbol to clear cache for
   * @returns {boolean} - Success status
   */
  static clearCache(symbol) {
    LoggerService.info('HMAService', `Clearing cache for symbol: ${symbol}`);
    return true;
  }

  /**
   * Calculate HMA trend strength
   * @param {Array} hma - Array of HMA values
   * @param {number} lookback - Number of periods to look back
   * @returns {number} - Trend strength value between -100 and 100
   */
  static calculateTrendStrength(hma, lookback = 5) {
    if (!hma || hma.length < lookback + 1) {
      return 0;
    }

    let lastValidIndex = hma.length - 1;
    while (lastValidIndex >= 0 && hma[lastValidIndex] === null) {
      lastValidIndex--;
    }

    if (lastValidIndex < lookback) {
      return 0;
    }

    try {
      // Calculate slope over lookback periods
      const slopes = [];
      for (let i = 0; i < lookback; i++) {
        const currentIndex = lastValidIndex - i;
        const prevIndex = currentIndex - 1;
        
        if (prevIndex >= 0 && hma[prevIndex] !== null) {
          slopes.push(hma[currentIndex] - hma[prevIndex]);
        }
      }

      if (slopes.length === 0) {
        return 0;
      }

      // Average slope
      const avgSlope = slopes.reduce((sum, slope) => sum + slope, 0) / slopes.length;
      
      // Normalize to a -100 to 100 scale
      // This is a simple normalization, can be adjusted based on the typical range of slopes
      const maxExpectedSlope = 10; // Adjust based on your data
      const normalizedStrength = Math.min(Math.max((avgSlope / maxExpectedSlope) * 100, -100), 100);
      
      return Math.round(normalizedStrength);
    } catch (error) {
      LoggerService.error('HMAService', 'Error calculating trend strength:', error);
      return 0;
    }
  }

  /**
   * Fetch historical data for backtesting using Fyers API with prefill functionality
   * @param {string} symbol - Symbol to fetch data for
   * @param {string} accessToken - Fyers access token
   * @param {Object} options - Options for data fetching
   * @param {number} options.hmaPeriod - HMA period for prefill calculation
   * @returns {Promise<Array>} - Array of candle data with prefill
   */
  static async fetchHistoricalDataForBacktest(symbol, accessToken, options = {}) {
    try {
      const { startDate, endDate, interval = "5", hmaPeriod = 55 } = options;
      
      // Validate symbol format
      if (!symbol || typeof symbol !== 'string') {
        throw new Error('Invalid symbol: Symbol is required and must be a string');
      }
      
      // Check for common invalid symbol patterns
      if (symbol.includes('CE') || symbol.includes('PE') || symbol.includes('FUT')) {
        LoggerService.warn('HMAService', `Symbol ${symbol} appears to be an options/futures symbol. For backtesting, please use index or equity symbols like NSE:NIFTY50-INDEX, BSE:SENSEX-INDEX, or NSE:SBIN-EQ`);
        LoggerService.info('HMAService', `Note: Options symbols may have limited historical data availability`);
      }
      
      LoggerService.info('HMAService', `Fetching ${interval}-minute historical data for ${symbol} with HMA-${hmaPeriod} prefill...`);
      const FyersAPI = require("fyers-api-v3").fyersModel;
      const fyers = new FyersAPI();
      const [appId, token] = accessToken.split(':');
      if (!appId || !token) {
        throw new Error('Invalid access token format. Expected format: "appId:token"');
      }
      
      // Debug Fyers client setup
      LoggerService.info('HMAService', `🔧 Setting up Fyers client with AppID: ${appId}`);
      LoggerService.info('HMAService', `🔧 Token length: ${token.length} characters`);
      LoggerService.info('HMAService', `🔧 Token starts with: ${token.substring(0, 10)}...`);
      
      fyers.setAppId(appId);
      fyers.setAccessToken(token);
      
      LoggerService.info('HMAService', `✅ Fyers client setup completed`);
      
      // Helper to parse IST date string from frontend (assume input is 'YYYY-MM-DDTHH:mm' or 'YYYY-MM-DDTHH:mm+05:30')
      const parseIST = (dateString) => {
        if (!dateString) throw new Error('No date string provided');
        // If it's a Date object, use as is
        if (dateString instanceof Date) return dateString;
        // If not a string, convert to string
        if (typeof dateString !== 'string') dateString = String(dateString);
        if (!dateString.endsWith('Z') && !dateString.includes('+')) {
          // If missing seconds, add :00
          if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(dateString)) {
            dateString += ':00';
          }
          return new Date(dateString + '+05:30');
        }
        return new Date(dateString);
      };
      // Convert IST date to UTC
      const toUTC = (date) => new Date(date.getTime() - (5.5 * 60 * 60 * 1000));

      // Parse input dates as IST
      const istStartDate = parseIST(startDate);
      const istEndDate = parseIST(endDate);
      // Convert to UTC
      const utcStartDate = toUTC(istStartDate);
      const utcEndDate = toUTC(istEndDate);

      LoggerService.info('HMAService', `IST Start: ${istStartDate.toISOString()}, IST End: ${istEndDate.toISOString()}`);
      LoggerService.info('HMAService', `UTC Start: ${utcStartDate.toISOString()}, UTC End: ${utcEndDate.toISOString()}`);
      LoggerService.info('HMAService', `UNIX Start: ${Math.floor(utcStartDate.getTime()/1000)}, UNIX End: ${Math.floor(utcEndDate.getTime()/1000)}`);

      // Calculate prefill period - we need hmaPeriod candles before the start date
      const prefillStartDate = new Date(utcStartDate);
      const intervalMinutes = parseInt(interval);
      const prefillMinutes = hmaPeriod * intervalMinutes;
      prefillStartDate.setMinutes(prefillStartDate.getMinutes() - prefillMinutes);

      LoggerService.info('HMAService', `Prefill period: ${hmaPeriod} candles (${prefillMinutes} minutes) before start date`);
      LoggerService.info('HMAService', `Fetching data from ${prefillStartDate.toISOString()} to ${utcEndDate.toISOString()}`);

      let allCandles = [];

      // Helper to fetch candles for a date range
      const fetchCandles = async (fromDate, toDate) => {
        const range_from = Math.floor(fromDate.getTime() / 1000);
        const range_to = Math.floor(toDate.getTime() / 1000);
        LoggerService.info('HMAService', `Fyers API request: UNIX from ${range_from} (${new Date(range_from*1000).toISOString()}) to ${range_to} (${new Date(range_to*1000).toISOString()})`);
        const params = {
          symbol: symbol,
          resolution: interval,
          date_format: "0", // Use UNIX timestamp format
          range_from,
          range_to,
          cont_flag: "1"
        };
        LoggerService.debug('HMAService', `Fetching candles with params:`, params);
        
        // Add comprehensive debugging for Fyers API call
        LoggerService.info('HMAService', `🔍 Making Fyers API call with params:`, JSON.stringify(params, null, 2));
        
        try {
          const response = await fyers.getHistory(params);
          LoggerService.info('HMAService', `📡 Fyers API Response:`, JSON.stringify(response, null, 2));
          LoggerService.info('HMAService', `📊 Response status: "${response.s}"`);
          LoggerService.info('HMAService', `📊 Response keys: ${Object.keys(response).join(', ')}`);
          
          if (response.s === 'ok' && response.candles && Array.isArray(response.candles)) {
            LoggerService.info('HMAService', `✅ Success: Received ${response.candles.length} candles`);
            return response.candles.map(candle => {
              // Fyers returns UTC timestamps, keep them as UTC for consistency
              const utcTimestamp = candle[0] * 1000;
              return {
                timestamp: utcTimestamp,
                open: parseFloat(candle[1]),
                high: parseFloat(candle[2]),
                low: parseFloat(candle[3]),
                close: parseFloat(candle[4]),
                volume: parseInt(candle[5])
              };
            });
          } else {
            LoggerService.warn('HMAService', `⚠️ Fyers API returned invalid response:`, response);
            LoggerService.warn('HMAService', `Response status: ${response.s}`);
            LoggerService.warn('HMAService', `Candles array: ${response.candles ? 'exists' : 'missing'}`);
            LoggerService.warn('HMAService', `Candles is array: ${Array.isArray(response.candles)}`);
            return [];
          }
        } catch (apiError) {
          LoggerService.error('HMAService', `❌ Fyers API call failed:`, apiError);
          LoggerService.error('HMAService', `Error message: ${apiError.message}`);
          LoggerService.error('HMAService', `Error stack: ${apiError.stack}`);
          throw apiError;
        }
      };

      // Fetch data including prefill period
      allCandles = await fetchCandles(prefillStartDate, utcEndDate);

      LoggerService.debug('HMAService', `Total ${interval}-min candles fetched: ${allCandles.length}`);

      if (allCandles.length === 0) {
        LoggerService.warn('HMAService', 'No candles fetched from Fyers API. This might be due to:');
        LoggerService.warn('HMAService', '1. Invalid symbol format');
        LoggerService.warn('HMAService', '2. No data available for the specified date range');
        LoggerService.warn('HMAService', '3. Market was closed during the specified period');
        LoggerService.warn('HMAService', '4. Access token issues');
        throw new Error('No historical data available for the specified symbol and date range. Please check the symbol format and ensure the market was open during the selected period.');
      }

      // Separate prefill data from main data
      const prefillCandles = allCandles.filter(candle => {
        const candleDate = new Date(candle.timestamp);
        return candleDate < utcStartDate;
      });

      const mainCandles = allCandles.filter(candle => {
        const candleDate = new Date(candle.timestamp);
        return candleDate >= utcStartDate && candleDate <= utcEndDate;
      });

      LoggerService.info('HMAService', `Prefill candles: ${prefillCandles.length}, Main candles: ${mainCandles.length}`);
      LoggerService.info('HMAService', `Successfully fetched ${allCandles.length} candles with prefill for HMA-${hmaPeriod} calculation`);
      
      // Debug: Log the actual date range of the returned candles
      if (allCandles.length > 0) {
        const firstCandle = new Date(allCandles[0].timestamp);
        const lastCandle = new Date(allCandles[allCandles.length - 1].timestamp);
        LoggerService.info('HMAService', `Actual candle date range: ${firstCandle.toISOString()} to ${lastCandle.toISOString()}`);
        LoggerService.info('HMAService', `Requested date range: ${utcStartDate.toISOString()} to ${utcEndDate.toISOString()}`);
      }
      
      return allCandles; // Return all candles including prefill
    } catch (error) {
      LoggerService.error('HMAService', 'Error fetching historical data for backtest:', error);
      throw error;
    }
  }

  /**
   * Test Fyers API connection with a simple symbol
   * @param {string} accessToken - Fyers access token
   * @returns {Promise<Object>} - Test result
   */
  static async testFyersConnection(accessToken) {
    try {
      LoggerService.info('HMAService', '🧪 Testing Fyers API connection...');
      
      const FyersAPI = require("fyers-api-v3").fyersModel;
      const fyers = new FyersAPI();
      
      const [appId, token] = accessToken.split(':');
      fyers.setAppId(appId);
      fyers.setAccessToken(token);
      
      // Test with a simple index symbol
      const testParams = {
        symbol: 'NSE:NIFTY50-INDEX',
        resolution: 'D',
        date_format: '1',
        range_from: '2024-12-01',
        range_to: '2024-12-02',
        cont_flag: '1'
      };
      
      LoggerService.info('HMAService', '🧪 Testing with params:', JSON.stringify(testParams, null, 2));
      
      const response = await fyers.getHistory(testParams);
      LoggerService.info('HMAService', '🧪 Test response:', JSON.stringify(response, null, 2));
      
      return {
        success: response.s === 'ok',
        status: response.s,
        candlesCount: response.candles ? response.candles.length : 0,
        response: response
      };
      
    } catch (error) {
      LoggerService.error('HMAService', '🧪 Test failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Update HMA with latest 5-minute candle data (for real-time monitoring)
   * @param {string} symbol - Symbol to update HMA for
   * @param {string} accessToken - Fyers access token
   * @param {Array} existingCandles - Existing candle data (optional)
   * @returns {Promise<Object>} - Updated HMA data
   */
  static async updateHMAWithLatestData(symbol, accessToken, existingCandles = []) {
    try {
      console.log(`🔄 Updating HMA with latest 5-minute data for ${symbol}`);
      
      // Import Fyers API client
      const FyersAPI = require("fyers-api-v3").fyersModel;
      
      // Initialize Fyers API client
      const fyers = new FyersAPI();
      
      // Extract appId and token from accessToken (format: "appId:token")
      const [appId, token] = accessToken.split(':');
      
      if (!appId || !token) {
        throw new Error('Invalid access token format. Expected format: "appId:token"');
      }
      
      // Set up Fyers client
      fyers.setAppId(appId);
      fyers.setAccessToken(token);
      
      // Get latest 5-minute candle (last 10 minutes to ensure we get the latest)
      const endDate = new Date();
      const startDate = new Date();
      startDate.setMinutes(startDate.getMinutes() - 10); // Last 10 minutes
      
      // Format dates as yyyy-mm-dd for Fyers API
      const formatDate = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };
      
      const rangeFrom = formatDate(startDate);
      const rangeTo = formatDate(endDate);
      
      console.log(`📅 Fetching latest 5-minute candles: ${rangeFrom} to ${rangeTo}`);
      
      // Prepare request parameters
      const params = {
        symbol: symbol,
        resolution: "5", // 5-minute candles
        date_format: "1", // yyyy-mm-dd format
        range_from: rangeFrom,
        range_to: rangeTo,
        cont_flag: "1"
      };
      
      // Make the API call
      const response = await fyers.getHistory(params);
      
      if (response.s === 'ok' && response.candles && Array.isArray(response.candles)) {
        console.log(`✅ Received ${response.candles.length} latest 5-minute candles`);
        
        // Transform latest candles
        const latestCandles = response.candles.map(candle => ({
          timestamp: candle[0] * 1000,
          open: parseFloat(candle[1]),
          high: parseFloat(candle[2]),
          low: parseFloat(candle[3]),
          close: parseFloat(candle[4]),
          volume: parseInt(candle[5])
        }));
        
        // Combine with existing candles, removing duplicates
        let allCandles = [...existingCandles];
        
        for (const newCandle of latestCandles) {
          const existingIndex = allCandles.findIndex(c => c.timestamp === newCandle.timestamp);
          if (existingIndex >= 0) {
            // Update existing candle
            allCandles[existingIndex] = newCandle;
          } else {
            // Add new candle
            allCandles.push(newCandle);
          }
        }
        
        // Sort by timestamp
        allCandles.sort((a, b) => a.timestamp - b.timestamp);
        
        // Keep only last 100 candles to prevent memory bloat
        if (allCandles.length > 100) {
          allCandles = allCandles.slice(-100);
        }
        
        console.log(`📊 Total candles after update: ${allCandles.length}`);
        
        // Calculate HMA
        if (allCandles.length >= 55) {
          const hmaResult = this.calculateHMAFromCandles(allCandles);
          
          return {
            symbol,
            currentHMA: hmaResult.currentHMA,
            period: 55,
            data: hmaResult.data,
            lastUpdate: new Date(),
            status: 'ACTIVE',
            resolution: '5min',
            candlesCount: allCandles.length,
            isRealTimeUpdate: true
          };
        } else {
          throw new Error(`Insufficient candles for HMA calculation: ${allCandles.length}`);
        }
        
      } else {
        throw new Error(`Failed to fetch latest data: ${response.s || 'Unknown error'}`);
      }
      
    } catch (error) {
      console.error(`❌ Error updating HMA with latest data for ${symbol}:`, error);
      throw error;
    }
  }
}

module.exports = { HMAService };
