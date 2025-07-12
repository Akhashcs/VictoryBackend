/**
 * Historical Data Download Script
 * Downloads data from June 18th 2023 to June 15th 2024
 * Computes weekly candles and HMA values
 * Saves to MongoDB collections
 */

const mongoose = require('mongoose');
const axios = require('axios');
const { HMAService } = require('../services/hmaService');
const LoggerService = require('../services/loggerService');
const User = require('../models/User');

// Stock list from stocklist.md
const STOCKS = [
  'NSE:HDFCLIFE-EQ', 'NSE:CIPLA-EQ', 'NSE:UPL-EQ', 'NSE:BPCL-EQ', 'NSE:TATACONSUM-EQ',
  'NSE:SBILIFE-EQ', 'NSE:DRREDDY-EQ', 'NSE:LT-EQ', 'NSE:APOLLOHOSP-EQ', 'NSE:COALINDIA-EQ',
  'NSE:ITC-EQ', 'NSE:BRITANNIA-EQ', 'NSE:JSWSTEEL-EQ', 'NSE:HINDUNILVR-EQ', 'NSE:EICHERMOT-EQ',
  'NSE:BHARTIARTL-EQ', 'NSE:AXISBANK-EQ', 'NSE:NESTLEIND-EQ', 'NSE:TITAN-EQ', 'NSE:KOTAKBANK-EQ',
  'NSE:TATASTEEL-EQ', 'NSE:BAJAJ-AUTO-EQ', 'NSE:HINDALCO-EQ', 'NSE:SBIN-EQ', 'NSE:M&M-EQ',
  'NSE:ASIANPAINT-EQ', 'NSE:HCLTECH-EQ', 'NSE:POWERGRID-EQ', 'NSE:BAJFINANCE-EQ', 'NSE:BAJAJFINSV-EQ',
  'NSE:TATAMOTORS-EQ', 'NSE:RELIANCE-EQ', 'NSE:GRASIM-EQ', 'NSE:MARUTI-EQ', 'NSE:WIPRO-EQ',
  'NSE:NTPC-EQ', 'NSE:ICICIBANK-EQ', 'NSE:INDUSINDBK-EQ', 'NSE:HDFCBANK-EQ', 'NSE:TCS-EQ',
  'NSE:SHREECEM-EQ', 'NSE:SUNPHARMA-EQ', 'NSE:ULTRACEMCO-EQ', 'NSE:ONGC-EQ', 'NSE:INFY-EQ',
  'NSE:TECHM-EQ', 'NSE:HEROMOTOCO-EQ', 'NSE:DIVISLAB-EQ', 'NSE:ADANIPORTS-EQ'
];

// Date range
const START_DATE = '2023-06-18';
const END_DATE = '2024-06-15';

// MongoDB Models
const DailyData = mongoose.model('DailyData', new mongoose.Schema({
  symbol: { type: String, required: true, index: true },
  date: { type: String, required: true, index: true },
  open: { type: Number, required: true },
  high: { type: Number, required: true },
  low: { type: Number, required: true },
  close: { type: Number, required: true },
  volume: { type: Number, required: true },
  timestamp: { type: Date, required: true }
}, { collection: '50stocksdailydata' }));

const WeeklyData = mongoose.model('WeeklyData', new mongoose.Schema({
  symbol: { type: String, required: true, index: true },
  week_start_date: { type: String, required: true, index: true },
  open: { type: Number, required: true },
  high: { type: Number, required: true },
  low: { type: Number, required: true },
  close: { type: Number, required: true },
  volume: { type: Number, required: true },
  candle_count: { type: Number, default: 1 }
}, { collection: '50stockweeklydata' }));

const HMASignal = mongoose.model('HMASignal', new mongoose.Schema({
  symbol: { type: String, required: true, index: true },
  hma_value: { type: Number, required: true },
  daily_signal: { type: String, enum: ['BUY', 'SELL', 'HOLD'], default: 'HOLD' },
  weekly_signal: { type: String, enum: ['BUY', 'SELL', 'HOLD'], default: 'HOLD' },
  last_daily_close: { type: Number, required: true },
  last_weekly_close: { type: Number, required: true },
  last_updated: { type: Date, default: Date.now }
}, { collection: '50stockshma' }));

class HistoricalDataDownloader {
  constructor() {
    this.accessToken = null;
    this.downloadedCount = 0;
    this.totalCount = STOCKS.length;
  }

  /**
   * Connect to MongoDB
   */
  async connectToMongo() {
    try {
      const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/victory';
      await mongoose.connect(mongoUri);
      console.log('✅ Connected to MongoDB');
    } catch (error) {
      console.error('❌ Failed to connect to MongoDB:', error);
      process.exit(1);
    }
  }

  /**
   * Get Fyers access token
   */
  async getAccessToken() {
    try {
      // Try environment variable first
      this.accessToken = process.env.FYERS_ACCESS_TOKEN;
      if (this.accessToken) {
        console.log('✅ Fyers access token loaded from environment variable');
        return;
      }

      // If not found, try to fetch from MongoDB User collection
      const user = await User.findOne({ 'fyers.accessToken': { $ne: null } });
      if (user && user.fyers && user.fyers.accessToken) {
        this.accessToken = user.fyers.accessToken;
        console.log(`✅ Fyers access token loaded from MongoDB user: ${user.email || user._id}`);
        return;
      }

      // If still not found, error out
      console.error('❌ Fyers access token not found in environment variable or MongoDB');
      process.exit(1);
    } catch (error) {
      console.error('❌ Failed to get access token:', error);
      process.exit(1);
    }
  }

  /**
   * Fetch historical data from Fyers API
   */
  async fetchHistoricalData(symbol) {
    try {
      console.log(`📊 Fetching data for ${symbol}...`);
      
      const requestData = {
        symbol: symbol,
        resolution: '1D', // Daily data
        date_format: "1",
        range_from: START_DATE,
        range_to: END_DATE,
        cont_flag: "1"
      };

      const response = await axios.get('https://api-t1.fyers.in/api/v3/data/history', {
        params: requestData,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'axios/1.10.0',
          'Authorization': `Bearer ${this.accessToken}`
        },
        timeout: 300000 // 5 minute timeout (10x increase for bulk data collection)
      });

      if (response.data.s !== 'ok' || !response.data.candles) {
        throw new Error(`Fyers API error: ${response.data.message || JSON.stringify(response.data)}`);
      }

      const candles = response.data.candles.map(candle => ({
        timestamp: new Date(candle[0] * 1000),
        date: new Date(candle[0] * 1000).toISOString().split('T')[0],
        open: candle[1],
        high: candle[2],
        low: candle[3],
        close: candle[4],
        volume: candle[5]
      }));

      console.log(`✅ Fetched ${candles.length} candles for ${symbol}`);
      return candles;
    } catch (error) {
      console.error(`❌ Failed to fetch data for ${symbol}:`, error.message);
      return [];
    }
  }

  /**
   * Compute weekly candles from daily data
   */
  computeWeeklyCandles(dailyCandles) {
    const weeklyMap = new Map();

    dailyCandles.forEach(candle => {
      const date = new Date(candle.date);
      const weekStart = this.getWeekStart(date);
      const weekKey = weekStart.toISOString().split('T')[0];

      if (!weeklyMap.has(weekKey)) {
        weeklyMap.set(weekKey, {
          symbol: candle.symbol,
          week_start_date: weekKey,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
          candle_count: 1
        });
      } else {
        const weekData = weeklyMap.get(weekKey);
        weekData.high = Math.max(weekData.high, candle.high);
        weekData.low = Math.min(weekData.low, candle.low);
        weekData.close = candle.close;
        weekData.volume += candle.volume;
        weekData.candle_count += 1;
      }
    });

    return Array.from(weeklyMap.values());
  }

  /**
   * Get week start date (Monday)
   */
  getWeekStart(date) {
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
    return new Date(date.setDate(diff));
  }

  /**
   * Calculate HMA and generate signals
   */
  calculateHMAAndSignals(dailyCandles, weeklyCandles) {
    if (dailyCandles.length === 0 || weeklyCandles.length === 0) {
      return null;
    }

    // Calculate HMA using the latest 55 weekly closes
    const weeklyCloses = weeklyCandles.map(candle => candle.close);
    const hmaValue = HMAService.calculateLatestHMA(weeklyCloses, 55);

    if (hmaValue === null) {
      console.log('⚠️ Could not calculate HMA - insufficient data');
      return null;
    }

    // Get latest closes
    const lastDailyClose = dailyCandles[dailyCandles.length - 1].close;
    const lastWeeklyClose = weeklyCandles[weeklyCandles.length - 1].close;

    // Generate signals
    const dailySignal = this.generateSignal(lastDailyClose, hmaValue);
    const weeklySignal = this.generateSignal(lastWeeklyClose, hmaValue);

    return {
      hma_value: hmaValue,
      daily_signal: dailySignal,
      weekly_signal: weeklySignal,
      last_daily_close: lastDailyClose,
      last_weekly_close: lastWeeklyClose
    };
  }

  /**
   * Generate signal based on price vs HMA
   */
  generateSignal(price, hmaValue) {
    if (price > hmaValue) {
      return 'BUY';
    } else if (price < hmaValue) {
      return 'SELL';
    } else {
      return 'HOLD';
    }
  }

  /**
   * Save data to MongoDB
   */
  async saveData(symbol, dailyCandles, weeklyCandles, hmaData) {
    try {
      // Save daily data
      for (const candle of dailyCandles) {
        await DailyData.findOneAndUpdate(
          { symbol: candle.symbol, date: candle.date },
          candle,
          { upsert: true }
        );
      }

      // Save weekly data
      for (const candle of weeklyCandles) {
        await WeeklyData.findOneAndUpdate(
          { symbol: candle.symbol, week_start_date: candle.week_start_date },
          candle,
          { upsert: true }
        );
      }

      // Save HMA data
      if (hmaData) {
        await HMASignal.findOneAndUpdate(
          { symbol },
          { ...hmaData, last_updated: new Date() },
          { upsert: true }
        );
      }

      console.log(`✅ Saved data for ${symbol}`);
    } catch (error) {
      console.error(`❌ Failed to save data for ${symbol}:`, error);
    }
  }

  /**
   * Process a single stock
   */
  async processStock(symbol) {
    try {
      console.log(`\n🔄 Processing ${symbol} (${++this.downloadedCount}/${this.totalCount})`);
      
      // Fetch historical data
      const dailyCandles = await this.fetchHistoricalData(symbol);
      if (dailyCandles.length === 0) {
        console.log(`⚠️ No data available for ${symbol}`);
        return;
      }

      // Add symbol to candles
      dailyCandles.forEach(candle => candle.symbol = symbol);

      // Compute weekly candles
      const weeklyCandles = this.computeWeeklyCandles(dailyCandles);
      console.log(`📈 Computed ${weeklyCandles.length} weekly candles`);

      // Calculate HMA and signals
      const hmaData = this.calculateHMAAndSignals(dailyCandles, weeklyCandles);
      if (hmaData) {
        console.log(`📊 HMA: ${hmaData.hma_value.toFixed(2)}, Daily: ${hmaData.daily_signal}, Weekly: ${hmaData.weekly_signal}`);
      }

      // Save to MongoDB
      await this.saveData(symbol, dailyCandles, weeklyCandles, hmaData);

      // Add delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (error) {
      console.error(`❌ Error processing ${symbol}:`, error);
    }
  }

  /**
   * Main execution function
   */
  async run() {
    console.log('🚀 Starting Historical Data Download');
    console.log(`📅 Date Range: ${START_DATE} to ${END_DATE}`);
    console.log(`📊 Total Stocks: ${STOCKS.length}`);
    console.log('');

    try {
      // Connect to MongoDB
      await this.connectToMongo();

      // Get access token
      await this.getAccessToken();

      // Process each stock
      for (const symbol of STOCKS) {
        await this.processStock(symbol);
      }

      console.log('\n✅ Historical data download completed!');
      console.log(`📊 Processed ${this.downloadedCount} stocks`);
      
    } catch (error) {
      console.error('❌ Script failed:', error);
    } finally {
      await mongoose.disconnect();
      console.log('🔌 Disconnected from MongoDB');
    }
  }
}

// Run the script if called directly
if (require.main === module) {
  const downloader = new HistoricalDataDownloader();
  downloader.run().catch(console.error);
}

module.exports = HistoricalDataDownloader; 