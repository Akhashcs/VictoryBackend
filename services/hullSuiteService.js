const mongoose = require('mongoose');
const LoggerService = require('./loggerService');
const { HMAService } = require('./hmaService');
const { MarketDataService } = require('./marketDataService');

// Import models
const DailyCandle = require('../models/DailyCandle');
const HMASignal = require('../models/HMASignal');

class HullSuiteService {
  
  /**
   * Calculate HMA9 and HMA55 for Hull Suite strategy
   * @param {Array} dailyData - Array of daily candle data
   * @returns {Object} - Object with HMA9 and HMA55 values
   */
  static calculateHullSuiteHMAs(dailyData) {
    if (!dailyData || dailyData.length < 55) {
      return { hma9: null, hma55: null, hma55Minus2: null };
    }

    try {
      const closes = dailyData.map(candle => candle.close);
      
      // Calculate HMA9
      const hma9Values = HMAService.calculateHMA(dailyData, 9);
      const hma9 = hma9Values[hma9Values.length - 1]; // Latest HMA9 value
      
      // Calculate HMA55
      const hma55Values = HMAService.calculateHMA(dailyData, 55);
      const hma55 = hma55Values[hma55Values.length - 1]; // Latest HMA55 value
      
      // Get HMA55 value from 2 periods ago (HMA55(-2))
      const hma55Minus2 = hma55Values.length >= 3 ? hma55Values[hma55Values.length - 3] : null;
      
      return { hma9, hma55, hma55Minus2 };
    } catch (error) {
      LoggerService.error('HullSuiteService', 'Error calculating Hull Suite HMAs:', error);
      return { hma9: null, hma55: null, hma55Minus2: null };
    }
  }

  /**
   * Determine Hull Suite signal based on HMA9 crossover logic
   * @param {number} hma9 - Current HMA9 value
   * @param {number} hma55 - Current HMA55 value
   * @param {number} hma55Minus2 - HMA55 value from 2 periods ago
   * @param {number} prevHma9 - Previous HMA9 value
   * @param {number} prevHma55 - Previous HMA55 value
   * @param {number} prevHma55Minus2 - Previous HMA55(-2) value
   * @returns {string} - Signal type: 'Buy', 'Sell', 'Bullish', 'Bearish'
   */
  static determineHullSuiteSignal(hma9, hma55, hma55Minus2, prevHma9, prevHma55, prevHma55Minus2) {
    if (!hma9 || !hma55 || !hma55Minus2) {
      return 'No Signal';
    }

    // Check for crossover conditions
    const currentAboveBoth = hma9 > hma55 && hma9 > hma55Minus2;
    const previousAboveBoth = prevHma9 && prevHma55 && prevHma55Minus2 ? 
      (prevHma9 > prevHma55 && prevHma9 > prevHma55Minus2) : false;
    
    const currentBelowBoth = hma9 < hma55 && hma9 < hma55Minus2;
    const previousBelowBoth = prevHma9 && prevHma55 && prevHma55Minus2 ? 
      (prevHma9 < prevHma55 && prevHma9 < prevHma55Minus2) : false;

    // Buy signal: HMA9 crosses above both HMA55(0) and HMA55(-2)
    if (currentAboveBoth && !previousAboveBoth) {
      return 'Buy';
    }
    
    // Sell signal: HMA9 crosses below both HMA55(0) and HMA55(-2)
    if (currentBelowBoth && !previousBelowBoth) {
      return 'Sell';
    }
    
    // Bullish: HMA9 is already above both HMA55(0) and HMA55(-2)
    if (currentAboveBoth) {
      return 'Bullish';
    }
    
    // Bearish: HMA9 is already below both HMA55(0) and HMA55(-2)
    if (currentBelowBoth) {
      return 'Bearish';
    }
    
    return 'No Signal';
  }

  /**
   * Get Hull Suite signals for all stocks
   * @param {string} userId - User ID
   * @returns {Array} - Array of stock signals with Hull Suite data
   */
  static async getHullSuiteSignals(userId) {
    try {
      // Get all stocks with daily data
      const stocks = await DailyCandle.distinct('symbol');
      const signals = [];

      for (const symbol of stocks) {
        try {
          // Get latest daily data (last 60 days for HMA calculation)
          const dailyData = await DailyCandle.find({ symbol })
            .sort({ date: -1 })
            .limit(60)
            .lean();

          if (dailyData.length < 55) {
            continue; // Skip if insufficient data
          }

          // Reverse to get chronological order
          const chronologicalData = dailyData.reverse();
          
          // Calculate current HMAs
          const currentHMAs = this.calculateHullSuiteHMAs(chronologicalData);
          
          // Calculate previous HMAs (for crossover detection)
          const previousData = chronologicalData.slice(0, -1);
          const previousHMAs = this.calculateHullSuiteHMAs(previousData);
          
          // Determine signal
          const signal = this.determineHullSuiteSignal(
            currentHMAs.hma9,
            currentHMAs.hma55,
            currentHMAs.hma55Minus2,
            previousHMAs.hma9,
            previousHMAs.hma55,
            previousHMAs.hma55Minus2
          );

          // Get current price
          const currentPrice = chronologicalData[chronologicalData.length - 1]?.close || 0;
          const previousClose = chronologicalData[chronologicalData.length - 2]?.close || 0;

          signals.push({
            symbol,
            currentPrice,
            previousClose,
            hma9: currentHMAs.hma9,
            hma55: currentHMAs.hma55,
            hma55Minus2: currentHMAs.hma55Minus2,
            signal,
            lastUpdated: new Date()
          });

        } catch (error) {
          LoggerService.error('HullSuiteService', `Error processing ${symbol}:`, error);
          continue;
        }
      }

      return signals;
    } catch (error) {
      LoggerService.error('HullSuiteService', 'Error getting Hull Suite signals:', error);
      throw error;
    }
  }

  /**
   * Get Hull Suite signals for specific stock
   * @param {string} userId - User ID
   * @param {string} symbol - Stock symbol
   * @returns {Object} - Hull Suite signal data for the stock
   */
  static async getHullSuiteSignalForSymbol(userId, symbol) {
    try {
      // Get latest daily data
      const dailyData = await DailyCandle.find({ symbol })
        .sort({ date: -1 })
        .limit(60)
        .lean();

      if (dailyData.length < 55) {
        throw new Error('Insufficient data for Hull Suite calculation');
      }

      // Reverse to get chronological order
      const chronologicalData = dailyData.reverse();
      
      // Calculate current HMAs
      const currentHMAs = this.calculateHullSuiteHMAs(chronologicalData);
      
      // Calculate previous HMAs (for crossover detection)
      const previousData = chronologicalData.slice(0, -1);
      const previousHMAs = this.calculateHullSuiteHMAs(previousData);
      
      // Determine signal
      const signal = this.determineHullSuiteSignal(
        currentHMAs.hma9,
        currentHMAs.hma55,
        currentHMAs.hma55Minus2,
        previousHMAs.hma9,
        previousHMAs.hma55,
        previousHMAs.hma55Minus2
      );

      // Get current price
      const currentPrice = chronologicalData[chronologicalData.length - 1]?.close || 0;
      const previousClose = chronologicalData[chronologicalData.length - 2]?.close || 0;

      return {
        symbol,
        currentPrice,
        previousClose,
        hma9: currentHMAs.hma9,
        hma55: currentHMAs.hma55,
        hma55Minus2: currentHMAs.hma55Minus2,
        signal,
        lastUpdated: new Date()
      };

    } catch (error) {
      LoggerService.error('HullSuiteService', `Error getting Hull Suite signal for ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * Update Hull Suite signals for all stocks
   * @param {string} userId - User ID
   * @returns {Object} - Update result
   */
  static async updateHullSuiteSignals(userId) {
    try {
      LoggerService.info('HullSuiteService', 'Starting Hull Suite signal update for all stocks');
      
      const signals = await this.getHullSuiteSignals(userId);
      
      // Update or create HMASignal records
      for (const signalData of signals) {
        await HMASignal.findOneAndUpdate(
          { userId, symbol: signalData.symbol },
          {
            userId,
            symbol: signalData.symbol,
            hma_value: signalData.hma55, // Store HMA55 as main value
            hma9_value: signalData.hma9,
            hma55_minus2_value: signalData.hma55Minus2,
            signal_type: signalData.signal,
            last_updated: signalData.lastUpdated
          },
          { upsert: true, new: true }
        );
      }

      LoggerService.info('HullSuiteService', `Updated Hull Suite signals for ${signals.length} stocks`);
      return { success: true, updatedCount: signals.length };
    } catch (error) {
      LoggerService.error('HullSuiteService', 'Error updating Hull Suite signals:', error);
      throw error;
    }
  }
}

module.exports = HullSuiteService; 