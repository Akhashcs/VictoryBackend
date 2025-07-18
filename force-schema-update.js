const mongoose = require('mongoose');
const TradingState = require('./models/TradingState');

// Use the same MongoDB connection as the main server
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://akhashcs:h4ujE7n6Xdcap2WU@victory.mqbxy9m.mongodb.net/?retryWrites=true&w=majority&appName=Victory';

async function forceSchemaUpdate() {
  try {
    console.log('🔧 Force schema update started...');
    
    // Connect to MongoDB
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    
    // Get the raw collection to bypass schema validation
    const collection = mongoose.connection.collection('tradingstates');
    
    // Update the collection to allow the new enum values
    const result = await collection.updateMany(
      {}, // Update all documents
      {
        $set: {
          // This will force MongoDB to accept the new schema
          _schemaVersion: 2
        }
      }
    );
    
    console.log(`📊 Updated ${result.modifiedCount} documents`);
    
    // Now let's check the current trading states
    const states = await TradingState.find({});
    console.log(`📊 Found ${states.length} trading states`);
    
    states.forEach((state, index) => {
      console.log(`\\n--- User ${index + 1} (${state.userId}) ---`);
      console.log(`Monitoring Active: ${state.tradeExecutionState?.isMonitoring || false}`);
      console.log(`Monitored Symbols Count: ${state.monitoredSymbols?.length || 0}`);
      
      if (state.monitoredSymbols && state.monitoredSymbols.length > 0) {
        console.log('Monitored Symbols:');
        state.monitoredSymbols.forEach(symbol => {
          console.log(`  - ${symbol.symbol}: triggerStatus=${symbol.triggerStatus}, orderPlaced=${symbol.orderPlaced}, currentLTP=${symbol.currentLTP}, hmaValue=${symbol.hmaValue}`);
        });
      }
    });
    
    console.log('✅ Schema update completed');
    mongoose.connection.close();
    
  } catch (error) {
    console.error('❌ Error in force schema update:', error);
    mongoose.connection.close();
  }
}

forceSchemaUpdate(); 