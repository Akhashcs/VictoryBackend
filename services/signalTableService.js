const mongoose = require('mongoose');
const axios = require('axios');
const LoggerService = require('./loggerService');
const { HMAService } = require('./hmaService');
const User = require('../models/User');

// Specified symbols for the signal table
const SIGNAL_TABLE_SYMBOLS = [
  'NSE:TATASTEEL-EQ',
  'NSE:HINDALCO-EQ', 
  'NSE:SBIN-EQ',
  'NSE:ADANIPORTS-EQ',
  'NSE:WIPRO-EQ',
  'NSE:GRASIM-EQ',
  'NSE:HCLTECH-EQ',
  'NSE:BPCL-EQ',
  'NSE:M&M-EQ',
  'NSE:COALINDIA-EQ',
  'NSE:SBILIFE-EQ',
  'NSE:BAJFINANCE-EQ',
  'NSE:BHARTIARTL-EQ',
  'NSE:DRREDDY-EQ',
  'NSE:HDFCBANK-EQ',
  'NSE:HEROMOTOCO-EQ',
  'NSE:ONGC-EQ',
  'NSE:SUNPHARMA-EQ',
  'NSE:APOLLOHOSP-EQ',
  'NSE:ICICIBANK-EQ'
];

// MongoDB Models for signal table data
const SignalTableData = mongoose.model('SignalTableData', new mongoose.Schema({
  symbol: { type: String, required: true, index: true },
  current_price: { type: Number, required: true },
  previous_close: { type: Number, required: true },
  hma9_value: { type: Number, default: null },
  hma55_value: { type: Number, required: true },
  hma55_minus2_value: { type: Number, required: true },
  signal: { type: String, enum: ['Buy', 'Sell', 'No Signal'], default: 'No Signal' },
  last_updated: { type: Date, default: Date.now }
}, { collection: 'signal_table_data' }));

class SignalTableService {
  constructor() {
    this.accessToken = null;
    this.updateInterval = null;
    this.isUpdating = false;
  }

  /**
   * Initialize the service with Fyers access token
   */
  async initialize() {
    try {
      // Get user with valid access token
      const user = await User.findOne({
        'fyers.connected': true,
        'fyers.accessToken': { $exists: true, $ne: null }
      });

      if (!user || !user.fyers.accessToken) {
        throw new Error('No user with valid Fyers access token found');
      }

      this.accessToken = user.fyers.accessToken;
      LoggerService.info('SignalTableService', 'Initialized with Fyers access token');
      
      // Start the update interval (every 5 minutes)
      this.startUpdateInterval();
      
      return true;
    } catch (error) {
      LoggerService.error('SignalTableService', 'Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Start the update interval for live prices
   */
  startUpdateInterval() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }

    // Update every 5 minutes (300,000 milliseconds)
    this.updateInterval = setInterval(async () => {
      if (!this.isUpdating) {
        await this.updateAllSignalData();
      }
    }, 5 * 60 * 1000);

    LoggerService.info('SignalTableService', 'Started update interval (every 5 minutes)');
  }

  /**
   * Stop the update interval
   */
  stopUpdateInterval() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
      LoggerService.info('SignalTableService', 'Stopped update interval');
    }
  }

  /**
   * Fetch current price for a symbol using Fyers API
   */
  async fetchCurrentPrice(symbol) {
    try {
      // Get current date and previous day
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 1);

      const requestData = {
        symbol: symbol,
        resolution: '1D',
        date_format: '1',
        range_from: startDate.toISOString().split('T')[0],
        range_to: endDate.toISOString().split('T')[0],
        cont_flag: '1'
      };

      const response = await axios.get('https://api-t1.fyers.in/api/v3/data/history', {
        params: requestData,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'axios/1.10.0',
          'Authorization': `Bearer ${this.accessToken}`
        },
        timeout: 30000
      });

      if (response.data.s !== 'ok' || !response.data.candles || response.data.candles.length === 0) {
        throw new Error(`Fyers API error: ${response.data.message || JSON.stringify(response.data)}`);
      }

      // Get the latest candle (current price)
      const latestCandle = response.data.candles[response.data.candles.length - 1];
      return {
        currentPrice: latestCandle[4], // Close price
        timestamp: new Date(latestCandle[0] * 1000)
      };
    } catch (error) {
      LoggerService.error('SignalTableService', `Failed to fetch current price for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Get previous close from MongoDB (last available market day)
   */
  async getPreviousClose(symbol) {
    try {
      const db = mongoose.connection.db;
      const collection = db.collection('50stocksdailydata');
      
      // Get the most recent data for this symbol
      const latestData = await collection
        .find({ symbol })
        .sort({ date: -1 })
        .limit(1)
        .toArray();

      if (latestData.length === 0) {
        return null;
      }

      return latestData[0].close;
    } catch (error) {
      LoggerService.error('SignalTableService', `Failed to get previous close for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Get HMA 55 value from MongoDB
   */
  async getHMA55(symbol) {
    try {
      const db = mongoose.connection.db;
      const collection = db.collection('50stockshma');
      
      const hmaData = await collection.findOne({ symbol });
      return hmaData ? hmaData.hma_value : null;
    } catch (error) {
      LoggerService.error('SignalTableService', `Failed to get HMA 55 for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Get HMA 55 (-2) value (2 market days ago)
   */
  async getHMA55Minus2(symbol) {
    try {
      const db = mongoose.connection.db;
      const collection = db.collection('50stocksdailydata');
      
      // Get daily data sorted by date
      const dailyData = await collection
        .find({ symbol })
        .sort({ date: -1 })
        .limit(10) // Get last 10 days to find 2 market days ago
        .toArray();

      if (dailyData.length < 3) {
        return null;
      }

      // Find the 3rd most recent data (2 market days ago)
      // Skip weekends by checking if there are gaps in dates
      let marketDaysAgo = 0;
      let targetIndex = 2; // Start with 3rd most recent

      for (let i = 1; i < dailyData.length; i++) {
        const currentDate = new Date(dailyData[i].date);
        const previousDate = new Date(dailyData[i - 1].date);
        const dayDiff = Math.floor((previousDate - currentDate) / (1000 * 60 * 60 * 24));

        if (dayDiff > 1) {
          // Gap found, this is a market day
          marketDaysAgo++;
          if (marketDaysAgo === 2) {
            targetIndex = i;
            break;
          }
        }
      }

      return dailyData[targetIndex] ? dailyData[targetIndex].close : null;
    } catch (error) {
      LoggerService.error('SignalTableService', `Failed to get HMA 55 (-2) for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Calculate signal based on HMA9 crossover logic
   */
  calculateSignal(hma9, hma55, hma55Minus2) {
    if (!hma9 || !hma55 || !hma55Minus2) {
      return 'No Signal';
    }

    // Buy: HMA9 has just crossed over HMA55(0) and HMA55(-2)
    if (hma9 > hma55 && hma9 > hma55Minus2) {
      return 'Buy';
    }
    
    // Sell: HMA9 has just crossed down over HMA55(0) and HMA55(-2)
    if (hma9 < hma55 && hma9 < hma55Minus2) {
      return 'Sell';
    }

    return 'No Signal';
  }

  /**
   * Update signal data for a single symbol
   */
  async updateSignalData(symbol) {
    try {
      // Fetch current price
      const priceData = await this.fetchCurrentPrice(symbol);
      if (!priceData) {
        return null;
      }

      // Get previous close
      const previousClose = await this.getPreviousClose(symbol);
      if (!previousClose) {
        return null;
      }

      // Get HMA 55
      const hma55 = await this.getHMA55(symbol);
      if (!hma55) {
        return null;
      }

      // Get HMA 55 (-2)
      const hma55Minus2 = await this.getHMA55Minus2(symbol);
      if (!hma55Minus2) {
        return null;
      }

      // For now, HMA9 is left blank as requested
      const hma9 = null;

      // Calculate signal
      const signal = this.calculateSignal(hma9, hma55, hma55Minus2);

      // Update or create signal table data
      const signalData = {
        symbol,
        current_price: priceData.currentPrice,
        previous_close: previousClose,
        hma9_value: hma9,
        hma55_value: hma55,
        hma55_minus2_value: hma55Minus2,
        signal,
        last_updated: new Date()
      };

      await SignalTableData.findOneAndUpdate(
        { symbol },
        signalData,
        { upsert: true, new: true }
      );

      LoggerService.info('SignalTableService', `Updated signal data for ${symbol}`);
      return signalData;
    } catch (error) {
      LoggerService.error('SignalTableService', `Failed to update signal data for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Update all signal data for all symbols
   */
  async updateAllSignalData() {
    if (this.isUpdating) {
      LoggerService.info('SignalTableService', 'Update already in progress, skipping...');
      return;
    }

    this.isUpdating = true;
    LoggerService.info('SignalTableService', 'Starting signal data update for all symbols...');

    try {
      const results = [];
      
      for (const symbol of SIGNAL_TABLE_SYMBOLS) {
        try {
          const result = await this.updateSignalData(symbol);
          if (result) {
            results.push(result);
          }
          
          // Add delay to respect API limits
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          LoggerService.error('SignalTableService', `Error updating ${symbol}:`, error);
        }
      }

      LoggerService.info('SignalTableService', `Updated ${results.length} symbols`);
      return results;
    } catch (error) {
      LoggerService.error('SignalTableService', 'Error updating all signal data:', error);
      throw error;
    } finally {
      this.isUpdating = false;
    }
  }

  /**
   * Get all signal table data
   */
  async getSignalTableData() {
    try {
      const data = await SignalTableData.find({})
        .sort({ symbol: 1 })
        .lean();

      return data;
    } catch (error) {
      LoggerService.error('SignalTableService', 'Error fetching signal table data:', error);
      throw error;
    }
  }

  /**
   * Get last updated time
   */
  async getLastUpdatedTime() {
    try {
      const latestRecord = await SignalTableData.findOne({})
        .sort({ last_updated: -1 })
        .select('last_updated')
        .lean();

      return latestRecord ? latestRecord.last_updated : null;
    } catch (error) {
      LoggerService.error('SignalTableService', 'Error fetching last updated time:', error);
      return null;
    }
  }

  /**
   * Manual trigger for updating signal data
   */
  async triggerUpdate() {
    try {
      LoggerService.info('SignalTableService', 'Manual trigger for signal data update');
      return await this.updateAllSignalData();
    } catch (error) {
      LoggerService.error('SignalTableService', 'Error in manual trigger:', error);
      throw error;
    }
  }
}

module.exports = new SignalTableService(); 