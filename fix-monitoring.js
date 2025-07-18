const mongoose = require('mongoose');
const TradingState = require('./models/TradingState');
const { MonitoringService } = require('./services/monitoringService');

// Use the same MongoDB connection as the main server
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://akhashcs:h4ujE7n6Xdcap2WU@victory.mqbxy9m.mongodb.net/?retryWrites=true&w=majority&appName=Victory';

async function fixMonitoring() {
  try {
    console.log('🔍 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Find all trading states
    const states = await TradingState.find({});
    console.log(`📊 Found ${states.length} trading states`);

    if (states.length === 0) {
      console.log('❌ No trading states found');
      return;
    }

    for (const state of states) {
      console.log(`\n--- Processing User ${state.userId} ---`);
      
      // Check if monitoring is enabled
      const isMonitoring = state.tradeExecutionState?.isMonitoring || false;
      console.log(`Current monitoring status: ${isMonitoring}`);
      
      if (!isMonitoring) {
        console.log('🔧 Enabling monitoring...');
        
        // Enable monitoring
        await TradingState.updateOne(
          { userId: state.userId },
          { 
            $set: { 
              'tradeExecutionState.isMonitoring': true,
              'tradeExecutionState.lastMonitoringUpdate': new Date()
            }
          }
        );
        
        console.log('✅ Monitoring enabled');
      }
      
      // Check monitored symbols
      if (state.monitoredSymbols && state.monitoredSymbols.length > 0) {
        console.log(`Found ${state.monitoredSymbols.length} monitored symbols`);
        
        for (const symbol of state.monitoredSymbols) {
          console.log(`  - ${symbol.symbol}: ${symbol.triggerStatus}`);
          
          // Update symbol statuses to the new three-state system
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
            
            console.log(`    Updating ${symbol.symbol} status from ${symbol.triggerStatus} to ${newStatus}`);
            
            await TradingState.updateOne(
              { userId: state.userId, 'monitoredSymbols.id': symbol.id },
              {
                $set: {
                  'monitoredSymbols.$.triggerStatus': newStatus,
                  'monitoredSymbols.$.lastUpdate': new Date()
                }
              }
            );
          }
        }
      } else {
        console.log('No monitored symbols found');
      }
    }

    console.log('\n✅ Monitoring fix completed!');
    console.log('💡 Please refresh the frontend to see the updated monitoring dashboard.');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 Disconnected from MongoDB');
  }
}

fixMonitoring(); 