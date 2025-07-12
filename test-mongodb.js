const mongoose = require('mongoose');

const MONGODB_URI = 'mongodb+srv://akhashcs:h4ujE7n6Xdcap2WU@victory.mqbxy9m.mongodb.net/?retryWrites=true&w=majority&appName=Victory';

async function testConnection() {
  try {
    console.log('🔍 Testing MongoDB connection...');
    console.log('🔍 URI:', MONGODB_URI.replace(/\/\/[^:]+:[^@]+@/, '//***:***@'));
    
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 10000,
      connectTimeoutMS: 10000,
    });
    
    console.log('✅ MongoDB connected successfully!');
    console.log('📊 Database:', mongoose.connection.db.databaseName);
    console.log('🔗 Connection state:', mongoose.connection.readyState);
    
    await mongoose.disconnect();
    console.log('✅ Test completed successfully');
  } catch (error) {
    console.error('❌ MongoDB connection failed:');
    console.error('Error:', error.message);
    console.error('Code:', error.code);
    console.error('Name:', error.name);
  }
}

testConnection(); 