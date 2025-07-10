/**
 * Symbol Service for generating option symbols based on index selection
 * Migrated from frontend to backend for server-side processing
 */
class SymbolService {
  static STRIKE_INTERVALS = {
    'NIFTY': 50,
    'BANKNIFTY': 100,
    'SENSEX': 100
  };

  static EXCHANGES = {
    'NIFTY': 'NSE',
    'BANKNIFTY': 'NSE',
    'SENSEX': 'BSE'
  };

  static BASE_SYMBOLS = {
    'NIFTY': 'NIFTY',
    'BANKNIFTY': 'BANKNIFTY',
    'SENSEX': 'SENSEX'
  };

  static EXPIRY_TYPES = {
    'NIFTY': 'weekly',
    'BANKNIFTY': 'monthly',
    'SENSEX': 'weekly'
  };

  // Helper: Get next weekday (Thursday=4, Tuesday=2)
  static getNextWeekday(date, weekday) {
    const d = new Date(date);
    const day = d.getDay();
    let offset = (weekday + 7 - day) % 7;
    if (offset === 0) offset = 7; // Always next, not today
    d.setDate(d.getDate() + offset);
    return d;
  }

  // Helper: Get last weekday of month
  static getLastWeekdayOfMonth(year, month, weekday) {
    // month: 0-based (0=Jan)
    const lastDay = new Date(year, month + 1, 0);
    let d = new Date(lastDay);
    while (d.getDay() !== weekday) {
      d.setDate(d.getDate() - 1);
    }
    return d;
  }

  // Helper: Is this the last weekday of the month?
  static isLastWeekdayOfMonth(date, weekday) {
    const last = this.getLastWeekdayOfMonth(date.getFullYear(), date.getMonth(), weekday);
    return (
      date.getDate() === last.getDate() &&
      date.getMonth() === last.getMonth() &&
      date.getFullYear() === last.getFullYear()
    );
  }

  // Helper: Is this Thursday in the last 7 days of the month?
  static isLastWeekOfMonth(date) {
    const lastDayOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    const last7Days = lastDayOfMonth.getDate() - 6; // Last 7 days
    return date.getDate() >= last7Days && date.getDay() === 4; // Thursday = 4
  }

  // Helper: Is this Tuesday in the last 7 days of the month? (for SENSEX)
  static isLastWeekOfMonthTuesday(date) {
    const lastDayOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    const last7Days = lastDayOfMonth.getDate() - 6; // Last 7 days
    return date.getDate() >= last7Days && date.getDay() === 2; // Tuesday = 2
  }

  // Helper: Check if market is closed and we should switch to next expiry
  static shouldSwitchToNextExpiry() {
    // Use IST timezone for market hours
    const now = new Date();
    const istTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const currentHour = istTime.getHours();
    const currentMinute = istTime.getMinutes();
    
    // After 15:30 IST (market close), switch to next expiry
    return (currentHour > 15 || (currentHour === 15 && currentMinute >= 30));
  }

  // Helper: Get next expiry date considering market close
  static getNextExpiryDate(indexType) {
    // Use IST timezone for date calculations
    const now = new Date();
    const istTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    
    if (indexType === 'SENSEX') {
      // SENSEX: next Tuesday
      return this.getNextWeekday(istTime, 2);
    } else if (indexType === 'BANKNIFTY') {
      // BANKNIFTY: last Thursday of current/next month
      const currentExpiry = this.getLastWeekdayOfMonth(istTime.getFullYear(), istTime.getMonth(), 4);
      
      // If current expiry has passed or market is closed on expiry day, use next month
      if (currentExpiry < istTime || (currentExpiry.toDateString() === istTime.toDateString() && this.shouldSwitchToNextExpiry())) {
        const nextMonth = istTime.getMonth() + 1;
        const nextMonthYear = nextMonth === 12 ? istTime.getFullYear() + 1 : istTime.getFullYear();
        const adjustedMonth = nextMonth === 12 ? 0 : nextMonth;
        return this.getLastWeekdayOfMonth(nextMonthYear, adjustedMonth, 4);
      }
      return currentExpiry;
    } else {
      // NIFTY: next Thursday
      return this.getNextWeekday(istTime, 4);
    }
  }

  // Helper: Format expiry for NIFTY (weekly/monthly)
  static formatNiftyExpiry(date) {
    const year = date.getFullYear().toString().slice(-2);
    // Check if this is the last week of the month (Thursday in last 7 days)
    if (this.isLastWeekOfMonth(date, 4)) {
      // Monthly expiry: {YY}{MMM}
      const month = date.toLocaleString('en-US', { month: 'short' }).toUpperCase();
      return `${year}${month}`;
    } else {
      // Weekly expiry: {YY}{M}{DD}
      const month = (date.getMonth() + 1).toString();
      const day = date.getDate().toString().padStart(2, '0');
      return `${year}${month}${day}`;
    }
  }

  // Helper: Format expiry for SENSEX (weekly/monthly)
  static formatSensexExpiry(date) {
    const year = date.getFullYear().toString().slice(-2);
    // Check if this is the last week of the month (Tuesday in last 7 days)
    if (this.isLastWeekOfMonth(date, 2)) {
      // Monthly expiry: {YY}{MMM}
      const month = date.toLocaleString('en-US', { month: 'short' }).toUpperCase();
      return `${year}${month}`;
    } else {
      // Weekly expiry: {YY}{M}{DD}
      const month = (date.getMonth() + 1).toString();
      const day = date.getDate().toString().padStart(2, '0');
      return `${year}${month}${day}`;
    }
  }

  // Helper: Format expiry for BANKNIFTY (always monthly)
  static formatBankniftyExpiry(date) {
    const year = date.getFullYear().toString().slice(-2);
    const month = date.toLocaleString('en-US', { month: 'short' }).toUpperCase();
    return `${year}${month}`;
  }

  // TODO: Add holiday adjustment logic if needed
  static adjustForHoliday(date) {
    // Placeholder: return date as-is
    return date;
  }

  /**
   * Get ATM strike price based on open price
   */
  static getATMStrike(indexName, openPrice) {
    const interval = this.STRIKE_INTERVALS[indexName] || 50;
    return Math.round(openPrice / interval) * interval;
  }

  /**
   * Map index name for symbol generation
   */
  static mapIndexNameForSymbol(indexName) {
    const mapping = {
      'NIFTY': 'NIFTY',
      'BANKNIFTY': 'BANKNIFTY',
      'SENSEX': 'SENSEX'
    };
    return mapping[indexName] || indexName;
  }

  /**
   * Generate strike symbols for CE and PE options
   */
  static generateStrikeSymbols(indexType, openPrice) {
    // Validate openPrice
    if (!openPrice || isNaN(openPrice) || openPrice <= 0) {
      console.error('[SymbolService] Invalid openPrice:', openPrice);
      return { ce: [], pe: [], atmStrike: null, openPrice: null };
    }
    
    // Ensure openPrice is a number
    const numericOpenPrice = Number(openPrice);
    if (numericOpenPrice > 100000) {
      console.error('[SymbolService] openPrice seems too high, might be a timestamp:', numericOpenPrice);
      return { ce: [], pe: [], atmStrike: null, openPrice: null };
    }
    
    const mappedIndex = this.BASE_SYMBOLS[indexType];
    const atmStrike = this.getATMStrike(mappedIndex, numericOpenPrice);
    const interval = this.STRIKE_INTERVALS[mappedIndex] || 50;
    const exchange = this.EXCHANGES[mappedIndex] || 'NSE';
    const baseSymbol = this.BASE_SYMBOLS[mappedIndex] || 'NIFTY';
    let expiryDate, expiryString;
    
    // Get the correct expiry date considering market close
    expiryDate = this.getNextExpiryDate(mappedIndex);
    expiryDate = this.adjustForHoliday(expiryDate);
    
    if (mappedIndex === 'SENSEX') {
      expiryString = this.formatSensexExpiry(expiryDate);
    } else if (mappedIndex === 'BANKNIFTY') {
      // BANKNIFTY always uses monthly format
      const year = expiryDate.getFullYear().toString().slice(-2);
      const month = expiryDate.toLocaleString('en-US', { month: 'short' }).toUpperCase();
      expiryString = `${year}${month}`;
    } else {
      // NIFTY: weekly/monthly based on last week logic
      expiryString = this.formatNiftyExpiry(expiryDate);
    }
    
    const ce = [];
    const pe = [];
    // Generate 5 ITM strikes (lower strikes for CE)
    for (let i = 5; i >= 1; i--) {
      const strike = atmStrike - (i * interval);
      const ceSymbol = `${exchange}:${baseSymbol}${expiryString}${strike}CE`;
      const peSymbol = `${exchange}:${baseSymbol}${expiryString}${strike}PE`;
      
      ce.push({
        label: `ITM ${i} - ${ceSymbol}`,
        symbol: ceSymbol,
        strike,
        type: 'ITM',
        level: i
      });
      pe.push({
        label: `OTM ${i} - ${peSymbol}`,
        symbol: peSymbol,
        strike,
        type: 'OTM',
        level: i
      });
    }
    // Add ATM strike
    const atmCeSymbol = `${exchange}:${baseSymbol}${expiryString}${atmStrike}CE`;
    const atmPeSymbol = `${exchange}:${baseSymbol}${expiryString}${atmStrike}PE`;
    
    ce.push({
      label: `ATM - ${atmCeSymbol}`,
      symbol: atmCeSymbol,
      strike: atmStrike,
      type: 'ATM',
      level: 0
    });
    pe.push({
      label: `ATM - ${atmPeSymbol}`,
      symbol: atmPeSymbol,
      strike: atmStrike,
      type: 'ATM',
      level: 0
    });
    
    // Generate 5 OTM strikes (higher strikes for CE)
    for (let i = 1; i <= 5; i++) {
      const strike = atmStrike + (i * interval);
      const ceSymbol = `${exchange}:${baseSymbol}${expiryString}${strike}CE`;
      const peSymbol = `${exchange}:${baseSymbol}${expiryString}${strike}PE`;
      
      ce.push({
        label: `OTM ${i} - ${ceSymbol}`,
        symbol: ceSymbol,
        strike,
        type: 'OTM',
        level: i
      });
      pe.push({
        label: `ITM ${i} - ${peSymbol}`,
        symbol: peSymbol,
        strike,
        type: 'ITM',
        level: i
      });
    }
    
    return {
      ce,
      pe,
      atmStrike,
      openPrice
    };
  }

  /**
   * Extract symbol from option type selection
   */
  static extractSymbol(optionType, symbols) {
    if (!optionType || !symbols || !Array.isArray(symbols)) {
      return '';
    }
    
    if (optionType === 'ATM') {
      const atm = symbols.find(s => s.type === 'ATM');
      return atm ? atm.symbol : '';
    }
    if (optionType.startsWith('ITM')) {
      const level = parseInt(optionType.replace('ITM', '').trim());
      const itm = symbols.find(s => s.type === 'ITM' && s.level === level);
      return itm ? itm.symbol : '';
    }
    if (optionType.startsWith('OTM')) {
      const level = parseInt(optionType.replace('OTM', '').trim());
      const otm = symbols.find(s => s.type === 'OTM' && s.level === level);
      return otm ? otm.symbol : '';
    }
    
    return '';
  }

  /**
   * Convert frontend symbol to proper Fyers symbol
   * @param {string} frontendSymbol - Symbol like 'NIFTY25300CE'
   * @param {number} spotPrice - Current spot price for ATM calculation
   * @returns {string} - Proper Fyers symbol like 'NSE:NIFTY2571025300CE'
   */
  static convertToFyersSymbol(frontendSymbol, spotPrice) {
    try {
      // Parse the frontend symbol
      // Format: {INDEX}{STRIKE}{OPTION_TYPE}
      // Example: NIFTY25300CE -> index: NIFTY, strike: 25300, type: CE
      
      let indexName, strike, optionType;
      
      // Handle NIFTY, BANKNIFTY, SENSEX
      if (frontendSymbol.startsWith('NIFTY')) {
        indexName = 'NIFTY';
        const remaining = frontendSymbol.substring(5); // Remove 'NIFTY'
        optionType = remaining.slice(-2); // Last 2 chars: CE or PE
        strike = parseInt(remaining.slice(0, -2)); // Everything except last 2 chars
      } else if (frontendSymbol.startsWith('BANKNIFTY')) {
        indexName = 'BANKNIFTY';
        const remaining = frontendSymbol.substring(9); // Remove 'BANKNIFTY'
        optionType = remaining.slice(-2); // Last 2 chars: CE or PE
        strike = parseInt(remaining.slice(0, -2)); // Everything except last 2 chars
      } else if (frontendSymbol.startsWith('SENSEX')) {
        indexName = 'SENSEX';
        const remaining = frontendSymbol.substring(6); // Remove 'SENSEX'
        optionType = remaining.slice(-2); // Last 2 chars: CE or PE
        strike = parseInt(remaining.slice(0, -2)); // Everything except last 2 chars
      } else {
        throw new Error(`Unsupported index in symbol: ${frontendSymbol}`);
      }
      
      if (!strike || isNaN(strike)) {
        throw new Error(`Invalid strike price in symbol: ${frontendSymbol}`);
      }
      
      if (!['CE', 'PE'].includes(optionType)) {
        throw new Error(`Invalid option type in symbol: ${frontendSymbol}`);
      }
      
      // Get proper expiry date and format
      const expiryDate = this.getNextExpiryDate(indexName);
      const exchange = this.EXCHANGES[indexName] || 'NSE';
      const baseSymbol = this.BASE_SYMBOLS[indexName] || 'NIFTY';
      
      let expiryString;
      if (indexName === 'SENSEX') {
        expiryString = this.formatSensexExpiry(expiryDate);
      } else if (indexName === 'BANKNIFTY') {
        // BANKNIFTY always uses monthly format
        const year = expiryDate.getFullYear().toString().slice(-2);
        const month = expiryDate.toLocaleString('en-US', { month: 'short' }).toUpperCase();
        expiryString = `${year}${month}`;
      } else {
        // NIFTY: weekly/monthly based on last week logic
        expiryString = this.formatNiftyExpiry(expiryDate);
      }
      
      // Construct Fyers symbol
      const fyersSymbol = `${exchange}:${baseSymbol}${expiryString}${strike}${optionType}`;
      
      return fyersSymbol;
      
    } catch (error) {
      console.error('[SymbolService] Error converting to Fyers symbol:', error);
      throw error;
    }
  }

  /**
   * Get current expiry string for testing/debugging
   * @param {string} indexType - Index type (NIFTY, BANKNIFTY, SENSEX)
   * @returns {string} - Current expiry string
   */
  static getCurrentExpiryString(indexType) {
    const expiryDate = this.getNextExpiryDate(indexType);
    
    if (indexType === 'SENSEX') {
      return this.formatSensexExpiry(expiryDate);
    } else if (indexType === 'BANKNIFTY') {
      return this.formatBankniftyExpiry(expiryDate);
    } else {
      return this.formatNiftyExpiry(expiryDate);
    }
  }

  /**
   * Test function to generate sample symbols for debugging
   * @param {string} indexType - Index type
   * @param {number} spotPrice - Current spot price
   * @returns {Object} - Sample symbols with expiry info
   */
  static generateTestSymbols(indexType, spotPrice) {
    const expiryDate = this.getNextExpiryDate(indexType);
    const atmStrike = this.getATMStrike(indexType, spotPrice);
    const exchange = this.EXCHANGES[indexType] || 'NSE';
    const baseSymbol = this.BASE_SYMBOLS[indexType] || 'NIFTY';
    
    let expiryString;
    if (indexType === 'SENSEX') {
      expiryString = this.formatSensexExpiry(expiryDate);
    } else if (indexType === 'BANKNIFTY') {
      expiryString = this.formatBankniftyExpiry(expiryDate);
    } else {
      expiryString = this.formatNiftyExpiry(expiryDate);
    }
    
    const ceSymbol = `${exchange}:${baseSymbol}${expiryString}${atmStrike}CE`;
    const peSymbol = `${exchange}:${baseSymbol}${expiryString}${atmStrike}PE`;
    
    return {
      indexType,
      spotPrice,
      atmStrike,
      expiryDate: expiryDate.toISOString(),
      expiryString,
      ceSymbol,
      peSymbol,
      isLastWeekOfMonth: this.isLastWeekOfMonth(expiryDate, indexType === 'SENSEX' ? 2 : 4)
    };
  }
}

module.exports = { SymbolService };