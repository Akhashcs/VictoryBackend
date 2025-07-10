/**
 * Futures Helper Service
 * Utility functions for futures symbol generation and calculations
 */
class FuturesHelper {
  /**
   * Get spot symbol for an index
   * @param {string} indexName - Index name
   * @returns {string} Spot symbol
   */
  static getSpotSymbol(indexName) {
    const symbolMap = {
      'NIFTY': 'NSE:NIFTY50-INDEX',
      'BANKNIFTY': 'NSE:NIFTYBANK-INDEX',
      'SENSEX': 'BSE:SENSEX-INDEX'
    };
    
    return symbolMap[indexName.toUpperCase()] || `NSE:${indexName.toUpperCase()}-INDEX`;
  }

  /**
   * Helper to get last weekday of the month
   * @param {number} year - Year
   * @param {number} month - Month (1-based, 1=Jan, 12=Dec)
   * @param {number} weekday - Day of week (0=Sunday, 1=Monday, ...)
   * @returns {Date} Last weekday of month
   */
  static getLastWeekdayOfMonth(year, month, weekday) {
    // month: 1-based (1=Jan, 12=Dec)
    const lastDay = new Date(year, month, 0); // last day of month
    let day = lastDay.getDate();
    while (lastDay.getDay() !== weekday) {
      lastDay.setDate(--day);
    }
    return new Date(lastDay);
  }

  /**
   * Helper to get correct expiry date for futures
   * @param {string} indexName - Index name
   * @returns {Date} Expiry date
   */
  static getFuturesExpiry(indexName) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1; // JS: 0=Jan, Pine: 1=Jan
    let expiry;
    if (indexName.toUpperCase() === 'SENSEX') {
      // SENSEX: last Tuesday of the month
      expiry = this.getLastWeekdayOfMonth(year, month, 2); // 2=Tuesday
    } else {
      // NIFTY/BANKNIFTY: last Thursday of the month
      expiry = this.getLastWeekdayOfMonth(year, month, 4); // 4=Thursday
    }
    // If expiry is in the past, roll to next month
    if (now > expiry) {
      const nextMonth = month === 12 ? 1 : month + 1;
      const nextYear = month === 12 ? year + 1 : year;
      if (indexName.toUpperCase() === 'SENSEX') {
        expiry = this.getLastWeekdayOfMonth(nextYear, nextMonth, 2);
      } else {
        expiry = this.getLastWeekdayOfMonth(nextYear, nextMonth, 4);
      }
    }
    return expiry;
  }

  /**
   * Helper to format expiry as YYMMM (e.g., 25JUL)
   * @param {Date} expiry - Expiry date
   * @returns {string} Formatted expiry code
   */
  static formatExpiryCode(expiry) {
    const yy = String(expiry.getFullYear()).slice(-2);
    const mmm = expiry.toLocaleString('en-US', { month: 'short' }).toUpperCase();
    return yy + mmm;
  }

  /**
   * Generate correct futures symbol for the current expiry
   * @param {string} indexName - Index name
   * @returns {string} Futures symbol
   */
  static getFuturesSymbol(indexName) {
    let prefix, code;
    if (indexName.toUpperCase() === 'SENSEX') {
      prefix = 'BSE:SENSEX';
    } else if (indexName.toUpperCase() === 'BANKNIFTY') {
      prefix = 'NSE:BANKNIFTY';
    } else {
      prefix = 'NSE:NIFTY';
    }
    const expiry = this.getFuturesExpiry(indexName);
    code = this.formatExpiryCode(expiry);
    return `${prefix}${code}FUT`;
  }

  /**
   * Calculate premium difference between futures and spot
   * @param {number} futuresPrice - Futures price
   * @param {number} spotPrice - Spot price
   * @returns {number} Premium
   */
  static calculatePremium(futuresPrice, spotPrice) {
    if (!futuresPrice || !spotPrice) return 0;
    return futuresPrice - spotPrice;
  }

  /**
   * Format premium for display
   * @param {number} premium - Premium value
   * @returns {string} Formatted premium
   */
  static formatPremium(premium) {
    if (Math.abs(premium) >= 1000) {
      return `${premium >= 0 ? '+' : ''}${(premium / 1000).toFixed(1)}K`;
    }
    return `${premium >= 0 ? '+' : ''}${Math.round(premium)}`;
  }

  /**
   * Get all futures symbols for an index
   * @param {string} indexName - Index name
   * @returns {Array} Array of futures symbols with metadata
   */
  static getAllFuturesSymbols(indexName) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const symbols = [];
    
    // Current month
    let expiry = this.getFuturesExpiry(indexName);
    let code = this.formatExpiryCode(expiry);
    let prefix;
    
    if (indexName.toUpperCase() === 'SENSEX') {
      prefix = 'BSE:SENSEX';
    } else if (indexName.toUpperCase() === 'BANKNIFTY') {
      prefix = 'NSE:BANKNIFTY';
    } else {
      prefix = 'NSE:NIFTY';
    }
    
    symbols.push({
      symbol: `${prefix}${code}FUT`,
      expiry: expiry,
      label: `Current Month (${code})`,
      type: 'current'
    });
    
    // Next month
    let nextMonth = month === 12 ? 1 : month + 1;
    let nextYear = month === 12 ? year + 1 : year;
    
    if (indexName.toUpperCase() === 'SENSEX') {
      expiry = this.getLastWeekdayOfMonth(nextYear, nextMonth, 2);
    } else {
      expiry = this.getLastWeekdayOfMonth(nextYear, nextMonth, 4);
    }
    
    code = this.formatExpiryCode(expiry);
    
    symbols.push({
      symbol: `${prefix}${code}FUT`,
      expiry: expiry,
      label: `Next Month (${code})`,
      type: 'next'
    });
    
    // Far month (2 months out)
    let farMonth = nextMonth === 12 ? 1 : nextMonth + 1;
    let farYear = nextMonth === 12 ? nextYear + 1 : nextYear;
    
    if (indexName.toUpperCase() === 'SENSEX') {
      expiry = this.getLastWeekdayOfMonth(farYear, farMonth, 2);
    } else {
      expiry = this.getLastWeekdayOfMonth(farYear, farMonth, 4);
    }
    
    code = this.formatExpiryCode(expiry);
    
    symbols.push({
      symbol: `${prefix}${code}FUT`,
      expiry: expiry,
      label: `Far Month (${code})`,
      type: 'far'
    });
    
    return symbols;
  }
}

module.exports = FuturesHelper; 