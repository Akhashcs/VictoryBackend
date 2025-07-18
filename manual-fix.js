// This script should be run in the backend context
// You can run this by adding it to the server.js temporarily

const TradingState = require('./models/TradingState');

async function manualFix() {
  try {
    console.log('🔧 Manual fix started...');
    
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

    console.log(`✅ Manual fix completed: ${fixedCount} users fixed, ${symbolUpdates} symbols updated`);
    console.log('💡 Please refresh the frontend to see the updated monitoring dashboard.');

  } catch (error) {
    console.error('❌ Error in manual fix:', error);
  }
}

// Export for use in server.js
module.exports = { manualFix };

// If run directly, execute the fix
if (require.main === module) {
  manualFix();
} 