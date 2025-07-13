# Ping Service

## Overview
The ping service keeps the Render instance warm during market hours to prevent cold starts and ensure optimal performance.

## Configuration

### Market Hours
- **Start**: 8:30 AM IST (Weekdays only)
- **End**: 4:30 PM IST (Weekdays only)
- **Ping Interval**: Every 5 minutes

### Environment Variables
- `APP_URL`: Your Render app URL (e.g., `https://your-app-name.onrender.com`)

## Usage

### Start the ping service:
```bash
npm run ping
```

### Or run directly:
```bash
node scripts/pingService.js
```

## Features

✅ **Automatic scheduling** - Only pings during market hours on weekdays
✅ **Health check endpoint** - Uses `/api/health` to verify server status
✅ **Detailed logging** - Shows server status, database connection, uptime
✅ **Error handling** - Graceful handling of network issues
✅ **Resource efficient** - Skips pings outside market hours

## Log Output Example
```
[PingService] 🚀 Starting ping service...
[PingService] 📍 Target URL: https://your-app.onrender.com
[PingService] ⏰ Ping Interval: 300 seconds
[PingService] 🕐 Market Hours: 08:30 - 16:30 IST (Weekdays)
[PingService] ✅ Ping successful - Status: healthy
[PingService] 📊 Server IST Time: 13/07/2025, 10:30:45 AM
[PingService] 🔗 Database Connected: true
[PingService] ⏱️  Uptime: 120 minutes
```

## Deployment
The ping service should be run as a separate process to keep your Render instance warm during market hours. 