const mongoose = require('mongoose');
const { MonitoringService } = require('./services/monitoringService');
const TradingState = require('./models/TradingState');
const User = require('./models/User');
require('dotenv').config();

async function testMarketOrder() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Get the first user with Fyers connection
    const user = await User.findOne({ 'fyers.connected': true });
    if (!user) {
      console.log('❌ No user with Fyers connection found');
      return;
    }

    console.log(`👤 Testing with user: ${user._id}`);

    // Get current trading state
    let state = await TradingState.findOne({ userId: user._id });
    if (!state) {
      console.log('❌ No trading state found for user');
      return;
    }

    console.log('📊 Current monitored symbols:');
    state.monitoredSymbols.forEach(symbol => {
      console.log(`  - ${symbol.symbol}: ${symbol.triggerStatus}`);
      console.log(`    LTP: ${symbol.currentLTP}, HMA: ${symbol.hmaValue}`);
      console.log(`    Pending Signal: ${symbol.pendingSignal ? JSON.stringify(symbol.pendingSignal) : 'None'}`);
      console.log(`    Opportunity Active: ${symbol.opportunityActive}`);
      console.log(`    Order Placed: ${symbol.orderPlaced}`);
    });

    // Run monitoring cycle
    console.log('\n🔄 Running monitoring cycle...');
    const results = await MonitoringService.executeMonitoringCycle(user._id);
    console.log('📊 Monitoring cycle results:', results);

    // Get updated state
    state = await TradingState.findOne({ userId: user._id });
    console.log('\n📊 Updated monitored symbols:');
    state.monitoredSymbols.forEach(symbol => {
      console.log(`  - ${symbol.symbol}: ${symbol.triggerStatus}`);
      console.log(`    LTP: ${symbol.currentLTP}, HMA: ${symbol.hmaValue}`);
      console.log(`    Pending Signal: ${symbol.pendingSignal ? JSON.stringify(symbol.pendingSignal) : 'None'}`);
      console.log(`    Opportunity Active: ${symbol.opportunityActive}`);
      console.log(`    Order Placed: ${symbol.orderPlaced}`);
    });

    console.log('\n✅ Test completed');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await mongoose.disconnect();
  }
}

testMarketOrder(); 