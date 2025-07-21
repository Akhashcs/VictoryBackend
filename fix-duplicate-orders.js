const mongoose = require('mongoose');
const TradingState = require('./models/TradingState');
const TradeLog = require('./models/TradeLog');
require('dotenv').config();

async function fixDuplicateOrders() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Get all trading states
    const states = await TradingState.find({});
    console.log(`📊 Found ${states.length} trading states`);

    for (const state of states) {
      console.log(`\n🔧 Processing user: ${state.userId}`);
      
      if (state.monitoredSymbols && state.monitoredSymbols.length > 0) {
        console.log(`  Found ${state.monitoredSymbols.length} monitored symbols`);
        
        // Find symbols that have filled orders but are still in monitoring
        const symbolsToRemove = [];
        
        for (const symbol of state.monitoredSymbols) {
          if (symbol.orderPlaced && symbol.orderStatus === 'FILLED') {
            console.log(`  ⚠️  Found filled order still in monitoring: ${symbol.symbol}`);
            symbolsToRemove.push(symbol.id);
          }
        }
        
        // Remove symbols with filled orders from monitoring
        if (symbolsToRemove.length > 0) {
          await TradingState.updateOne(
            { userId: state.userId },
            { $pull: { monitoredSymbols: { id: { $in: symbolsToRemove } } } }
          );
          console.log(`  ✅ Removed ${symbolsToRemove.length} symbols with filled orders from monitoring`);
        }
        
        // Reset opportunityActive flags for remaining symbols
        const symbolsToReset = state.monitoredSymbols.filter(s => 
          s.opportunityActive && !symbolsToRemove.includes(s.id)
        );
        
        if (symbolsToReset.length > 0) {
          await TradingState.updateOne(
            { userId: state.userId },
            { 
              $set: { 
                'monitoredSymbols.$[elem].opportunityActive': false 
              }
            },
            { 
              arrayFilters: [{ 'elem.opportunityActive': true }]
            }
          );
          console.log(`  ✅ Reset opportunityActive flag for ${symbolsToReset.length} symbols`);
        }
      }
      
      // Check active positions
      if (state.activePositions && state.activePositions.length > 0) {
        console.log(`  Found ${state.activePositions.length} active positions`);
        state.activePositions.forEach(pos => {
          console.log(`    - ${pos.symbol}: ${pos.status} @ ${pos.boughtPrice}`);
        });
      }
    }

    // Check for duplicate trade logs
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const logs = await TradeLog.find({
      timestamp: { $gte: today, $lt: tomorrow }
    }).sort({ timestamp: -1 });

    console.log(`\n📊 Found ${logs.length} trade logs today`);
    
    // Group by symbol and order type
    const symbolGroups = {};
    logs.forEach(log => {
      const key = `${log.symbol}_${log.side}_${log.orderType}`;
      if (!symbolGroups[key]) {
        symbolGroups[key] = [];
      }
      symbolGroups[key].push(log);
    });

    // Check for duplicates
    Object.keys(symbolGroups).forEach(key => {
      const groupLogs = symbolGroups[key];
      if (groupLogs.length > 1) {
        console.log(`\n⚠️  DUPLICATE ORDERS for ${key}:`);
        groupLogs.forEach((log, index) => {
          console.log(`  ${index + 1}. ${log.timestamp.toLocaleString()} - ${log.status} - ${log.remarks}`);
        });
      }
    });

    console.log('\n✅ Cleanup completed');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
  }
}

fixDuplicateOrders(); 