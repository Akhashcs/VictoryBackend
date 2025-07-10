/**
 * Runner script for historical data download
 * Usage: node run-download.js
 */

require('dotenv').config();
const HistoricalDataDownloader = require('./scripts/downloadHistoricalData');

async function main() {
  console.log('🚀 Starting Historical Data Download Script');
  console.log('==========================================');
  
  const downloader = new HistoricalDataDownloader();
  await downloader.run();
}

main().catch(console.error); 