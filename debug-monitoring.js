const mongoose = require('mongoose');
const TradingState = require('./models/TradingState');

// Use the same MongoDB connection as the main server
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://akhashcs:h4ujE7n6Xdcap2WU@victory.mqbxy9m.mongodb.net/?retryWrites=true&w=majority&appName=Victory';

async function debugMonitoring() {
  try {
    console.log('🔍 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Check all trading states
    const states = await TradingState.find({});
    console.log(`📊 Found ${states.length} trading states`);

    if (states.length === 0) {
      console.log('❌ No trading states found in database');
      return;
    }

    states.forEach((state, index) => {
      console.log(`\n--- User ${index + 1} (${state.userId}) ---`);
      console.log(`Monitoring Active: ${state.tradeExecutionState?.isMonitoring || false}`);
      console.log(`Monitored Symbols Count: ${state.monitoredSymbols?.length || 0}`);
      
      if (state.monitoredSymbols && state.monitoredSymbols.length > 0) {
        console.log('\nSymbol Details:');
        state.monitoredSymbols.forEach((symbol, symIndex) => {
          console.log(`  ${symIndex + 1}. ${symbol.symbol}`);
          console.log(`     Type: ${symbol.type}`);
          console.log(`     Trigger Status: ${symbol.triggerStatus}`);
          console.log(`     Current LTP: ${symbol.currentLTP || 'undefined'}`);
          console.log(`     HMA Value: ${symbol.hmaValue || 'undefined'}`);
          console.log(`     Order Placed: ${symbol.orderPlaced || false}`);
          console.log(`     Order Status: ${symbol.orderStatus || 'none'}`);
          console.log(`     Last Update: ${symbol.lastUpdate || 'never'}`);
          console.log('');
        });
      }

      if (state.activePositions && state.activePositions.length > 0) {
        console.log(`Active Positions: ${state.activePositions.length}`);
        state.activePositions.forEach((position, posIndex) => {
          console.log(`  ${posIndex + 1}. ${position.symbol} - ${position.status}`);
        });
      }
    });

    // Check specifically for users with monitoring enabled
    const activeMonitoringStates = await TradingState.find({ 'tradeExecutionState.isMonitoring': true });
    console.log(`\n🔍 Users with active monitoring: ${activeMonitoringStates.length}`);

    if (activeMonitoringStates.length === 0) {
      console.log('❌ No users have monitoring enabled!');
      console.log('💡 This is why symbols are not appearing in the monitoring dashboard.');
      console.log('💡 You need to set isMonitoring: true for at least one user.');
    } else {
      console.log('✅ Found users with active monitoring');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 Disconnected from MongoDB');
  }
}

debugMonitoring(); 