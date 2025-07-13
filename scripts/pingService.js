/**
 * Ping Service for Render Instance
 * Keeps the instance warm during market hours (8:30 AM to 4:30 PM IST, weekdays)
 */

const https = require('https');
const http = require('http');

// Configuration
const APP_URL = process.env.APP_URL || 'https://your-app-name.onrender.com';
const PING_INTERVAL = 5 * 60 * 1000; // 5 minutes
const LOG_PREFIX = '[PingService]';

// Market hours configuration (IST)
const MARKET_START_HOUR = 8;
const MARKET_START_MINUTE = 30;
const MARKET_END_HOUR = 16;
const MARKET_END_MINUTE = 30;

// Helper function to get current IST time
function getCurrentISTTime() {
  const now = new Date();
  const istTime = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  return istTime;
}

// Helper function to check if it's a weekday
function isWeekday(date) {
  const day = date.getDay();
  return day >= 1 && day <= 5; // Monday = 1, Friday = 5
}

// Helper function to check if it's market hours
function isMarketHours(date) {
  const hour = date.getHours();
  const minute = date.getMinutes();
  const currentTime = hour * 60 + minute;
  const marketStart = MARKET_START_HOUR * 60 + MARKET_START_MINUTE;
  const marketEnd = MARKET_END_HOUR * 60 + MARKET_END_MINUTE;
  
  return currentTime >= marketStart && currentTime <= marketEnd;
}

// Helper function to check if we should ping
function shouldPing() {
  const istTime = getCurrentISTTime();
  const isWeekdayNow = isWeekday(istTime);
  const isMarketHoursNow = isMarketHours(istTime);
  
  console.log(`${LOG_PREFIX} Current IST: ${istTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
  console.log(`${LOG_PREFIX} Is Weekday: ${isWeekdayNow}`);
  console.log(`${LOG_PREFIX} Is Market Hours: ${isMarketHoursNow}`);
  
  return isWeekdayNow && isMarketHoursNow;
}

// Helper function to make HTTP request
function makeRequest(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https:') ? https : http;
    
    const req = protocol.get(url, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          resolve({
            statusCode: res.statusCode,
            data: response
          });
        } catch (error) {
          resolve({
            statusCode: res.statusCode,
            data: data
          });
        }
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

// Main ping function
async function pingServer() {
  try {
    const istTime = getCurrentISTTime();
    console.log(`${LOG_PREFIX} Pinging server at ${istTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
    
    const response = await makeRequest(`${APP_URL}/api/health`);
    
    if (response.statusCode === 200) {
      console.log(`${LOG_PREFIX} ✅ Ping successful - Status: ${response.data.status}`);
      console.log(`${LOG_PREFIX} 📊 Server IST Time: ${response.data.istTime}`);
      console.log(`${LOG_PREFIX} 🔗 Database Connected: ${response.data.dbConnected}`);
      console.log(`${LOG_PREFIX} ⏱️  Uptime: ${Math.round(response.data.uptime / 60)} minutes`);
    } else {
      console.log(`${LOG_PREFIX} ⚠️  Ping returned status ${response.statusCode}`);
    }
  } catch (error) {
    console.error(`${LOG_PREFIX} ❌ Ping failed:`, error.message);
  }
}

// Main function
function startPingService() {
  console.log(`${LOG_PREFIX} 🚀 Starting ping service...`);
  console.log(`${LOG_PREFIX} 📍 Target URL: ${APP_URL}`);
  console.log(`${LOG_PREFIX} ⏰ Ping Interval: ${PING_INTERVAL / 1000} seconds`);
  console.log(`${LOG_PREFIX} 🕐 Market Hours: ${MARKET_START_HOUR}:${MARKET_START_MINUTE.toString().padStart(2, '0')} - ${MARKET_END_HOUR}:${MARKET_END_MINUTE.toString().padStart(2, '0')} IST (Weekdays)`);
  
  // Initial ping
  pingServer();
  
  // Set up interval
  setInterval(() => {
    if (shouldPing()) {
      pingServer();
    } else {
      const istTime = getCurrentISTTime();
      console.log(`${LOG_PREFIX} 💤 Outside market hours or weekend - skipping ping`);
      console.log(`${LOG_PREFIX} ⏰ Next check in ${PING_INTERVAL / 1000} seconds`);
    }
  }, PING_INTERVAL);
  
  console.log(`${LOG_PREFIX} ✅ Ping service started successfully`);
}

// Handle process termination
process.on('SIGINT', () => {
  console.log(`${LOG_PREFIX} 🛑 Ping service stopped`);
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log(`${LOG_PREFIX} 🛑 Ping service stopped`);
  process.exit(0);
});

// Start the service
if (require.main === module) {
  startPingService();
}

module.exports = { startPingService, pingServer, shouldPing }; 