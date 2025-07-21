const mongoose = require('mongoose');
const TradeLog = require('./models/TradeLog');
const TradingState = require('./models/TradingState');
require('dotenv').config();

async function checkTradeLogs() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Get today's trade logs
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const logs = await TradeLog.find({
      timestamp: { $gte: today, $lt: tomorrow }
    }).sort({ timestamp: -1 }).limit(50);

    console.log(`📊 Found ${logs.length} trade logs today:`);
    console.log('='.repeat(80));

    logs.forEach((log, index) => {
      console.log(`${index + 1}. ${log.timestamp.toLocaleString()}`);
      console.log(`   Symbol: ${log.symbol}`);
      console.log(`   Action: ${log.side} ${log.quantity} @ ${log.price}`);
      console.log(`   Status: ${log.status}`);
      console.log(`   Order Type: ${log.orderType}`);
      console.log(`   Remarks: ${log.remarks}`);
      console.log(`   Fyers Order ID: ${log.fyersOrderId || 'N/A'}`);
      console.log(`   Order ID: ${log.orderId || 'N/A'}`);
      console.log('-'.repeat(40));
    });

    // Check for duplicate orders
    const symbolGroups = {};
    logs.forEach(log => {
      if (!symbolGroups[log.symbol]) {
        symbolGroups[log.symbol] = [];
      }
      symbolGroups[log.symbol].push(log);
    });

    console.log('\n🔍 Checking for duplicate orders:');
    console.log('='.repeat(80));

    Object.keys(symbolGroups).forEach(symbol => {
      const symbolLogs = symbolGroups[symbol];
      if (symbolLogs.length > 1) {
        console.log(`⚠️  DUPLICATE ORDERS DETECTED for ${symbol}:`);
        symbolLogs.forEach((log, index) => {
          console.log(`   ${index + 1}. ${log.timestamp.toLocaleString()} - ${log.side} ${log.quantity} @ ${log.price} - ${log.status}`);
        });
        console.log('');
      }
    });

    // Check trading states
    console.log('\n📊 Current Trading States:');
    console.log('='.repeat(80));

    const states = await TradingState.find({});
    states.forEach(state => {
      console.log(`User: ${state.userId}`);
      console.log(`Monitoring Active: ${state.tradeExecutionState?.isMonitoring || false}`);
      console.log(`Monitored Symbols: ${state.monitoredSymbols?.length || 0}`);
      console.log(`Active Positions: ${state.activePositions?.length || 0}`);
      
      if (state.monitoredSymbols && state.monitoredSymbols.length > 0) {
        console.log('  Monitored Symbols:');
        state.monitoredSymbols.forEach(symbol => {
          console.log(`    - ${symbol.symbol}: ${symbol.triggerStatus}`);
          console.log(`      Order Placed: ${symbol.orderPlaced}, Order Status: ${symbol.orderStatus}`);
          console.log(`      Opportunity Active: ${symbol.opportunityActive}`);
          console.log(`      Pending Signal: ${symbol.pendingSignal ? 'Yes' : 'No'}`);
        });
      }
      
      if (state.activePositions && state.activePositions.length > 0) {
        console.log('  Active Positions:');
        state.activePositions.forEach(pos => {
          console.log(`    - ${pos.symbol}: ${pos.status} @ ${pos.boughtPrice}`);
        });
      }
      console.log('');
    });

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
  }
}

checkTradeLogs(); 