# Historical Data Download Script

This script downloads historical data for 50 stocks from June 18th 2023 to June 15th 2024, computes weekly candles, and calculates HMA values.

## Features

- Downloads daily data for 50 NSE stocks
- Computes weekly candles from daily data
- Calculates HMA (Hull Moving Average) using 55-period
- Generates daily and weekly signals
- Saves data to MongoDB collections

## Prerequisites

1. **Fyers Access Token**: You need a valid Fyers access token
2. **MongoDB**: Ensure MongoDB is running
3. **Environment Variables**: Set up your environment variables

## Setup

1. **Set Environment Variables**:
   ```bash
   # Create a .env file in VictorBackend directory
   MONGODB_URI=mongodb://localhost:27017/victory
   FYERS_ACCESS_TOKEN=your_fyers_access_token_here
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

## Usage

### Method 1: Using the runner script
```bash
cd VictorBackend
node run-download.js
```

### Method 2: Direct execution
```bash
cd VictorBackend
node scripts/downloadHistoricalData.js
```

## What the Script Does

1. **Downloads Daily Data**: Fetches daily OHLCV data for each stock
2. **Computes Weekly Candles**: Aggregates daily data into weekly candles
3. **Calculates HMA**: Uses the latest 55 weekly closes to calculate HMA
4. **Generates Signals**: Compares current prices with HMA for buy/sell signals
5. **Saves to MongoDB**: Stores data in three collections:
   - `50stocksdailydata`: Daily OHLCV data
   - `50stockweeklydata`: Weekly OHLCV data
   - `50stockshma`: HMA values and signals

## Collections Created

### Daily Data (`50stocksdailydata`)
```javascript
{
  symbol: "NSE:RELIANCE-EQ",
  date: "2023-06-18",
  open: 2450.50,
  high: 2480.25,
  low: 2440.10,
  close: 2475.80,
  volume: 1234567,
  timestamp: Date
}
```

### Weekly Data (`50stockweeklydata`)
```javascript
{
  symbol: "NSE:RELIANCE-EQ",
  week_start_date: "2023-06-19",
  open: 2450.50,
  high: 2520.75,
  low: 2440.10,
  close: 2510.25,
  volume: 5678901,
  candle_count: 5
}
```

### HMA Signals (`50stockshma`)
```javascript
{
  symbol: "NSE:RELIANCE-EQ",
  hma_value: 2485.75,
  daily_signal: "BUY",
  weekly_signal: "BUY",
  last_daily_close: 2510.25,
  last_weekly_close: 2510.25,
  last_updated: Date
}
```

## Stock List

The script processes the following 50 stocks:
- HDFCLIFE, CIPLA, UPL, BPCL, TATACONSUM
- SBILIFE, DRREDDY, LT, APOLLOHOSP, COALINDIA
- ITC, BRITANNIA, JSWSTEEL, HINDUNILVR, EICHERMOT
- BHARTIARTL, AXISBANK, NESTLEIND, TITAN, KOTAKBANK
- TATASTEEL, BAJAJ-AUTO, HINDALCO, SBIN, M&M
- ASIANPAINT, HCLTECH, POWERGRID, BAJFINANCE, BAJAJFINSV
- TATAMOTORS, RELIANCE, GRASIM, MARUTI, WIPRO
- NTPC, ICICIBANK, INDUSINDBK, HDFCBANK, TCS
- SHREECEM, SUNPHARMA, ULTRACEMCO, ONGC, INFY
- TECHM, HEROMOTOCO, DIVISLAB, ADANIPORTS

## Error Handling

- The script continues processing even if some stocks fail
- Rate limiting is implemented (1 second delay between requests)
- Failed downloads are logged but don't stop the script
- MongoDB connection errors will stop the script

## Monitoring

The script provides detailed console output:
- ✅ Success messages for each step
- ❌ Error messages for failures
- 📊 Progress indicators
- 📈 Data statistics

## Notes

- The script respects Fyers API limits
- Data is saved with upsert operations (no duplicates)
- HMA calculation uses the standard Pine Script formula
- Weekly candles are computed from Monday to Friday
- All timestamps are in IST (Indian Standard Time) 