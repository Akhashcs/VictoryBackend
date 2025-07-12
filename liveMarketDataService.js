const axios = require('axios');

// Define static symbols for now to avoid circular dependency
const VALID_INDEX_SYMBOLS = [
  // Symbols will be loaded dynamically from symbol configuration
];

function validateSymbol(symbol) {
  if (!VALID_INDEX_SYMBOLS.includes(symbol)) {
    console.warn(`Warning: Unknown symbol ${symbol}, attempting to fetch anyway...`);
    // Don't throw error, just warn - let Fyers API decide if symbol is valid
  }
}

// Helper function to implement retry logic
async function retryOperation(operation, maxRetries = 3, delay = 1000) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      console.log(`Attempt ${attempt}/${maxRetries} failed: ${error.message}`);
      lastError = error;
      
      // If this is not the last attempt, wait before retrying
      if (attempt < maxRetries) {
        const backoffDelay = delay * Math.pow(2, attempt - 1) + Math.random() * 1000;
        console.log(`Retrying in ${Math.round(backoffDelay)}ms...`);
        await new Promise(resolve => setTimeout(resolve, backoffDelay));
      }
    }
  }
  
  throw lastError;
}

async function getMultipleLiveMarketData(symbols, accessToken) {
  try {
    if (!Array.isArray(symbols) || symbols.length === 0) {
      throw new Error('Symbols must be a non-empty array');
    }
    symbols.forEach(validateSymbol);
    if (!accessToken) {
      throw new Error('No access token provided');
    }
    
    console.log('Requesting symbols:', symbols);
    
    // Use retry logic for the API call
    return await retryOperation(async () => {
      const response = await axios.get('https://api-t1.fyers.in/data/quotes', {
        params: { symbols: symbols.join(',') },
        headers: { 'Authorization': accessToken },
        timeout: 15000 // Increased timeout
      });
      
      // Log response status
      console.log(`Fyers API response status: ${response.status}, data status: ${response.data?.s}`);
      
      if (response.data && response.data.s === 'ok' && response.data.d) {
        const processedQuotes = response.data.d.map(quote => ({
          symbol: quote.n,
          ltp: quote.v.lp || 0,
          open: quote.v.open_price || 0,
          high: quote.v.high_price || 0,
          low: quote.v.low_price || 0,
          close: quote.v.prev_close_price || 0,
          volume: quote.v.volume || 0,
          change: quote.v.ch || 0,
          changePercent: quote.v.chp || 0,
          timestamp: new Date((quote.v.tt || Date.now() / 1000) * 1000)
        }));
        
        // Debug log for commodity symbols
        processedQuotes.forEach(quote => {
          if (quote.symbol.includes('MCX:')) {
            console.log(`[LiveMarketData] Commodity data for ${quote.symbol}:`, {
              ltp: quote.ltp,
              change: quote.change,
              changePercent: quote.changePercent,
              open: quote.open,
              close: quote.close
            });
          }
        });
        
        return processedQuotes;
      } else {
        // Provide more detailed error information
        const errorMessage = response.data?.message || 'Unknown API error';
        const errorCode = response.data?.code || 'N/A';
        throw new Error(`Fyers API error: ${errorMessage} (Code: ${errorCode})`);
      }
    }, 3, 1000);
  } catch (error) {
    console.error('Market data fetch error:', error);
    
    // Provide more context in the error
    const enhancedError = new Error(`Failed to fetch market data: ${error.message}`);
    enhancedError.originalError = error;
    enhancedError.symbols = symbols;
    
    // If we're in development mode, return mock data instead of failing
    if (process.env.NODE_ENV !== 'production') {
      console.log('⚠️ Development mode: Returning mock data for symbols:', symbols);
      return symbols.map(symbol => ({
        symbol,
        ltp: Math.random() * 1000 + 500,
        open: Math.random() * 1000 + 500,
        high: Math.random() * 1000 + 550,
        low: Math.random() * 1000 + 450,
        close: Math.random() * 1000 + 500,
        volume: Math.floor(Math.random() * 10000),
        change: Math.random() * 20 - 10,
        changePercent: Math.random() * 2 - 1,
        timestamp: new Date(),
        isMockData: true
      }));
    }
    
    throw enhancedError;
  }
}

module.exports = {
  getMultipleLiveMarketData,
  VALID_INDEX_SYMBOLS
}; 