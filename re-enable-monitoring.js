const { MonitoringScheduler } = require('./services/monitoringScheduler');
const { MarketService } = require('./services/marketService');

console.log('🔄 Re-enabling monitoring services...');

// Re-enable market data polling
MarketService.startMarketDataPolling();
console.log('✅ Market data polling re-enabled');

// Re-enable monitoring scheduler
MonitoringScheduler.start();
console.log('✅ Monitoring scheduler re-enabled');

console.log('🎉 All monitoring services re-enabled successfully!');
console.log('💡 The server will now resume normal operation with your new Fyers token.'); 