const mongoose = require('mongoose');

async function checkDatabase() {
  try {
    console.log('🔍 Connecting to database...\n');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/victory');
    console.log('✅ Connected to MongoDB\n');
    
    // List all collections
    const collections = await mongoose.connection.db.listCollections().toArray();
    console.log('📚 Collections in database:');
    collections.forEach(collection => {
      console.log(`  - ${collection.name}`);
    });
    
    console.log('\n📊 Collection details:');
    
    // Check each collection
    for (const collection of collections) {
      const count = await mongoose.connection.db.collection(collection.name).countDocuments();
      console.log(`  ${collection.name}: ${count} documents`);
      
      if (count > 0) {
        // Show a sample document
        const sample = await mongoose.connection.db.collection(collection.name).findOne();
        console.log(`    Sample keys: ${Object.keys(sample).join(', ')}`);
      }
    }
    
    // Check if we can access the models
    try {
      const User = require('./models/User');
      const userCount = await User.countDocuments();
      console.log(`\n👥 Users: ${userCount}`);
      
      if (userCount > 0) {
        const users = await User.find({}).select('email fyers').limit(3);
        console.log('Sample users:');
        users.forEach(user => {
          console.log(`  - ${user.email} (Fyers: ${user.fyers ? 'Connected' : 'Not connected'})`);
        });
      }
    } catch (error) {
      console.log(`❌ Error accessing User model: ${error.message}`);
    }
    
    try {
      const TradingState = require('./models/TradingState');
      const stateCount = await TradingState.countDocuments();
      console.log(`📈 Trading States: ${stateCount}`);
    } catch (error) {
      console.log(`❌ Error accessing TradingState model: ${error.message}`);
    }
    
    console.log('\n✅ Database check completed');
    
  } catch (error) {
    console.error('❌ Error checking database:', error);
  } finally {
    await mongoose.disconnect();
  }
}

checkDatabase(); 