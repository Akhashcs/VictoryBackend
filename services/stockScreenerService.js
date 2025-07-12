const mongoose = require('mongoose');
const LoggerService = require('./loggerService');
const { HMAService } = require('./hmaService');
const { MarketDataService } = require('./marketDataService');

// Import models
const HMASignal = require('../models/HMASignal');
const ActivePosition = require('../models/ActivePosition');
const ExitLog = require('../models/ExitLog');
const WeeklyCandle = require('../models/WeeklyCandle');
const DailyCandle = require('../models/DailyCandle');
const User = require('../models/User');

class StockScreenerService {

  // Signal Engine Methods
  async getSignals(userId) {
    try {
      const signals = await HMASignal.find({ userId }).sort({ lastUpdated: -1 });
      return signals;
    } catch (error) {
      LoggerService.error('StockScreenerService', 'Error fetching signals:', error);
      throw error;
    }
  }

  async getSignalsByFilter(userId, filter) {
    try {
      const query = { userId };
      
      if (filter.signalType) {
        query.signalType = filter.signalType;
      }
      
      if (filter.symbol) {
        query.symbol = { $regex: filter.symbol, $options: 'i' };
      }

      const signals = await HMASignal.find(query).sort({ lastUpdated: -1 });
      return signals;
    } catch (error) {
      LoggerService.error('StockScreenerService', 'Error fetching filtered signals:', error);
      throw error;
    }
  }

  // Active Positions Methods
  async getActivePositions(userId) {
    try {
      const positions = await ActivePosition.find({ userId }).sort({ buyDate: -1 });
      
      // Update current prices and P&L for each position
      const updatedPositions = await Promise.all(
        positions.map(async (position) => {
                    try {
            // Get current price from historical data
            const historicalData = await MarketDataService.fetchHistoricalData(position.symbol, '1d', 1);
            const currentPrice = historicalData && historicalData.length > 0 ? historicalData[historicalData.length - 1].close : position.buy_price;
            
            // Calculate P&L
            const pnl = (currentPrice - position.buy_price) * position.quantity;
            const pnlPercent = ((currentPrice - position.buy_price) / position.buy_price) * 100;
            
                    // Get HMA value and signal
        const hmaSignal = await HMASignal.findOne({ userId, symbol: position.symbol });
        
        return {
          ...position.toObject(),
          currentPrice,
          pnl,
          pnlPercent,
          hmaValue: hmaSignal?.hma_value,
          signal: hmaSignal?.signal_type
        };
          } catch (error) {
            LoggerService.error('StockScreenerService', `Error updating position ${position.symbol}:`, error);
            return position.toObject();
          }
        })
      );

      return updatedPositions;
    } catch (error) {
      LoggerService.error('StockScreenerService', 'Error fetching active positions:', error);
      throw error;
    }
  }

  async addActivePosition(userId, positionData) {
    try {
      const position = new ActivePosition({
        userId,
        symbol: positionData.symbol,
        buy_price: parseFloat(positionData.buyPrice),
        buy_date: new Date(positionData.buyDate),
        quantity: parseInt(positionData.quantity)
      });

      await position.save();
      LoggerService.info('StockScreenerService', `Added active position for ${positionData.symbol}`);
      return position;
    } catch (error) {
      LoggerService.error('StockScreenerService', 'Error adding active position:', error);
      throw error;
    }
  }

  async updateActivePosition(userId, positionId, updateData) {
    try {
      const position = await ActivePosition.findOneAndUpdate(
        { _id: positionId, userId },
        updateData,
        { new: true }
      );

      if (!position) {
        throw new Error('Position not found');
      }

      LoggerService.info('StockScreenerService', `Updated active position ${position.symbol}`);
      return position;
    } catch (error) {
      LoggerService.error('StockScreenerService', 'Error updating active position:', error);
      throw error;
    }
  }

  async exitPosition(userId, positionId, exitData) {
    try {
      const position = await ActivePosition.findOne({ _id: positionId, userId });
      
      if (!position) {
        throw new Error('Position not found');
      }

      // Create exit log entry
      const exitLog = new ExitLog({
        userId,
        symbol: position.symbol,
        buy_price: position.buy_price,
        buy_date: position.buy_date,
        sell_price: exitData.sellPrice,
        sell_date: new Date(exitData.sellDate),
        quantity: position.quantity,
        exit_reason: exitData.exitReason,
        holding_days: Math.ceil((new Date(exitData.sellDate) - position.buy_date) / (1000 * 60 * 60 * 24)),
        pnl_amount: (exitData.sellPrice - position.buy_price) * position.quantity,
        pnl_percentage: ((exitData.sellPrice - position.buy_price) / position.buy_price) * 100
      });

      await exitLog.save();

      // Delete the active position
      await ActivePosition.findByIdAndDelete(positionId);

      LoggerService.info('StockScreenerService', `Exited position ${position.symbol}`);
      return exitLog;
    } catch (error) {
      LoggerService.error('StockScreenerService', 'Error exiting position:', error);
      throw error;
    }
  }

  async deleteActivePosition(userId, positionId) {
    try {
      const position = await ActivePosition.findOneAndDelete({ _id: positionId, userId });
      
      if (!position) {
        throw new Error('Position not found');
      }

      LoggerService.info('StockScreenerService', `Deleted active position ${position.symbol}`);
      return { message: 'Position deleted successfully' };
    } catch (error) {
      LoggerService.error('StockScreenerService', 'Error deleting active position:', error);
      throw error;
    }
  }

  // Exit Log Methods
  async getExitLog(userId) {
    try {
      const exitLog = await ExitLog.find({ userId }).sort({ sellDate: -1 });
      return exitLog;
    } catch (error) {
      LoggerService.error('StockScreenerService', 'Error fetching exit log:', error);
      throw error;
    }
  }

  async getExitLogByDateRange(userId, startDate, endDate) {
    try {
      const exitLog = await ExitLog.find({
        userId,
        sellDate: {
          $gte: new Date(startDate),
          $lte: new Date(endDate)
        }
      }).sort({ sellDate: -1 });
      
      return exitLog;
    } catch (error) {
      LoggerService.error('StockScreenerService', 'Error fetching exit log by date range:', error);
      throw error;
    }
  }

  // Portfolio Summary Methods
  async getPortfolioSummary(userId) {
    try {
      const activePositions = await ActivePosition.find({ userId });
      const exitLog = await ExitLog.find({ userId });

      // Calculate active positions summary
      const totalInvested = activePositions.reduce((sum, pos) => sum + (pos.buy_price * pos.quantity), 0);
      const totalCurrentValue = activePositions.reduce((sum, pos) => {
        // This would need to be updated with current prices
        return sum + (pos.buy_price * pos.quantity); // Placeholder
      }, 0);
      
      const totalPnL = totalCurrentValue - totalInvested;
      const totalPnLPercent = totalInvested > 0 ? (totalPnL / totalInvested) * 100 : 0;
      
      const winningPositions = activePositions.filter(pos => {
        // This would need current price comparison
        return pos.buyPrice > 0; // Placeholder
      }).length;
      
      const losingPositions = activePositions.length - winningPositions;

      // Calculate exit log summary
      const totalExitPnL = exitLog.reduce((sum, trade) => sum + trade.pnl_amount, 0);
      const winningTrades = exitLog.filter(trade => trade.pnl_amount > 0).length;
      const totalTrades = exitLog.length;
      const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

      return {
        activePositions: activePositions.length,
        winningPositions,
        losingPositions,
        totalInvested,
        totalCurrentValue,
        totalPnL,
        totalPnLPercent,
        totalExitPnL,
        totalTrades,
        winningTrades,
        winRate
      };
    } catch (error) {
      LoggerService.error('StockScreenerService', 'Error calculating portfolio summary:', error);
      throw error;
    }
  }

  // Data Collection Methods
  async getDataCollectionStatus(userId) {
    try {
      const user = await User.findById(userId);
      if (!user || !user.fyersAccessToken) {
        return { status: 'no_token', message: 'Fyers access token not available' };
      }

      // Check if we have recent data for the stock list
      const stockList = await this.getStockList(userId);
      const dataStatus = {};

      for (const symbol of stockList) {
        const latestCandle = await WeeklyCandle.findOne({ symbol }).sort({ weekStartDate: -1 });
        dataStatus[symbol] = {
          hasData: !!latestCandle,
          lastUpdate: latestCandle?.weekStartDate || null,
          weeksAvailable: latestCandle ? await WeeklyCandle.countDocuments({ symbol }) : 0
        };
      }

      return {
        status: 'available',
        dataStatus,
        totalSymbols: stockList.length,
        symbolsWithData: Object.values(dataStatus).filter(status => status.hasData).length
      };
    } catch (error) {
      LoggerService.error('StockScreenerService', 'Error getting data collection status:', error);
      throw error;
    }
  }

  async triggerDataCollection(userId) {
    try {
      console.log(`[StockScreenerService] Starting data collection for user: ${userId}`);
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }
      console.log(`[StockScreenerService] User found: ${user.email}, Fyers token: ${user.fyers?.accessToken ? 'Present' : 'Missing'}`);
      if (!user.fyers?.accessToken) {
        throw new Error('Fyers connection required. Please connect to Fyers first to collect market data.');
      }

      const stockList = await this.getStockList(userId);
      LoggerService.info('StockScreenerService', `Starting data collection for ${stockList.length} symbols`);

      // Collect data in phases of 366 days as per Fyers API limits
      const results = [];
      
      for (const symbol of stockList) {
        try {
          // Check if we need to collect data for this symbol
                  const latestCandle = await WeeklyCandle.findOne({ userId, symbol }).sort({ week_start_date: -1 });
        const needsData = !latestCandle || 
          (new Date() - new Date(latestCandle.week_start_date)) > (7 * 24 * 60 * 60 * 1000); // 7 days

          if (needsData) {
            const result = await this.collectDataForSymbol(userId, symbol);
            results.push({ symbol, status: 'success', ...result });
          } else {
            results.push({ symbol, status: 'up_to_date' });
          }
        } catch (error) {
          LoggerService.error('StockScreenerService', `Error collecting data for ${symbol}:`, error);
          results.push({ symbol, status: 'error', error: error.message });
        }
      }

      return {
        message: 'Data collection completed',
        results,
        totalProcessed: stockList.length,
        successful: results.filter(r => r.status === 'success').length,
        errors: results.filter(r => r.status === 'error').length
      };
    } catch (error) {
      LoggerService.error('StockScreenerService', 'Error triggering data collection:', error);
      throw error;
    }
  }

  // Helper to convert UTC timestamp (ms) to IST Date
  convertUTCToIST(dateOrTimestamp) {
    // Accepts JS Date or timestamp in ms
    const date = (dateOrTimestamp instanceof Date) ? dateOrTimestamp : new Date(dateOrTimestamp);
    // Add 5 hours 30 minutes
    return new Date(date.getTime() + (5.5 * 60 * 60 * 1000));
  }

  convertDailyToWeekly(dailyCandles) {
    const weeklyCandles = [];
    const weeklyGroups = {};

    // Group daily candles by IST week (Monday to Friday, IST)
    dailyCandles.forEach(candle => {
      // Handle both array format (old) and object format (new)
      let timestamp, open, high, low, close, volume;
      
      if (Array.isArray(candle)) {
        // Old format: [timestamp, open, high, low, close, volume]
        [timestamp, open, high, low, close, volume] = candle;
      } else {
        // New format: { timestamp, open, high, low, close, volume }
        timestamp = candle.timestamp;
        open = candle.open;
        high = candle.high;
        low = candle.low;
        close = candle.close;
        volume = candle.volume;
      }
      // Convert UTC timestamp to IST before grouping
      const istDate = this.convertUTCToIST(timestamp);
      const weekStart = this.getWeekStart(istDate);
      const weekKey = weekStart.toISOString().split('T')[0];

      if (!weeklyGroups[weekKey]) {
        weeklyGroups[weekKey] = {
          week_start_date: weekStart.toISOString().split('T')[0],
          open: open,
          high: high,
          low: low,
          close: close,
          volume: volume
        };
      } else {
        weeklyGroups[weekKey].high = Math.max(weeklyGroups[weekKey].high, high);
        weeklyGroups[weekKey].low = Math.min(weeklyGroups[weekKey].low, low);
        weeklyGroups[weekKey].close = close;
        weeklyGroups[weekKey].volume += volume;
      }
    });

    // Convert to array and sort by date
    const sortedWeeklyCandles = Object.values(weeklyGroups).sort((a, b) => new Date(a.week_start_date) - new Date(b.week_start_date));
    
    // Calculate HMA for each weekly candle using rolling 55-week window
    const hmaPeriod = 55;
    const weeklyCandlesWithHMA = [];
    
    for (let i = 0; i < sortedWeeklyCandles.length; i++) {
      const currentCandle = sortedWeeklyCandles[i];
      
      // Calculate HMA if we have enough data (need at least 55 weeks)
      let hmaValue = null;
      if (i >= hmaPeriod - 1) {
        // Get the last 55 closes for HMA calculation
        const closes = sortedWeeklyCandles
          .slice(i - hmaPeriod + 1, i + 1)
          .map(candle => candle.close);
        
        hmaValue = HMAService.calculateLatestHMA(closes, hmaPeriod);
      }
      
      weeklyCandlesWithHMA.push({
        ...currentCandle,
        hma_value: hmaValue
      });
    }
    
    return weeklyCandlesWithHMA;
  }

  getWeekStart(date) {
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1); // Adjust for Sunday
    return new Date(date.setDate(diff));
  }

  // HMA Calculation Methods
  async getHMAStatus(userId) {
    try {
      const stockList = await this.getStockList(userId);
      const hmaStatus = {};

      for (const symbol of stockList) {
        const weeklyCandles = await WeeklyCandle.find({ userId, symbol })
          .sort({ week_start_date: 1 })
          .limit(56); // Last 56 weeks

        if (weeklyCandles.length >= 55) { // Need at least 55 weeks for HMA(55)
          const closes = weeklyCandles.map(candle => candle.close);
          const hmaValue = HMAService.calculateHMA(closes, 55);
          
          hmaStatus[symbol] = {
            hasHMA: true,
            hmaValue,
            weeksAvailable: weeklyCandles.length,
            lastUpdate: weeklyCandles[weeklyCandles.length - 1].week_start_date
          };
        } else {
          hmaStatus[symbol] = {
            hasHMA: false,
            weeksAvailable: weeklyCandles.length,
            weeksNeeded: 55 - weeklyCandles.length
          };
        }
      }

      return {
        status: 'available',
        hmaStatus,
        totalSymbols: stockList.length,
        symbolsWithHMA: Object.values(hmaStatus).filter(status => status.hasHMA).length
      };
    } catch (error) {
      LoggerService.error('StockScreenerService', 'Error getting HMA status:', error);
      throw error;
    }
  }

  async triggerHMACalculation(userId) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }
      if (!user.fyers?.accessToken) {
        throw new Error('Fyers connection required. Please connect to Fyers first to calculate HMA values.');
      }

      const stockList = await this.getStockList(userId);
      const results = [];

      for (const symbol of stockList) {
        try {
          // Use the correct collection for weekly candles
          const db = mongoose.connection.db;
          const weeklyCollection = db.collection('50stockweeklydata');
          // Get the latest 56 weekly candles, sorted by date ascending
          const weeklyCandles = await weeklyCollection.find({ symbol }).sort({ date: 1 }).toArray();

          if (weeklyCandles.length >= 55) {
            // Use the latest 55 closes for HMA calculation
            console.log(`[HMA DEBUG] Symbol: ${symbol}, weekly candles available: ${weeklyCandles.length}`);
            
            const hmaValue = HMAService.calculateLatestHMA(weeklyCandles, 55, 'close');
            
            console.log(`[HMA DEBUG] Symbol: ${symbol}, latest HMA value:`, hmaValue);
            
            if (hmaValue !== null && hmaValue !== undefined && !isNaN(hmaValue)) {
            // Update or create HMA signal
            await HMASignal.findOneAndUpdate(
              { userId, symbol },
              {
                userId,
                symbol,
                hma_value: hmaValue,
                last_updated: new Date()
              },
              { upsert: true }
            );
            results.push({ symbol, status: 'success', hmaValue });
            } else {
              results.push({ symbol, status: 'invalid_hma_value', hmaValue });
            }
          } else {
            results.push({ 
              symbol, 
              status: 'insufficient_data', 
              weeksAvailable: weeklyCandles.length,
              weeksNeeded: 55 - weeklyCandles.length
            });
          }
        } catch (error) {
          LoggerService.error('StockScreenerService', `Error calculating HMA for ${symbol}:`, error);
          results.push({ symbol, status: 'error', error: error.message });
        }
      }

      return {
        message: 'HMA calculation completed',
        results,
        totalProcessed: stockList.length,
        successful: results.filter(r => r.status === 'success').length,
        errors: results.filter(r => r.status === 'error').length
      };
    } catch (error) {
      LoggerService.error('StockScreenerService', 'Error triggering HMA calculation:', error);
      throw error;
    }
  }

  // Signal Generation Methods
  async getSignalStatus(userId) {
    try {
      const signals = await HMASignal.find({ userId });
      const stockList = await this.getStockList(userId);

      return {
        status: 'available',
        totalSignals: signals.length,
        totalSymbols: stockList.length,
        signalsGenerated: signals.length,
        pendingSignals: stockList.length - signals.length
      };
    } catch (error) {
      LoggerService.error('StockScreenerService', 'Error getting signal status:', error);
      throw error;
    }
  }

  async triggerSignalGeneration(userId) {
    try {
      const stockList = await this.getStockList(userId);
      const results = [];

      for (const symbol of stockList) {
        try {
          // Get latest weekly candle with HMA from the weekly data collection
          const db = mongoose.connection.db;
          const weeklyCollection = db.collection('50stockweeklydata');
          const latestWeeklyCandle = await weeklyCollection.find({ symbol }).sort({ date: -1 }).limit(1).toArray();
          
          if (!latestWeeklyCandle || latestWeeklyCandle.length === 0) {
            results.push({ symbol, status: 'no_weekly_data' });
            continue;
          }
          
          const weeklyData = latestWeeklyCandle[0];
          const hmaValue = weeklyData.hma_value;
          
          if (!hmaValue) {
        results.push({ symbol, status: 'no_hma_data' });
        continue;
      }

          // Get latest daily close from MongoDB
          const dailyCollection = db.collection('50stocksdailydata');
          const dailyCandles = await dailyCollection.find({ symbol }).sort({ date: -1 }).limit(1).toArray();

          let dailySignal = 'N/A';
          let weeklySignal = 'N/A';
          let dailyClose = null;
          let weeklyClose = null;

          // Generate daily signal
          if (dailyCandles.length > 0) {
            dailyClose = dailyCandles[0].close;
            if (dailyClose > hmaValue) {
              dailySignal = 'Bullish';
            } else if (dailyClose < hmaValue) {
              dailySignal = 'Bearish';
            } else {
              dailySignal = 'Neutral';
            }
          }

          // Generate weekly signal
          weeklyClose = weeklyData.close;
          if (weeklyClose > hmaValue) {
            weeklySignal = 'Bullish';
          } else if (weeklyClose < hmaValue) {
            weeklySignal = 'Bearish';
          } else {
            weeklySignal = 'Neutral';
          }

          // Update or create HMA signal with both daily and weekly signals
      await HMASignal.findOneAndUpdate(
        { userId, symbol },
        {
              userId,
              symbol,
              hma_value: hmaValue,
              daily_signal: dailySignal,
              weekly_signal: weeklySignal,
              daily_close: dailyClose,
              weekly_close: weeklyClose,
          last_updated: new Date()
        },
        { upsert: true }
      );

          results.push({ 
            symbol, 
            status: 'success', 
            dailySignal, 
            weeklySignal, 
            dailyClose, 
            weeklyClose,
            hmaValue: hmaValue
          });
        } catch (error) {
          LoggerService.error('StockScreenerService', `Error generating signal for ${symbol}:`, error);
          results.push({ symbol, status: 'error', error: error.message });
        }
      }

      return {
        message: 'Signal generation completed',
        results,
        totalProcessed: stockList.length,
        successful: results.filter(r => r.status === 'success').length,
        errors: results.filter(r => r.status === 'error').length
      };
    } catch (error) {
      LoggerService.error('StockScreenerService', 'Error triggering signal generation:', error);
      throw error;
    }
  }

  // Utility Methods
  async getStockList(userId) {
    // Return the Nifty 50 stock list
    return [
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
  }

  async validateSymbol(userId, symbol) {
    try {
      // Check if symbol is in our stock list
      const stockList = await this.getStockList(userId);
      const isValid = stockList.includes(symbol);

      return {
        symbol,
        isValid,
        message: isValid ? 'Symbol is valid' : 'Symbol not found in Nifty 50'
      };
    } catch (error) {
      LoggerService.error('StockScreenerService', 'Error validating symbol:', error);
      throw error;
    }
  }

  // Live Data Methods
  async getLivePrices(userId, symbols) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }
      
      const prices = {};
      
      for (const symbol of symbols) {
        try {
          // Get the latest price from historical data - pass the access token
          const historicalData = await MarketDataService.fetchHistoricalData(symbol, '1d', 1, false, user.fyers?.accessToken);
          if (historicalData && historicalData.length > 0) {
            prices[symbol] = historicalData[historicalData.length - 1].close;
          } else {
            prices[symbol] = null;
          }
        } catch (error) {
          LoggerService.error('StockScreenerService', `Error getting live price for ${symbol}:`, error);
          prices[symbol] = null;
        }
      }

      return prices;
    } catch (error) {
      LoggerService.error('StockScreenerService', 'Error getting live prices:', error);
      throw error;
    }
  }

  async subscribeToLiveData(userId, symbols) {
    try {
      // This would integrate with the existing WebSocket service
      // For now, return success status
      return {
        message: 'Subscribed to live data',
        symbols,
        status: 'success'
      };
    } catch (error) {
      LoggerService.error('StockScreenerService', 'Error subscribing to live data:', error);
      throw error;
    }
  }

  async unsubscribeFromLiveData(userId, symbols) {
    try {
      // This would integrate with the existing WebSocket service
      // For now, return success status
      return {
        message: 'Unsubscribed from live data',
        symbols,
        status: 'success'
      };
    } catch (error) {
      LoggerService.error('StockScreenerService', 'Error unsubscribing from live data:', error);
      throw error;
    }
  }

  // Symbol Methods
  async getAvailableSymbols(userId) {
    try {
      // Get symbols from signals that have data
      const signals = await HMASignal.find({ userId }).distinct('symbol');
      
      // Also get symbols from active positions
      const positions = await ActivePosition.find({ userId }).distinct('symbol');
      
      // Combine and remove duplicates
      const allSymbols = [...new Set([...signals, ...positions])];
      
      // Get stock list for additional symbols
      const stockList = await this.getStockList(userId);
      const stockListSymbols = stockList.map(stock => stock.symbol);
      
      // Combine all symbols and remove duplicates
      const availableSymbols = [...new Set([...allSymbols, ...stockListSymbols])];
      
      return availableSymbols.map(symbol => ({
        symbol,
        displayName: symbol.replace('NSE:', '').replace('-EQ', '')
      }));
    } catch (error) {
      LoggerService.error('StockScreenerService', 'Error fetching available symbols:', error);
      throw error;
    }
  }

  async searchSymbols(userId, query) {
    try {
      const availableSymbols = await this.getAvailableSymbols(userId);
      
      // Filter symbols based on query
      const filteredSymbols = availableSymbols.filter(symbol => 
        symbol.symbol.toLowerCase().includes(query.toLowerCase()) ||
        symbol.displayName.toLowerCase().includes(query.toLowerCase())
      );
      
      return filteredSymbols.slice(0, 20); // Limit to 20 results
    } catch (error) {
      LoggerService.error('StockScreenerService', 'Error searching symbols:', error);
      throw error;
    }
  }

  // Master Data Methods
  async getMasterData(userId) {
    try {
      console.log('[StockScreenerService] Getting master data for user:', userId);
      const stockList = await this.getStockList(userId);
      console.log('[StockScreenerService] Stock list length:', stockList.length);
      const masterData = [];

      for (const symbol of stockList) {
        try {
          console.log('[StockScreenerService] Processing symbol:', symbol);
          
          // Get daily candles count from the correct collection
          const db = mongoose.connection.db;
          const dailyCollection = db.collection('50stocksdailydata');
          console.log(`[StockScreenerService] Querying daily data for symbol: ${symbol}`);
          const dailyCandles = await dailyCollection.find({ symbol }).sort({ date: 1 }).toArray();
          console.log(`[StockScreenerService] Found ${dailyCandles.length} daily candles for ${symbol}`);

          // Get weekly candles count from the correct collection
          const weeklyCollection = db.collection('50stockweeklydata');
          console.log(`[StockScreenerService] Querying weekly data for symbol: ${symbol}`);
          const weeklyCandles = await weeklyCollection.find({ symbol }).sort({ date: 1 }).toArray();
          console.log(`[StockScreenerService] Found ${weeklyCandles.length} weekly candles for ${symbol}`);

          // Get latest weekly candle with HMA from the weekly data collection
          const latestWeeklyCandle = weeklyCandles.length > 0 ? weeklyCandles[weeklyCandles.length - 1] : null;
          const hmaValue = latestWeeklyCandle?.hma_value || null;

          // Get HMA signal for signals (if available)
          const hmaSignal = await HMASignal.findOne({ userId, symbol });

          // Get latest candle for date range
          const latestDailyCandle = dailyCandles.length > 0 ? dailyCandles[dailyCandles.length - 1] : null;
          const firstDailyCandle = dailyCandles.length > 0 ? dailyCandles[0] : null;

          const stockData = {
            symbol,
            daysCandle: dailyCandles.length,
            weeklyCandle: weeklyCandles.length,
            lastFetched: latestDailyCandle ? new Date(latestDailyCandle.date).toLocaleDateString() : '--',
            candleStartDate: firstDailyCandle ? new Date(firstDailyCandle.date).toLocaleDateString() : '--',
            candleEndDate: latestDailyCandle ? new Date(latestDailyCandle.date).toLocaleDateString() : '--',
            weeklyHMA55: hmaValue, // Use HMA from weekly data
            dailySignal: hmaSignal?.daily_signal || null,
            weeklySignal: hmaSignal?.weekly_signal || null
          };

          console.log('[StockScreenerService] Stock data for', symbol, ':', stockData);
          masterData.push(stockData);
        } catch (error) {
          LoggerService.error('StockScreenerService', `Error getting master data for ${symbol}:`, error);
          masterData.push({
            symbol,
            daysCandle: 0,
            weeklyCandle: 0,
            lastFetched: '--',
            candleStartDate: '--',
            candleEndDate: '--',
            weeklyHMA55: null,
            signal: null
          });
        }
      }

      console.log('[StockScreenerService] Final master data length:', masterData.length);
      return masterData;
    } catch (error) {
      LoggerService.error('StockScreenerService', 'Error getting master data:', error);
      throw error;
    }
  }

  async fillDataForSymbol(userId, symbol) {
    try {
      console.log(`[StockScreenerService] Starting data fill for symbol: ${symbol}`);
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }
      if (!user.fyers?.accessToken) {
        throw new Error('Fyers connection required. Please connect to Fyers first to fill data.');
      }

      // Collect data in phases (366 days each) to get 56 weeks worth of data
      const phases = 2; // 2 phases of 366 days each to get ~2 years of data
      const results = [];

      for (let phase = 0; phase < phases; phase++) {
        try {
          console.log(`[StockScreenerService] Collecting phase ${phase + 1}/${phases} for ${symbol}`);
          const result = await this.collectDataForSymbol(userId, symbol);
          results.push({ phase: phase + 1, status: 'success', ...result });
        } catch (error) {
          LoggerService.error('StockScreenerService', `Error in phase ${phase + 1} for ${symbol}:`, error);
          results.push({ phase: phase + 1, status: 'error', error: error.message });
        }
      }

      // Calculate HMA after data collection
      try {
        const weeklyCandles = await WeeklyCandle.find({ userId, symbol })
          .sort({ week_start_date: 1 })
          .limit(56);

        if (weeklyCandles.length >= 55) {
          const closes = weeklyCandles.map(candle => candle.close);
          const hmaValue = HMAService.calculateHMA(closes, 55);
          
          // Update or create HMA signal
          await HMASignal.findOneAndUpdate(
            { userId, symbol },
            {
              userId,
              symbol,
              hma_value: hmaValue,
              last_updated: new Date()
            },
            { upsert: true }
          );

          // Generate signal - use the same Fyers API approach
          const FyersAPI = require("fyers-api-v3").fyersModel;
          const fyers = new FyersAPI();
          const { getFyersAppId } = require('../fyersService');
          const appId = getFyersAppId();
          const formattedAccessToken = `${appId}:${user.fyers.accessToken}`;
          const [appIdToken, token] = formattedAccessToken.split(':');
          fyers.setAppId(appIdToken);
          fyers.setAccessToken(token);
          
          // Get current price from latest daily data
          const endDate = new Date();
          const startDate = new Date();
          startDate.setDate(startDate.getDate() - 1); // Just yesterday
          
          const params = {
            symbol: symbol,
            resolution: "1D",
            date_format: "1",
            range_from: startDate.toISOString().split('T')[0],
            range_to: endDate.toISOString().split('T')[0],
            cont_flag: "1"
          };
          
          const response = await fyers.getHistory(params);
          const currentPrice = response.s === 'ok' && response.candles && response.candles.length > 0 
            ? parseFloat(response.candles[response.candles.length - 1][4]) 
            : 0;
          
          let signalType = 'Neutral';
          if (currentPrice > hmaValue) {
            signalType = 'Bullish';
          } else if (currentPrice < hmaValue) {
            signalType = 'Bearish';
          }

          await HMASignal.findOneAndUpdate(
            { userId, symbol },
            {
              signal_type: signalType,
              current_price: currentPrice,
              last_updated: new Date()
            },
            { upsert: true }
          );

          results.push({ 
            step: 'hma_calculation', 
            status: 'success', 
            hmaValue, 
            signalType, 
            currentPrice 
          });
        } else {
          results.push({ 
            step: 'hma_calculation', 
            status: 'insufficient_data', 
            weeksAvailable: weeklyCandles.length,
            weeksNeeded: 55 - weeklyCandles.length
          });
        }
      } catch (error) {
        LoggerService.error('StockScreenerService', `Error calculating HMA for ${symbol}:`, error);
        results.push({ step: 'hma_calculation', status: 'error', error: error.message });
      }

      return {
        message: 'Data fill completed',
        symbol,
        results,
        totalPhases: phases,
        successful: results.filter(r => r.status === 'success').length,
        errors: results.filter(r => r.status === 'error').length
      };
    } catch (error) {
      LoggerService.error('StockScreenerService', 'Error filling data for symbol:', error);
      throw error;
    }
  }

  // Individual Symbol Operations
  async collectDataForSymbol(userId, symbol) {
    try {
      console.log(`[StockScreenerService] Collecting data for symbol: ${symbol}`);
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }
      if (!user.fyers?.accessToken) {
        throw new Error('Fyers connection required. Please connect to Fyers first to collect data.');
      }

      // Format access token like HMA service does
      const { getFyersAppId } = require('../fyersService');
      const appId = getFyersAppId();
      const formattedAccessToken = `${appId}:${user.fyers.accessToken}`;
      
      const result = await this.collectDataForSymbolInternal(symbol, formattedAccessToken, userId);
      
      return {
        message: 'Data collection completed',
        symbol,
        result
      };
    } catch (error) {
      LoggerService.error('StockScreenerService', 'Error collecting data for symbol:', error);
      throw error;
    }
  }

  async calculateHMAForSymbol(userId, symbol) {
    try {
      console.log(`[StockScreenerService] Calculating HMA for symbol: ${symbol}`);
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }
      if (!user.fyers?.accessToken) {
        throw new Error('Fyers connection required. Please connect to Fyers first to calculate HMA.');
      }

      // Get weekly candles for HMA calculation
      const weeklyCandles = await WeeklyCandle.find({ userId, symbol })
        .sort({ week_start_date: 1 })
        .limit(56);

      if (weeklyCandles.length < 55) {
        throw new Error(`Insufficient data for HMA calculation. Need at least 55 weeks, got ${weeklyCandles.length}`);
      }

      const closes = weeklyCandles.map(candle => candle.close);
      const hmaValue = HMAService.calculateHMA(closes, 55);
      
      // Update or create HMA signal
      await HMASignal.findOneAndUpdate(
        { userId, symbol },
        {
          userId,
          symbol,
          hma_value: hmaValue,
          last_updated: new Date()
        },
        { upsert: true }
      );

      return {
        message: 'HMA calculation completed',
        symbol,
        hmaValue,
        weeksUsed: weeklyCandles.length
      };
    } catch (error) {
      LoggerService.error('StockScreenerService', 'Error calculating HMA for symbol:', error);
      throw error;
    }
  }

  async generateSignalForSymbol(userId, symbol) {
    try {
      console.log(`[StockScreenerService] Generating signal for symbol: ${symbol}`);

      // Get HMA value
      const hmaSignal = await HMASignal.findOne({ userId, symbol });
      if (!hmaSignal || !hmaSignal.hma_value) {
        throw new Error('HMA value not found. Please calculate HMA first.');
      }

      // Get latest daily close from MongoDB
      const db = mongoose.connection.db;
      const dailyCollection = db.collection('50stocksdailydata');
      const dailyCandles = await dailyCollection.find({ symbol }).sort({ date: -1 }).limit(1).toArray();
      
      // Get latest weekly close from MongoDB
      const weeklyCollection = db.collection('50stockweeklydata');
      const weeklyCandles = await weeklyCollection.find({ symbol }).sort({ date: -1 }).limit(1).toArray();

      let dailySignal = 'N/A';
      let weeklySignal = 'N/A';
      let dailyClose = null;
      let weeklyClose = null;

      // Generate daily signal
      if (dailyCandles.length > 0) {
        dailyClose = dailyCandles[0].close;
        if (dailyClose > hmaSignal.hma_value) {
          dailySignal = 'Bullish';
        } else if (dailyClose < hmaSignal.hma_value) {
          dailySignal = 'Bearish';
        } else {
          dailySignal = 'Neutral';
        }
      }

      // Generate weekly signal
      if (weeklyCandles.length > 0) {
        weeklyClose = weeklyCandles[0].close;
        if (weeklyClose > hmaSignal.hma_value) {
          weeklySignal = 'Bullish';
        } else if (weeklyClose < hmaSignal.hma_value) {
          weeklySignal = 'Bearish';
        } else {
          weeklySignal = 'Neutral';
        }
      }

      // Update signal with both daily and weekly signals
      await HMASignal.findOneAndUpdate(
        { userId, symbol },
        {
          daily_signal: dailySignal,
          weekly_signal: weeklySignal,
          daily_close: dailyClose,
          weekly_close: weeklyClose,
          last_updated: new Date()
        },
        { upsert: true }
      );

      return {
        message: 'Signal generation completed',
        symbol,
        dailySignal,
        weeklySignal,
        dailyClose,
        weeklyClose,
        hmaValue: hmaSignal.hma_value
      };
    } catch (error) {
      LoggerService.error('StockScreenerService', 'Error generating signal for symbol:', error);
      throw error;
    }
  }

  // Collect data for a specific symbol
  async collectDataForSymbolInternal(symbol, accessToken, userId) {
    try {
      console.log(`[StockScreenerService] Collecting data for ${symbol}`);
      const FyersAPI = require("fyers-api-v3").fyersModel;
      const fyers = new FyersAPI();
      const [appId, token] = accessToken.split(':');
      if (!appId || !token) {
        throw new Error('Invalid access token format. Expected format: "appId:token"');
      }
      fyers.setAppId(appId);
      fyers.setAccessToken(token);

      // Two-phase fetch logic as per Fyers API limits (366 days max per request)
      const MS_PER_DAY = 24 * 60 * 60 * 1000;
      const MAX_DAYS = 366;
      let allCandles = [];
      
      // Phase 1: July 6th 2023 to July 5th 2024 (366 days)
      const phase1Start = new Date('2023-07-06');
      const phase1End = new Date('2024-07-05');
      
      // Phase 2: July 6th 2024 to current date
      const phase2Start = new Date('2024-07-06');
      const today = new Date();
      
      console.log(`[StockScreenerService] Starting two-phase data collection for ${symbol}`);
      console.log(`[StockScreenerService] Phase 1: ${phase1Start.toISOString().split('T')[0]} to ${phase1End.toISOString().split('T')[0]}`);
      console.log(`[StockScreenerService] Phase 2: ${phase2Start.toISOString().split('T')[0]} to ${today.toISOString().split('T')[0]}`);
      
      // Phase 1: July 6th 2023 to July 5th 2024
      const phase1Params = {
        symbol,
        resolution: "D",
        date_format: 1,
        range_from: phase1Start.toISOString().split('T')[0],
        range_to: phase1End.toISOString().split('T')[0],
        cont_flag: "1"
      };
      
      console.log(`[StockScreenerService] Phase 1 Fyers API params for ${symbol}:`, phase1Params);
      const phase1Response = await fyers.getHistory(phase1Params);
      console.log(`[StockScreenerService] Phase 1 Fyers API response for ${symbol}:`, phase1Response);
      
      if (phase1Response.s === 'ok' && Array.isArray(phase1Response.candles)) {
        allCandles = allCandles.concat(phase1Response.candles);
        console.log(`[StockScreenerService] Phase 1: Got ${phase1Response.candles.length} candles for ${symbol}`);
            } else {
        console.error(`[StockScreenerService] Phase 1 Fyers API error for ${symbol}:`, phase1Response);
        throw new Error(`Phase 1 Fyers API error for ${symbol}: ${phase1Response.message || JSON.stringify(phase1Response)}`);
      }
      
      // Add delay between phases to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Phase 2: July 6th 2024 to current date
      const phase2Params = {
        symbol,
        resolution: "D",
        date_format: 1,
        range_from: phase2Start.toISOString().split('T')[0],
        range_to: today.toISOString().split('T')[0],
        cont_flag: "1"
      };
      
      console.log(`[StockScreenerService] Phase 2 Fyers API params for ${symbol}:`, phase2Params);
      const phase2Response = await fyers.getHistory(phase2Params);
      console.log(`[StockScreenerService] Phase 2 Fyers API response for ${symbol}:`, phase2Response);
      
      if (phase2Response.s === 'ok' && Array.isArray(phase2Response.candles)) {
        allCandles = allCandles.concat(phase2Response.candles);
        console.log(`[StockScreenerService] Phase 2: Got ${phase2Response.candles.length} candles for ${symbol}`);
          } else {
        console.error(`[StockScreenerService] Phase 2 Fyers API error for ${symbol}:`, phase2Response);
        throw new Error(`Phase 2 Fyers API error for ${symbol}: ${phase2Response.message || JSON.stringify(phase2Response)}`);
      }
      console.log(`[StockScreenerService] Successfully fetched ${allCandles.length} daily candles for ${symbol}`);
      // Transform data to our format
      const historicalData = allCandles.map(candle => ({
        timestamp: candle[0] * 1000,
        date: new Date(candle[0] * 1000).toISOString().split('T')[0],
        open: parseFloat(candle[1]),
        high: parseFloat(candle[2]),
        low: parseFloat(candle[3]),
        close: parseFloat(candle[4]),
        volume: parseInt(candle[5])
      }));
      if (!historicalData || historicalData.length === 0) {
        throw new Error(`No historical data available for ${symbol}`);
      }
      // Save daily candles to database - using the collection name from documentation
      console.log(`[StockScreenerService] Saving ${historicalData.length} daily candles to 50stocksdailydata for ${symbol}`);
      const db = require('mongoose').connection.db;
      const dailyCollection = db.collection('50stocksdailydata');
      
      try {
        await dailyCollection.deleteMany({ symbol });
        console.log(`[StockScreenerService] Deleted existing daily data for ${symbol}`);
        
        const dailyDocuments = historicalData.map(candle => ({
          symbol,
          date: new Date(candle.date),
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
          timestamp: candle.timestamp
        }));
        
        if (dailyDocuments.length > 0) {
          const insertResult = await dailyCollection.insertMany(dailyDocuments);
          console.log(`[StockScreenerService] Successfully saved ${insertResult.insertedCount} daily candles to 50stocksdailydata for ${symbol}`);
        }
      } catch (dbError) {
        console.error(`[StockScreenerService] Error saving daily data for ${symbol}:`, dbError);
        throw new Error(`Database error saving daily data for ${symbol}: ${dbError.message}`);
      }

      // Convert daily data to weekly data with HMA calculation
      const weeklyCandles = this.convertDailyToWeekly(historicalData);
      
      // Save weekly candles to database - using the collection name from documentation
      console.log(`[StockScreenerService] Saving ${weeklyCandles.length} weekly candles with HMA to 50stockweeklydata for ${symbol}`);
      const weeklyCollection = db.collection('50stockweeklydata');
      
      try {
        await weeklyCollection.deleteMany({ symbol });
        console.log(`[StockScreenerService] Deleted existing weekly data for ${symbol}`);
        
        const weeklyDocuments = weeklyCandles.map(candle => ({
            symbol,
          date: new Date(candle.week_start_date),
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
            volume: candle.volume,
          weekStart: candle.week_start_date,
          weekEnd: new Date(candle.week_start_date).toISOString().split('T')[0],
          hma_value: candle.hma_value // Include HMA value in weekly data
        }));
        
        if (weeklyDocuments.length > 0) {
          const insertResult = await weeklyCollection.insertMany(weeklyDocuments);
          console.log(`[StockScreenerService] Successfully saved ${insertResult.insertedCount} weekly candles with HMA to 50stockweeklydata for ${symbol}`);
          
          // Log HMA statistics
          const candlesWithHMA = weeklyCandles.filter(candle => candle.hma_value !== null);
          console.log(`[StockScreenerService] HMA Statistics for ${symbol}: ${candlesWithHMA.length}/${weeklyCandles.length} candles have HMA values`);
        }
      } catch (dbError) {
        console.error(`[StockScreenerService] Error saving weekly data for ${symbol}:`, dbError);
        throw new Error(`Database error saving weekly data for ${symbol}: ${dbError.message}`);
      }
      console.log(`[StockScreenerService] Successfully collected ${historicalData.length} daily candles and ${weeklyCandles.length} weekly candles for ${symbol}`);
      return {
        symbol,
        dailyCandles: historicalData.length,
        weeklyCandles: weeklyCandles.length,
        dateRange: {
          start: historicalData[0]?.date,
          end: historicalData[historicalData.length - 1]?.date
        }
      };
    } catch (error) {
      console.error(`❌ StockScreenerService Error collecting data for ${symbol}:`, error);
      if (error.message.includes('503') || error.message.includes('temporarily unavailable')) {
        throw new Error(`Fyers API is temporarily unavailable. Please try again in a few minutes.`);
      } else if (error.message.includes('No historical data')) {
        throw new Error(`No historical data available for ${symbol}. Please check if the symbol is valid.`);
      } else {
        throw new Error(`Failed to collect data for ${symbol}: ${error.message}`);
      }
    }
  }
}

module.exports = StockScreenerService; 