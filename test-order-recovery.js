const mongoose = require('mongoose');
const { FyersWebSocketService } = require('./services/fyersWebSocketService');

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/victory');

async function testOrderRecovery() {
  try {
    console.log('🧪 Testing order recovery functionality...\n');
    
    // Test the order recovery function
    console.log('🔄 Testing order status recovery...');
    await FyersWebSocketService.recoverOrderStatuses();
    
    console.log('✅ Order recovery test completed');
    
  } catch (error) {
    console.error('❌ Error testing order recovery:', error);
  } finally {
    await mongoose.disconnect();
  }
}

testOrderRecovery(); 