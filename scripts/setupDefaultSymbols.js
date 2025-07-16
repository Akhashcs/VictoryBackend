const mongoose = require('mongoose');
const SymbolConfig = require('../models/SymbolConfig');
require('dotenv').config();

// Default symbol configurations
const defaultSymbols = [
  // Indices
  {
    symbolName: 'NIFTY',
    symbolInput: 'NSE:NIFTY50-INDEX',
    tabType: 'index',
    optionSymbolFormat: 'NSE:NIFTY{YY}{MMM}{STRIKE}{TYPE}',
    nextExpiry: 'weekly',
    strikeInterval: 50,
    lotSize: 75
  },
  {
    symbolName: 'BANKNIFTY',
    symbolInput: 'NSE:NIFTYBANK-INDEX',
    tabType: 'index',
    optionSymbolFormat: 'NSE:BANKNIFTY{YY}{MMM}{STRIKE}{TYPE}',
    nextExpiry: 'monthly',
    strikeInterval: 100,
    lotSize: 35
  },
  {
    symbolName: 'SENSEX',
    symbolInput: 'BSE:SENSEX-INDEX',
    tabType: 'index',
    optionSymbolFormat: 'BSE:SENSEX{YY}{MMM}{STRIKE}{TYPE}',
    nextExpiry: 'weekly',
    strikeInterval: 100,
    lotSize: 20
  },
  
  // Stocks
  {
    symbolName: 'TATASTEEL',
    symbolInput: 'NSE:TATASTEEL-EQ',
    tabType: 'stock',
    optionSymbolFormat: '',
    nextExpiry: 'none',
    strikeInterval: 50,
    lotSize: 1
  },
  {
    symbolName: 'HINDALCO',
    symbolInput: 'NSE:HINDALCO-EQ',
    tabType: 'stock',
    optionSymbolFormat: '',
    nextExpiry: 'none',
    strikeInterval: 50,
    lotSize: 1
  },
  {
    symbolName: 'SBIN',
    symbolInput: 'NSE:SBIN-EQ',
    tabType: 'stock',
    optionSymbolFormat: '',
    nextExpiry: 'none',
    strikeInterval: 50,
    lotSize: 1
  },
  {
    symbolName: 'ADANIPORTS',
    symbolInput: 'NSE:ADANIPORTS-EQ',
    tabType: 'stock',
    optionSymbolFormat: '',
    nextExpiry: 'none',
    strikeInterval: 50,
    lotSize: 1
  },
  {
    symbolName: 'WIPRO',
    symbolInput: 'NSE:WIPRO-EQ',
    tabType: 'stock',
    optionSymbolFormat: '',
    nextExpiry: 'none',
    strikeInterval: 50,
    lotSize: 1
  },
  {
    symbolName: 'GRASIM',
    symbolInput: 'NSE:GRASIM-EQ',
    tabType: 'stock',
    optionSymbolFormat: '',
    nextExpiry: 'none',
    strikeInterval: 50,
    lotSize: 1
  },
  {
    symbolName: 'HCLTECH',
    symbolInput: 'NSE:HCLTECH-EQ',
    tabType: 'stock',
    optionSymbolFormat: '',
    nextExpiry: 'none',
    strikeInterval: 50,
    lotSize: 1
  },
  {
    symbolName: 'BPCL',
    symbolInput: 'NSE:BPCL-EQ',
    tabType: 'stock',
    optionSymbolFormat: '',
    nextExpiry: 'none',
    strikeInterval: 50,
    lotSize: 1
  },
  {
    symbolName: 'M_M',
    symbolInput: 'NSE:M&M-EQ',
    tabType: 'stock',
    optionSymbolFormat: '',
    nextExpiry: 'none',
    strikeInterval: 50,
    lotSize: 1
  },
  {
    symbolName: 'COALINDIA',
    symbolInput: 'NSE:COALINDIA-EQ',
    tabType: 'stock',
    optionSymbolFormat: '',
    nextExpiry: 'none',
    strikeInterval: 50,
    lotSize: 1
  },
  {
    symbolName: 'SBILIFE',
    symbolInput: 'NSE:SBILIFE-EQ',
    tabType: 'stock',
    optionSymbolFormat: '',
    nextExpiry: 'none',
    strikeInterval: 50,
    lotSize: 1
  },
  {
    symbolName: 'BAJFINANCE',
    symbolInput: 'NSE:BAJFINANCE-EQ',
    tabType: 'stock',
    optionSymbolFormat: '',
    nextExpiry: 'none',
    strikeInterval: 50,
    lotSize: 1
  },
  {
    symbolName: 'BHARTIARTL',
    symbolInput: 'NSE:BHARTIARTL-EQ',
    tabType: 'stock',
    optionSymbolFormat: '',
    nextExpiry: 'none',
    strikeInterval: 50,
    lotSize: 1
  },
  {
    symbolName: 'DRREDDY',
    symbolInput: 'NSE:DRREDDY-EQ',
    tabType: 'stock',
    optionSymbolFormat: '',
    nextExpiry: 'none',
    strikeInterval: 50,
    lotSize: 1
  },
  {
    symbolName: 'HDFCBANK',
    symbolInput: 'NSE:HDFCBANK-EQ',
    tabType: 'stock',
    optionSymbolFormat: '',
    nextExpiry: 'none',
    strikeInterval: 50,
    lotSize: 1
  },
  {
    symbolName: 'HEROMOTOCO',
    symbolInput: 'NSE:HEROMOTOCO-EQ',
    tabType: 'stock',
    optionSymbolFormat: '',
    nextExpiry: 'none',
    strikeInterval: 50,
    lotSize: 1
  },
  {
    symbolName: 'ONGC',
    symbolInput: 'NSE:ONGC-EQ',
    tabType: 'stock',
    optionSymbolFormat: '',
    nextExpiry: 'none',
    strikeInterval: 50,
    lotSize: 1
  },
  {
    symbolName: 'SUNPHARMA',
    symbolInput: 'NSE:SUNPHARMA-EQ',
    tabType: 'stock',
    optionSymbolFormat: '',
    nextExpiry: 'none',
    strikeInterval: 50,
    lotSize: 1
  },
  {
    symbolName: 'APOLLOHOSP',
    symbolInput: 'NSE:APOLLOHOSP-EQ',
    tabType: 'stock',
    optionSymbolFormat: '',
    nextExpiry: 'none',
    strikeInterval: 50,
    lotSize: 1
  },
  {
    symbolName: 'ICICIBANK',
    symbolInput: 'NSE:ICICIBANK-EQ',
    tabType: 'stock',
    optionSymbolFormat: '',
    nextExpiry: 'none',
    strikeInterval: 50,
    lotSize: 1
  },
  
  // Commodities
  {
    symbolName: 'GOLD',
    symbolInput: 'MCX:GOLD25AUGFUT',
    tabType: 'commodity',
    optionSymbolFormat: 'MCX:GOLD{YY}{MMM}{STRIKE}{TYPE}',
    nextExpiry: 'monthly',
    strikeInterval: 100,
    lotSize: 100
  },
  {
    symbolName: 'SILVER',
    symbolInput: 'MCX:SILVER25AUGFUT',
    tabType: 'commodity',
    optionSymbolFormat: 'MCX:SILVER{YY}{MMM}{STRIKE}{TYPE}',
    nextExpiry: 'monthly',
    strikeInterval: 100,
    lotSize: 30
  },
  {
    symbolName: 'CRUDEOIL',
    symbolInput: 'MCX:CRUDEOIL25AUGFUT',
    tabType: 'commodity',
    optionSymbolFormat: 'MCX:CRUDEOIL{YY}{MMM}{STRIKE}{TYPE}',
    nextExpiry: 'monthly',
    strikeInterval: 100,
    lotSize: 100
  },
  {
    symbolName: 'COPPER',
    symbolInput: 'MCX:COPPER25AUGFUT',
    tabType: 'commodity',
    optionSymbolFormat: 'MCX:COPPER{YY}{MMM}{STRIKE}{TYPE}',
    nextExpiry: 'monthly',
    strikeInterval: 5,
    lotSize: 2500
  },
  {
    symbolName: 'NICKEL',
    symbolInput: 'MCX:NICKEL25AUGFUT',
    tabType: 'commodity',
    optionSymbolFormat: 'MCX:NICKEL{YY}{MMM}{STRIKE}{TYPE}',
    nextExpiry: 'monthly',
    strikeInterval: 10,
    lotSize: 1500
  }
];

async function setupDefaultSymbols() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Clear existing symbols
    await SymbolConfig.deleteMany({});
    console.log('Cleared existing symbol configurations');

    // Insert default symbols
    const result = await SymbolConfig.insertMany(defaultSymbols);
    console.log(`Successfully inserted ${result.length} symbol configurations`);

    // Log the symbols that were inserted
    console.log('\nInserted symbols:');
    result.forEach(symbol => {
      console.log(`- ${symbol.symbolName} (${symbol.tabType}): ${symbol.symbolInput}`);
    });

    console.log('\nDefault symbol configurations setup completed successfully!');
  } catch (error) {
    console.error('Error setting up default symbols:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

// Run the setup
setupDefaultSymbols(); 