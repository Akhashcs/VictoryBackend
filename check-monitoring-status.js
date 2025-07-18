const mongoose = require('mongoose');
const TradingState = require('./models/TradingState');

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/victory', {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

async function checkMonitoringStatus() {
  try {
    console.log('🔍 Checking monitoring status...\n');
    
    // Get all trading states
    const states = await TradingState.find({});
    console.log(`📊 Found ${states.length} trading states\n`);
    
    if (states.length === 0) {
      console.log('❌ No trading states found');
      return;
    }
    
    for (const state of states) {
      console.log(`👤 User: ${state.userId}`);
      console.log(`📈 Monitoring Active: ${state.tradeExecutionState?.isMonitoring || false}`);
      console.log(`📊 Monitored Symbols: ${state.monitoredSymbols?.length || 0}`);
      console.log(`💰 Active Positions: ${state.activePositions?.length || 0}`);
      
      // Check monitored symbols
      if (state.monitoredSymbols && state.monitoredSymbols.length > 0) {
        console.log('\n📋 Monitored Symbols:');
        state.monitoredSymbols.forEach((symbol, index) => {
          console.log(`  ${index + 1}. ${symbol.symbol} (${symbol.type})`);
          console.log(`     Status: ${symbol.triggerStatus || 'NOT_SET'}`);
          console.log(`     LTP: ${symbol.currentLTP || 'N/A'}`);
          console.log(`     HMA: ${symbol.hmaValue || 'N/A'}`);
          console.log(`     Order ID: ${symbol.orderId || 'N/A'}`);
          console.log(`     Order Status: ${symbol.orderStatus || 'N/A'}`);
          console.log(`     Order Placed: ${symbol.orderPlaced || false}`);
          console.log(`     Last Update: ${symbol.lastUpdate || 'N/A'}`);
          
          // Check for schema issues
          if (!symbol.triggerStatus) {
            console.log(`     ⚠️  SCHEMA ISSUE: Missing triggerStatus`);
          }
          if (!symbol.id) {
            console.log(`     ⚠️  SCHEMA ISSUE: Missing id`);
          }
          console.log('');
        });
      }
      
      // Check active positions
      if (state.activePositions && state.activePositions.length > 0) {
        console.log('\n💰 Active Positions:');
        state.activePositions.forEach((position, index) => {
          console.log(`  ${index + 1}. ${position.symbol} (${position.type})`);
          console.log(`     Status: ${position.status || 'NOT_SET'}`);
          console.log(`     Order Status: ${position.orderStatus || 'N/A'}`);
          console.log(`     Buy Order ID: ${position.buyOrderId || 'N/A'}`);
          console.log(`     Sell Order ID: ${position.sellOrderId || 'N/A'}`);
          console.log(`     SL Order ID: ${position.slOrderId || 'N/A'}`);
          console.log(`     Bought Price: ${position.boughtPrice || 'N/A'}`);
          console.log(`     Current Price: ${position.currentPrice || 'N/A'}`);
          console.log(`     PnL: ${position.pnl || 'N/A'}`);
          console.log(`     Invested: ${position.invested || 'N/A'}`);
          
          // Check for schema issues
          if (!position.status) {
            console.log(`     ⚠️  SCHEMA ISSUE: Missing status`);
          }
          if (!position.id) {
            console.log(`     ⚠️  SCHEMA ISSUE: Missing id`);
          }
          if (!position.buyOrderId && position.orderStatus === 'FILLED') {
            console.log(`     ⚠️  SCHEMA ISSUE: Filled order without buyOrderId`);
          }
          console.log('');
        });
      }
      
      // Check for pending orders
      const pendingOrders = state.activePositions?.filter(p => p.status === 'Pending') || [];
      if (pendingOrders.length > 0) {
        console.log(`\n⏳ Pending Orders: ${pendingOrders.length}`);
        pendingOrders.forEach((order, index) => {
          console.log(`  ${index + 1}. ${order.symbol} (${order.type})`);
          console.log(`     Order Status: ${order.orderStatus || 'N/A'}`);
          console.log(`     Buy Order ID: ${order.buyOrderId || 'N/A'}`);
          console.log(`     Bought Price: ${order.boughtPrice || 'N/A'}`);
          console.log(`     Trigger Price: ${order.triggerPrice || 'N/A'}`);
          console.log('');
        });
      }
      
      console.log('─'.repeat(80));
      console.log('');
    }
    
    // Check for common issues
    console.log('🔍 Checking for common issues...\n');
    
    // Check for symbols without triggerStatus
    const symbolsWithoutStatus = states.flatMap(s => 
      s.monitoredSymbols?.filter(sym => !sym.triggerStatus) || []
    );
    if (symbolsWithoutStatus.length > 0) {
      console.log(`⚠️  Found ${symbolsWithoutStatus.length} symbols without triggerStatus`);
    }
    
    // Check for positions without status
    const positionsWithoutStatus = states.flatMap(s => 
      s.activePositions?.filter(pos => !pos.status) || []
    );
    if (positionsWithoutStatus.length > 0) {
      console.log(`⚠️  Found ${positionsWithoutStatus.length} positions without status`);
    }
    
    // Check for filled orders without buyOrderId
    const filledWithoutOrderId = states.flatMap(s => 
      s.activePositions?.filter(pos => pos.orderStatus === 'FILLED' && !pos.buyOrderId) || []
    );
    if (filledWithoutOrderId.length > 0) {
      console.log(`⚠️  Found ${filledWithoutOrderId.length} filled positions without buyOrderId`);
    }
    
    // Check for symbols with orderId but not in activePositions
    const symbolsWithOrders = states.flatMap(s => 
      s.monitoredSymbols?.filter(sym => sym.orderId && sym.orderStatus === 'FILLED') || []
    );
    const activePositionsWithOrders = states.flatMap(s => 
      s.activePositions?.filter(pos => pos.buyOrderId) || []
    );
    
    const orphanedOrders = symbolsWithOrders.filter(sym => 
      !activePositionsWithOrders.some(pos => pos.buyOrderId === sym.orderId)
    );
    if (orphanedOrders.length > 0) {
      console.log(`⚠️  Found ${orphanedOrders.length} filled orders not in activePositions`);
    }
    
    console.log('\n✅ Status check completed');
    
  } catch (error) {
    console.error('❌ Error checking monitoring status:', error);
  } finally {
    mongoose.disconnect();
  }
}

checkMonitoringStatus(); 