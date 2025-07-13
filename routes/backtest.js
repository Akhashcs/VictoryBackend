/**
 * Backtest Routes
 */
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { HMAService } = require('../services/hmaService');
const LoggerService = require('../services/loggerService');
const mongoose = require('mongoose');

// Backtest Schema for MongoDB
const backtestSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  symbol: { type: String, required: true },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  interval: { type: String, required: true },
  hmaPeriod: { type: Number, required: true },
  target: { type: Number, required: true },
  stopLoss: { type: Number, required: true },
  targetType: { type: String, enum: ['points', 'percentage'], default: 'points' },
  stopLossType: { type: String, enum: ['points', 'percentage'], default: 'points' },
  quantity: { type: Number, default: 1 },
  kpis: {
    totalTrades: Number,
    winCount: Number,
    lossCount: Number,
    winRate: Number,
    totalPnL: Number,
    avgPnL: Number,
    maxProfit: Number,
    maxLoss: Number,
    profitFactor: Number,
    sharpeRatio: Number,
    maxDrawdown: Number,
    requiredMargin: Number
  },
  trades: [{
    entryTime: Date,
    exitTime: Date,
    entryPrice: Number,
    exitPrice: Number,
    pnl: Number,
    pnlPercentage: Number,
    exitReason: String,
    duration: Number,
    targetPrice: Number,
    stopLossPrice: Number,
    quantity: Number
  }],
  createdAt: { type: Date, default: Date.now }
});

const Backtest = mongoose.model('Backtest', backtestSchema);

/**
 * @route   POST /api/backtest/test-fyers
 * @desc    Test Fyers API connection
 * @access  Private
 */
router.post('/test-fyers', auth, async (req, res) => {
  try {
    const user = req.user;
    
    if (!user || !user.fyers || !user.fyers.accessToken) {
      return res.status(401).json({
        success: false,
        message: 'No valid Fyers access token found. Please login to Fyers first.'
      });
    }
    
    const appId = process.env.FYERS_APP_ID || 'XJFL311ATX-100';
    const accessToken = `${appId}:${user.fyers.accessToken}`;
    
    const testResult = await HMAService.testFyersConnection(accessToken);
    
    return res.json({
      success: true,
      data: testResult
    });
    
  } catch (error) {
    console.error('❌ Backtest: Error testing Fyers connection:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to test Fyers connection',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/backtest/fetch-historical-data
 * @desc    Fetch historical data for backtesting using Fyers API
 * @access  Private
 */
router.post('/fetch-historical-data', auth, async (req, res) => {
  try {
    const { symbol, quantity = 1, startDate, endDate, interval, hmaPeriod = 55 } = req.body;
    const userId = req.user.id;

    // Validate required fields
    if (!symbol || !startDate || !endDate || !interval) {
      return res.status(400).json({
        success: false,
        message: 'Symbol, startDate, endDate, and interval are required'
      });
    }

    console.log(`📊 Backtest: Fetching historical data for ${symbol} from ${startDate} to ${endDate} with interval ${interval}`);

    // Get user's Fyers access token
    const User = require('../models/User');
    const user = await User.findById(userId);
    
    if (!user || !user.fyers || !user.fyers.accessToken) {
      console.log('❌ Backtest: No valid Fyers access token found');
      console.log('  User exists:', !!user);
      console.log('  User.fyers exists:', !!user?.fyers);
      console.log('  User.fyers.accessToken exists:', !!user?.fyers?.accessToken);
      return res.status(401).json({
        success: false,
        message: 'No valid Fyers access token found. Please login to Fyers first.'
      });
    }
    
    console.log('✅ Backtest: User has valid Fyers connection');
    console.log('  User ID:', user.id);
    console.log('  Fyers access token exists:', !!user.fyers.accessToken);

    // Construct access token
    const appId = process.env.FYERS_APP_ID || 'XJFL311ATX-100';
    const accessToken = `${appId}:${user.fyers.accessToken}`;
    
    // Debug access token construction
    console.log('🔍 Backtest: Debugging access token:');
    console.log('  App ID:', appId);
    console.log('  User token length:', user.fyers.accessToken ? user.fyers.accessToken.length : 'null');
    console.log('  User token starts with:', user.fyers.accessToken ? user.fyers.accessToken.substring(0, 10) + '...' : 'null');
    console.log('  Combined token length:', accessToken.length);
    console.log('  Combined token starts with:', accessToken.substring(0, 20) + '...');

    // Fetch historical data using enhanced HMAService with prefill
    const historicalData = await HMAService.fetchHistoricalDataForBacktest(symbol, accessToken, {
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      interval: interval,
      hmaPeriod: hmaPeriod // Use the provided HMA period for prefill calculation
    });

    if (!historicalData || historicalData.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No historical data found for the specified symbol and date range'
      });
    }

    console.log(`✅ Backtest: Successfully fetched ${historicalData.length} candles for ${symbol}`);

    return res.json({
      success: true,
      data: {
        symbol,
        quantity,
        candles: historicalData,
        count: historicalData.length,
        startDate: historicalData[0]?.timestamp,
        endDate: historicalData[historicalData.length - 1]?.timestamp,
        interval: interval
      }
    });

  } catch (error) {
    console.error('❌ Backtest: Error fetching historical data:', error);
    
    // Handle specific Fyers API errors
    let errorMessage = 'Failed to fetch historical data';
    if (error.message.includes('Invalid symbol')) {
      errorMessage = 'Invalid symbol. Please check the symbol format. Use index symbols like NSE:NIFTY50-INDEX or equity symbols like NSE:SBIN-EQ.';
    } else if (error.message.includes('No data available')) {
      errorMessage = 'No data available for the specified date range. Please check if the market was open during this period.';
    } else if (error.message.includes('Date range too large')) {
      errorMessage = 'Date range is too large. Please select a smaller range (max 366 days for daily data).';
    } else if (error.message.includes('Market closed')) {
      errorMessage = 'Market was closed during the specified date range.';
    } else if (error.message.includes('Invalid date')) {
      errorMessage = 'Invalid date format. Please check your date inputs.';
    } else if (error.message.includes('Access token')) {
      errorMessage = 'Invalid access token. Please reconnect to Fyers.';
    } else if (error.message.includes('options/futures symbol')) {
      errorMessage = 'Options and futures symbols are not supported for backtesting. Please use index or equity symbols.';
    }

    return res.status(500).json({
      success: false,
      message: errorMessage,
      error: error.message
    });
  }
});

/**
 * @route   POST /api/backtest/execute
 * @desc    Execute backtest with HMA strategy
 * @access  Private
 */
router.post('/execute', auth, async (req, res) => {
  try {
    const { 
      symbol, 
      quantity = 1,
      startDate, 
      endDate, 
      interval, 
      hmaPeriod, 
      target, 
      stopLoss,
      targetType = 'points',
      stopLossType = 'points',
      candles 
    } = req.body;
    const userId = req.user.id;

    // Validate required fields
    if (!symbol || !hmaPeriod || !target || !stopLoss) {
      return res.status(400).json({
        success: false,
        message: 'Symbol, HMA period, target, and stop loss are required'
      });
    }

    // Validate candles array
    if (!candles || !Array.isArray(candles) || candles.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Historical data (candles) is required. Please fetch historical data first.'
      });
    }

    console.log(`🔍 Backtest: Received ${candles.length} candles for execution`);

    console.log(`🧪 Backtest: Executing backtest for ${symbol} with HMA-${hmaPeriod}, Target: ${target}${targetType === 'percentage' ? '%' : ' points'}, SL: ${stopLoss}${stopLossType === 'percentage' ? '%' : ' points'}`);

    // Calculate HMA values with prefill functionality
    // The candles already include prefill data from fetchHistoricalDataForBacktest
    const hmaValues = HMAService.calculateHMAWithPrefill(candles, hmaPeriod, 'close', hmaPeriod);
    
    // Filter out null values (beginning of data where HMA is not available)
    // Temporarily removed market hours filtering to debug
    const validData = candles.map((candle, index) => ({
      ...candle,
      hma: hmaValues[index],
      originalIndex: index // Add index to the item for debugging
    })).filter(item => {
      if (item.hma === null) return false;
      
      // Debug logging for first few candles
      if (item.originalIndex < 10) {
        const istTime = new Date(item.timestamp + (5.5 * 60 * 60 * 1000));
        console.log(`🔍 Candle ${item.originalIndex}: ${istTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} - HMA: ${item.hma}`);
      }
      
      return true; // Accept all candles with valid HMA
    });

    console.log(`🔍 Backtest: Total candles: ${candles.length}, Valid data with HMA: ${validData.length}`);
    
    if (validData.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient data for HMA calculation'
      });
    }

    // Execute backtest strategy with enhanced logic
    const results = executeEnhancedBacktestStrategy(validData, {
      symbol,
      quantity: parseInt(quantity),
      hmaPeriod,
      target: parseFloat(target),
      stopLoss: parseFloat(stopLoss),
      targetType,
      stopLossType
    });

    console.log(`✅ Backtest: Completed for ${symbol}. Trades: ${results.trades.length}, PnL: ${results.totalPnL}`);

    return res.json({
      success: true,
      data: results
    });

  } catch (error) {
    console.error('❌ Backtest: Error executing backtest:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to execute backtest',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/backtest/save
 * @desc    Save backtest results to MongoDB
 * @access  Private
 */
router.post('/save', auth, async (req, res) => {
  try {
    const { name, backtestData } = req.body;
    const userId = req.user.id;

    if (!name || !backtestData) {
      return res.status(400).json({
        success: false,
        message: 'Name and backtest data are required'
      });
    }

    // Check if name already exists for this user
    const existingBacktest = await Backtest.findOne({ userId, name });
    if (existingBacktest) {
      return res.status(400).json({
        success: false,
        message: 'A backtest with this name already exists'
      });
    }

    const backtest = new Backtest({
      userId,
      name,
      symbol: backtestData.symbol,
      startDate: new Date(backtestData.startDate),
      endDate: new Date(backtestData.endDate),
      interval: backtestData.interval,
      hmaPeriod: backtestData.hmaPeriod,
      target: backtestData.target,
      stopLoss: backtestData.stopLoss,
      targetType: backtestData.targetType,
      stopLossType: backtestData.stopLossType,
      quantity: backtestData.quantity,
      kpis: backtestData.kpis,
      trades: backtestData.trades
    });

    await backtest.save();

    console.log(`💾 Backtest saved: ${name} for user ${userId}`);

    return res.json({
      success: true,
      message: 'Backtest saved successfully',
      data: { id: backtest._id, name: backtest.name }
    });

  } catch (error) {
    console.error('❌ Backtest: Error saving backtest:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to save backtest',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/backtest/saved
 * @desc    Get all saved backtests for user
 * @access  Private
 */
router.get('/saved', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const backtests = await Backtest.find({ userId })
      .select('name symbol startDate endDate interval hmaPeriod target stopLoss targetType stopLossType quantity kpis createdAt')
      .sort({ createdAt: -1 });

    return res.json({
      success: true,
      data: backtests
    });

  } catch (error) {
    console.error('❌ Backtest: Error fetching saved backtests:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch saved backtests',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/backtest/saved/:id
 * @desc    Get specific saved backtest details
 * @access  Private
 */
router.get('/saved/:id', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const backtestId = req.params.id;

    const backtest = await Backtest.findOne({ _id: backtestId, userId });
    
    if (!backtest) {
      return res.status(404).json({
        success: false,
        message: 'Backtest not found'
      });
    }

    return res.json({
      success: true,
      data: backtest
    });

  } catch (error) {
    console.error('❌ Backtest: Error fetching backtest details:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch backtest details',
      error: error.message
    });
  }
});

/**
 * @route   DELETE /api/backtest/saved/:id
 * @desc    Delete specific saved backtest
 * @access  Private
 */
router.delete('/saved/:id', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const backtestId = req.params.id;

    const backtest = await Backtest.findOne({ _id: backtestId, userId });
    
    if (!backtest) {
      return res.status(404).json({
        success: false,
        message: 'Backtest not found'
      });
    }

    await Backtest.findByIdAndDelete(backtestId);

    console.log(`🗑️ Backtest deleted: ${backtest.name} for user ${userId}`);

    return res.json({
      success: true,
      message: 'Backtest deleted successfully'
    });

  } catch (error) {
    console.error('❌ Backtest: Error deleting backtest:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete backtest',
      error: error.message
    });
  }
});

/**
 * Execute enhanced backtest strategy with percentage support
 * @param {Array} data - Historical data with HMA values
 * @param {Object} params - Strategy parameters
 * @returns {Object} Backtest results
 */
function executeEnhancedBacktestStrategy(data, params) {
  const { symbol, quantity = 1, hmaPeriod, target, stopLoss, targetType, stopLossType } = params;
  const trades = [];
  let currentPosition = null;
  let totalPnL = 0;
  let winCount = 0;
  let lossCount = 0;
  let maxDrawdown = 0;
  let peakValue = 0;
  let runningPnL = 0;
  let maxEntryPrice = 0;
  let entrySignals = 0; // Count of HMA crossover entry signals
  
  console.log(`🔍 Backtest: Processing ${data.length} candles for ${symbol}`);
  console.log(`🔍 Backtest: First candle: ${new Date(data[0].timestamp + (5.5 * 60 * 60 * 1000)).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
  console.log(`🔍 Backtest: Last candle: ${new Date(data[data.length - 1].timestamp + (5.5 * 60 * 60 * 1000)).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
  
  // Debug: Check a few candles to see the data structure
  console.log(`🔍 Backtest: Sample candles:`);
  for (let i = 0; i < Math.min(5, data.length); i++) {
    const candle = data[i];
    const istTime = new Date(candle.timestamp + (5.5 * 60 * 60 * 1000));
    console.log(`  Candle ${i}: ${istTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} - Close: ${candle.close}, HMA: ${candle.hma}`);
  }

  for (let i = 1; i < data.length; i++) {
    const current = data[i];
    const previous = data[i - 1];
    
    // Check for end of day exit (3:20 PM IST on the same day as entry)
    const currentTimeIST = new Date(current.timestamp + (5.5 * 60 * 60 * 1000));
    const isEndOfDay = currentTimeIST.getHours() === 15 && currentTimeIST.getMinutes() >= 20;
    
    // Entry condition: LTP crosses above HMA (long strategy)
    if (previous.close <= previous.hma && current.close > current.hma) {
      if (!currentPosition) {
        // Enter long position at next candle open
        const entryPrice = current.open;
        if (entryPrice > maxEntryPrice) maxEntryPrice = entryPrice;
        const targetPrice = targetType === 'percentage' 
          ? entryPrice * (1 + target / 100)
          : entryPrice + target;
        const stopLossPrice = stopLossType === 'percentage'
          ? entryPrice * (1 - stopLoss / 100)
          : entryPrice - stopLoss;

        // Convert UTC timestamp to IST for logging (current.timestamp is already in UTC)
        const entryTimeIST = new Date(current.timestamp + (5.5 * 60 * 60 * 1000));
        currentPosition = {
          entryPrice,
          entryTime: current.timestamp,
          entryTimeIST: entryTimeIST.toISOString(),
          entryIndex: i,
          targetPrice,
          stopLossPrice,
          quantity,
          entryDateIST: entryTimeIST.toDateString() // Store entry date for end-of-day check
        };
        entrySignals++; // Count this as an entry signal
        console.log(`📈 Entry: ${symbol} at ${entryPrice} (HMA: ${current.hma}) at ${entryTimeIST.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
        
        // Skip exit condition checks for this candle since we just entered
        continue;
      }
    }
    
    // Exit conditions if we have a position (only check after entry is established)
    if (currentPosition) {
      const entryPrice = currentPosition.entryPrice;
      const currentPrice = current.close;
      const pnl = (currentPrice - entryPrice) * quantity;
      const pnlPercentage = ((currentPrice - entryPrice) / entryPrice) * 100;
      
      // Check for target hit
      if (currentPrice >= currentPosition.targetPrice) {
        const targetPrice = currentPosition.targetPrice;
        const stopLossPrice = currentPosition.stopLossPrice;
        const pnl = (targetPrice - entryPrice) * quantity;
        
        // Convert timestamps to IST (current.timestamp is already in UTC)
        const exitTimeIST = new Date(current.timestamp + (5.5 * 60 * 60 * 1000));
        const duration = current.timestamp - currentPosition.entryTime;
        
        // Skip trades with 0 duration (entry and exit in same candle)
        if (duration === 0) {
          console.log(`⚠️ Skipping trade with 0 duration - Entry and exit in same candle at ${exitTimeIST.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
          currentPosition = null;
          continue;
        }
        
        trades.push({
          entryPrice,
          exitPrice: targetPrice,
          entryTime: currentPosition.entryTime,
          entryTimeIST: currentPosition.entryTimeIST,
          exitTime: current.timestamp,
          exitTimeIST: exitTimeIST.toISOString(),
          pnl,
          pnlPercentage: ((targetPrice - entryPrice) / entryPrice) * 100,
          exitReason: 'TARGET',
          duration: duration,
          targetPrice,
          stopLossPrice,
          quantity
        });
        totalPnL += pnl;
        winCount++;
        console.log(`🎯 Target hit: ${symbol} at ${targetPrice} (PnL: +${pnl.toFixed(2)}) at ${exitTimeIST.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
        currentPosition = null;
      }
      // Check for stop loss hit
      else if (currentPrice <= currentPosition.stopLossPrice) {
        const targetPrice = currentPosition.targetPrice;
        const stopLossPrice = currentPosition.stopLossPrice;
        const pnl = (stopLossPrice - entryPrice) * quantity;
        
        // Convert timestamps to IST (current.timestamp is already in UTC)
        const exitTimeIST = new Date(current.timestamp + (5.5 * 60 * 60 * 1000));
        const duration = current.timestamp - currentPosition.entryTime;
        
        // Skip trades with 0 duration (entry and exit in same candle)
        if (duration === 0) {
          console.log(`⚠️ Skipping trade with 0 duration - Entry and exit in same candle at ${exitTimeIST.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
          currentPosition = null;
          continue;
        }
        
        trades.push({
          entryPrice,
          exitPrice: stopLossPrice,
          entryTime: currentPosition.entryTime,
          entryTimeIST: currentPosition.entryTimeIST,
          exitTime: current.timestamp,
          exitTimeIST: exitTimeIST.toISOString(),
          pnl,
          pnlPercentage: ((stopLossPrice - entryPrice) / entryPrice) * 100,
          exitReason: 'STOP_LOSS',
          duration: duration,
          targetPrice,
          stopLossPrice,
          quantity
        });
        totalPnL += pnl;
        lossCount++;
        console.log(`🛑 Stop loss hit: ${symbol} at ${stopLossPrice} (PnL: ${pnl.toFixed(2)}) at ${exitTimeIST.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
        currentPosition = null;
      }
      // Check for end of day exit (3:20 PM IST on the SAME DAY as entry)
      else if (isEndOfDay && currentPosition) {
        // Check if current date is the same as entry date
        const currentDateIST = currentTimeIST.toDateString();
        const isSameDay = currentDateIST === currentPosition.entryDateIST;
        
        if (isSameDay) {
        const targetPrice = currentPosition.targetPrice;
        const stopLossPrice = currentPosition.stopLossPrice;
        const exitPrice = current.close; // Exit at current close price
        const pnl = (exitPrice - entryPrice) * quantity;
        
        // Convert timestamps to IST (current.timestamp is already in UTC)
        const exitTimeIST = new Date(current.timestamp + (5.5 * 60 * 60 * 1000));
          const duration = current.timestamp - currentPosition.entryTime;
          
          // Skip trades with 0 duration (entry and exit in same candle)
          if (duration === 0) {
            console.log(`⚠️ Skipping trade with 0 duration - Entry and exit in same candle at ${exitTimeIST.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
            currentPosition = null;
            continue;
          }
          
        trades.push({
          entryPrice,
          exitPrice: exitPrice,
          entryTime: currentPosition.entryTime,
          entryTimeIST: currentPosition.entryTimeIST,
          exitTime: current.timestamp,
          exitTimeIST: exitTimeIST.toISOString(),
          pnl,
          pnlPercentage: ((exitPrice - entryPrice) / entryPrice) * 100,
          exitReason: 'END_OF_DAY',
            duration: duration,
          targetPrice,
          stopLossPrice,
          quantity
        });
        totalPnL += pnl;
        if (pnl > 0) winCount++;
        else lossCount++;
        console.log(`🌅 End of day exit: ${symbol} at ${exitPrice} (PnL: ${pnl.toFixed(2)}) at ${exitTimeIST.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
        currentPosition = null;
        } else {
          // Debug: Log when we're at 3:20 PM but it's a different day
          console.log(`🔍 At 3:20 PM but different day - Entry: ${currentPosition.entryDateIST}, Current: ${currentDateIST}`);
        }
      }
      // Debug: Log when we're close to stop loss but not hitting it
      else if (currentPosition && currentPrice <= currentPosition.stopLossPrice * 1.01) { // Within 1% of stop loss
        console.log(`🔍 Close to stop loss: ${symbol} at ${currentPrice} (Stop: ${currentPosition.stopLossPrice}) at ${new Date(current.timestamp + (5.5 * 60 * 60 * 1000)).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
      }
    }

    // Update running PnL and drawdown calculations
    runningPnL = totalPnL;
    if (runningPnL > peakValue) {
      peakValue = runningPnL;
    }
    const currentDrawdown = peakValue - runningPnL;
    if (currentDrawdown > maxDrawdown) {
      maxDrawdown = currentDrawdown;
    }
  }

      // Close any remaining position at the end
    if (currentPosition) {
      const lastPrice = data[data.length - 1].close;
      const pnl = (lastPrice - currentPosition.entryPrice) * quantity;
      // Convert timestamps to IST (timestamp is already in UTC)
      const exitTimeIST = new Date(data[data.length - 1].timestamp + (5.5 * 60 * 60 * 1000));
      const duration = data[data.length - 1].timestamp - currentPosition.entryTime;
      
      // Skip trades with 0 duration (entry and exit in same candle)
      if (duration === 0) {
        console.log(`⚠️ Skipping trade with 0 duration - Entry and exit in same candle at ${exitTimeIST.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
      } else {
      trades.push({
        entryPrice: currentPosition.entryPrice,
        exitPrice: lastPrice,
        entryTime: currentPosition.entryTime,
        entryTimeIST: currentPosition.entryTimeIST,
        exitTime: data[data.length - 1].timestamp,
        exitTimeIST: exitTimeIST.toISOString(),
        pnl,
        pnlPercentage: ((lastPrice - currentPosition.entryPrice) / currentPosition.entryPrice) * 100,
        exitReason: 'END_OF_DATA',
          duration: duration,
        targetPrice: currentPosition.targetPrice,
        stopLossPrice: currentPosition.stopLossPrice,
        quantity
      });
    totalPnL += pnl;
    if (pnl > 0) winCount++;
    else lossCount++;
      }
  }

  const totalTrades = trades.length;
  const completedTrades = trades.length;
  const openTrades = entrySignals - completedTrades;
  const winRate = totalTrades > 0 ? (winCount / totalTrades) * 100 : 0;
  const avgPnL = totalTrades > 0 ? totalPnL / totalTrades : 0;
  
  // Calculate additional KPIs
  const profitableTrades = trades.filter(t => t.pnl > 0);
  const losingTrades = trades.filter(t => t.pnl < 0);
  const grossProfit = profitableTrades.reduce((sum, t) => sum + t.pnl, 0);
  const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : 0;
  
  // Calculate Sharpe Ratio (simplified)
  const returns = trades.map(t => t.pnlPercentage);
  const avgReturn = returns.length > 0 ? returns.reduce((sum, r) => sum + r, 0) / returns.length : 0;
  const variance = returns.length > 0 ? returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length : 0;
  const sharpeRatio = variance > 0 ? avgReturn / Math.sqrt(variance) : 0;

  // Calculate required margin (assume 20% of max entry value)
  const requiredMargin = maxEntryPrice * quantity * 0.2;

  return {
    symbol,
    quantity,
    hmaPeriod,
    target,
    stopLoss,
    targetType,
    stopLossType,
    totalTrades,
    entrySignals,
    completedTrades,
    openTrades,
    winCount,
    lossCount,
    winRate,
    totalPnL,
    avgPnL,
    maxDrawdown,
    profitFactor,
    sharpeRatio,
    requiredMargin,
    trades,
    kpis: {
      totalTrades,
      entrySignals,
      completedTrades,
      openTrades,
      winCount,
      lossCount,
      winRate: winRate.toFixed(2),
      totalPnL: totalPnL.toFixed(2),
      avgPnL: avgPnL.toFixed(2),
      maxProfit: Math.max(...trades.map(t => t.pnl), 0),
      maxLoss: Math.min(...trades.map(t => t.pnl), 0),
      profitFactor: profitFactor.toFixed(2),
      sharpeRatio: sharpeRatio.toFixed(2),
      maxDrawdown: maxDrawdown.toFixed(2),
      requiredMargin: requiredMargin.toFixed(2)
    }
  };
}

module.exports = router; 