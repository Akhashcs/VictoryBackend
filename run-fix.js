const mongoose = require('mongoose');
const TradingState = require('./models/TradingState');

// Use the same MongoDB connection as the main server
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://akhashcs:h4ujE7n6Xdcap2WU@victory.mqbxy9m.mongodb.net/?retryWrites=true&w=majority&appName=Victory';

async function runFix() {
  try {
    console.log('🔧 Running monitoring fix...');
    
    // Connect to MongoDB
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    
    // Find all trading states
    const states = await TradingState.find({});
    console.log(`📊 Found ${states.length} trading states`);

    if (states.length === 0) {
      console.log('❌ No trading states found');
      return;
    }

    let fixedCount = 0;
    let symbolUpdates = 0;

    for (const state of states) {
      console.log(`Processing user ${state.userId}`);
      
      // Enable monitoring if not already enabled
      if (!state.tradeExecutionState?.isMonitoring) {
        await TradingState.updateOne(
          { userId: state.userId },
          { 
            $set: { 
              'tradeExecutionState.isMonitoring': true,
              'tradeExecutionState.lastMonitoringUpdate': new Date()
            }
          }
        );
        fixedCount++;
        console.log(`✅ Enabled monitoring for user ${state.userId}`);
      }
      
      // Update symbol statuses
      if (state.monitoredSymbols && state.monitoredSymbols.length > 0) {
        for (const symbol of state.monitoredSymbols) {
          if (!symbol.triggerStatus || symbol.triggerStatus === 'WAITING') {
            // Determine initial status based on LTP vs HMA
            let newStatus = 'WAITING_FOR_REVERSAL'; // Default
            
            if (symbol.currentLTP && symbol.hmaValue) {
              if (symbol.currentLTP <= symbol.hmaValue) {
                newStatus = 'WAITING_FOR_ENTRY';
              } else {
                newStatus = 'WAITING_FOR_REVERSAL';
              }
            }
            
            await TradingState.updateOne(
              { userId: state.userId, 'monitoredSymbols.id': symbol.id },
              {
                $set: {
                  'monitoredSymbols.$.triggerStatus': newStatus,
                  'monitoredSymbols.$.lastUpdate': new Date()
                }
              }
            );
            symbolUpdates++;
            console.log(`✅ Updated ${symbol.symbol} status to ${newStatus}`);
          }
        }
      }
    }

    console.log(`✅ Fix completed: ${fixedCount} users fixed, ${symbolUpdates} symbols updated`);
    console.log('💡 Please refresh the frontend to see the updated monitoring dashboard.');

  } catch (error) {
    console.error('❌ Error in fix:', error);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 Disconnected from MongoDB');
  }
}

// Run the fix
runFix(); 