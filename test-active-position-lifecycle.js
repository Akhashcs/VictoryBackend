const mongoose = require('mongoose');
const TradingState = require('./models/TradingState');
const TradeLog = require('./models/TradeLog');
const { MonitoringService } = require('./services/monitoringService');
require('dotenv').config();

async function testActivePositionLifecycle() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Get the first user with Fyers connection
    const User = require('./models/User');
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

    console.log('\n📊 CURRENT STATE ANALYSIS:');
    console.log('='.repeat(80));

    // Check monitored symbols
    console.log(`\n🔍 Monitored Symbols (${state.monitoredSymbols?.length || 0}):`);
    if (state.monitoredSymbols && state.monitoredSymbols.length > 0) {
      state.monitoredSymbols.forEach((symbol, index) => {
        console.log(`  ${index + 1}. ${symbol.symbol}`);
        console.log(`     Status: ${symbol.triggerStatus}`);
        console.log(`     Order Placed: ${symbol.orderPlaced}`);
        console.log(`     Order Status: ${symbol.orderStatus}`);
        console.log(`     Pending Signal: ${symbol.pendingSignal ? 'Yes' : 'No'}`);
        console.log(`     HMA Value: ${symbol.hmaValue}`);
        console.log(`     Current LTP: ${symbol.currentLTP}`);
      });
    } else {
      console.log('  No monitored symbols');
    }

    // Check active positions
    console.log(`\n📈 Active Positions (${state.activePositions?.length || 0}):`);
    if (state.activePositions && state.activePositions.length > 0) {
      state.activePositions.forEach((position, index) => {
        console.log(`  ${index + 1}. ${position.symbol}`);
        console.log(`     Status: ${position.status}`);
        console.log(`     Bought Price: ${position.boughtPrice}`);
        console.log(`     Current Price: ${position.currentPrice}`);
        console.log(`     Target: ${position.target}`);
        console.log(`     Stop Loss: ${position.stopLoss}`);
        console.log(`     P&L: ₹${position.pnl || 0}`);
        console.log(`     P&L %: ${position.pnlPercentage || 0}%`);
        console.log(`     Buy Order ID: ${position.buyOrderId}`);
        console.log(`     SL Order ID: ${position.sellOrderId || 'Not placed'}`);
        console.log(`     Order Status: ${position.orderStatus || 'N/A'}`);
      });
    } else {
      console.log('  No active positions');
    }

    // Check recent trade logs
    console.log('\n📋 Recent Trade Logs:');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const logs = await TradeLog.find({
      userId: user._id,
      timestamp: { $gte: today, $lt: tomorrow }
    }).sort({ timestamp: -1 }).limit(10);

    logs.forEach((log, index) => {
      console.log(`  ${index + 1}. ${log.timestamp.toLocaleString()}`);
      console.log(`     ${log.symbol} ${log.side} ${log.quantity} @ ${log.price}`);
      console.log(`     Status: ${log.status}, Type: ${log.orderType}`);
      console.log(`     Remarks: ${log.remarks}`);
    });

    // Test active position monitoring
    console.log('\n🔄 TESTING ACTIVE POSITION MONITORING:');
    console.log('='.repeat(80));

    if (state.activePositions && state.activePositions.length > 0) {
      console.log('Running updateActivePositions...');
      const result = await MonitoringService.updateActivePositions(user._id);
      console.log('Result:', result);

      // Get updated state
      state = await TradingState.findOne({ userId: user._id });
      console.log('\n📊 UPDATED ACTIVE POSITIONS:');
      if (state.activePositions && state.activePositions.length > 0) {
        state.activePositions.forEach((position, index) => {
          console.log(`  ${index + 1}. ${position.symbol}`);
          console.log(`     Status: ${position.status}`);
          console.log(`     Current Price: ${position.currentPrice}`);
          console.log(`     P&L: ₹${position.pnl || 0}`);
          console.log(`     Order Status: ${position.orderStatus || 'N/A'}`);
        });
      }
    } else {
      console.log('No active positions to test');
    }

    // Test re-entry logic
    console.log('\n🔄 TESTING RE-ENTRY LOGIC:');
    console.log('='.repeat(80));

    // Simulate a closed position and test re-entry
    const closedPositions = state.activePositions?.filter(p => p.status !== 'Active') || [];
    if (closedPositions.length > 0) {
      console.log(`Found ${closedPositions.length} closed positions for re-entry testing`);
      
      for (const closedPosition of closedPositions) {
        console.log(`\nTesting re-entry for ${closedPosition.symbol}:`);
        
        // Get current LTP and HMA
        const liveQuote = await MonitoringService.getLiveQuote(closedPosition.symbol, user._id);
        const HMAService = require('./services/hmaService');
        const hmaData = await HMAService.fetchAndCalculateHMA(closedPosition.symbol, user);
        
        if (liveQuote && hmaData) {
          const ltp = liveQuote.ltp;
          const hmaValue = hmaData.currentHMA || hmaData.hmaValue;
          
          console.log(`  Current LTP: ${ltp}`);
          console.log(`  Current HMA: ${hmaValue}`);
          console.log(`  LTP > HMA: ${ltp > hmaValue}`);
          
          let expectedStatus = 'WAITING_FOR_REVERSAL';
          if (ltp <= hmaValue) {
            expectedStatus = 'WAITING_FOR_ENTRY';
          }
          
          console.log(`  Expected Re-entry Status: ${expectedStatus}`);
        }
      }
    } else {
      console.log('No closed positions found for re-entry testing');
    }

    console.log('\n✅ Active Position Lifecycle Test Completed');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await mongoose.disconnect();
  }
}

testActivePositionLifecycle(); 