/**
 * Symbol Service for generating option symbols based on index selection
 * Migrated from frontend to backend for server-side processing
 * Updated to support commodity futures and stocks
 */
class SymbolService {
  // Holiday list (from Pine Script) - 2025 holidays
  static HOLIDAYS = [
    '2025-02-26', '2025-03-14', '2025-03-31', '2025-04-10', '2025-04-14', 
    '2025-04-18', '2025-05-01', '2025-08-15', '2025-08-27', '2025-10-02', 
    '2025-10-21', '2025-10-22', '2025-11-05', '2025-12-25'
  ];

  // Convert holiday strings to timestamps
  static getHolidayTimestamps() {
    return this.HOLIDAYS.map(dateStr => {
      const [year, month, day] = dateStr.split('-').map(Number);
      return new Date(year, month - 1, day); // month is 0-based
    });
  }

  // Check if a date is a holiday or weekend
  static isHoliday(date) {
    const holidayTimestamps = this.getHolidayTimestamps();
    const dayOfWeek = date.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6; // Sunday = 0, Saturday = 6
    
    // Check if date is in holiday list
    const isInHolidays = holidayTimestamps.some(holiday => 
      holiday.getFullYear() === date.getFullYear() &&
      holiday.getMonth() === date.getMonth() &&
      holiday.getDate() === date.getDate()
    );
    
    return isWeekend || isInHolidays;
  }

  // Adjust expiry date to previous working day if it's a holiday
  static adjustForHoliday(date) {
    let adjustedDate = new Date(date);
    while (this.isHoliday(adjustedDate)) {
      adjustedDate.setDate(adjustedDate.getDate() - 1);
    }
    return adjustedDate;
  }

  // Calculate next expiry based on anchor date and expiry type
  static getNextExpiryFromAnchor(anchorDate, expiryType, currentDate = new Date()) {
    if (!anchorDate) {
      // Fallback to old logic if no anchor date
      return this.getNextExpiryDate(expiryType);
    }

    const anchor = new Date(anchorDate);
    const now = new Date(currentDate);
    
    let nextExpiry;
    
    switch (expiryType) {
      case 'weekly':
        // Find the next weekly expiry after the anchor
        const weeksSinceAnchor = Math.ceil((now - anchor) / (7 * 24 * 60 * 60 * 1000));
        nextExpiry = new Date(anchor);
        nextExpiry.setDate(anchor.getDate() + (weeksSinceAnchor * 7));
        break;
        
      case 'monthly':
        // Find the next monthly expiry after the anchor
        const monthsSinceAnchor = Math.ceil((now - anchor) / (30 * 24 * 60 * 60 * 1000));
        nextExpiry = new Date(anchor);
        nextExpiry.setMonth(anchor.getMonth() + monthsSinceAnchor);
        break;
        
      case 'quarterly':
        // Find the next quarterly expiry after the anchor
        const quartersSinceAnchor = Math.ceil((now - anchor) / (90 * 24 * 60 * 60 * 1000));
        nextExpiry = new Date(anchor);
        nextExpiry.setMonth(anchor.getMonth() + (quartersSinceAnchor * 3));
        break;
        
      default:
        // For 'none' or unknown types, return anchor date
        nextExpiry = new Date(anchor);
    }
    
    // Adjust for holidays
    return this.adjustForHoliday(nextExpiry);
  }

  static STRIKE_INTERVALS = {
    'NIFTY': 50,
    'BANKNIFTY': 100,
    'SENSEX': 100,
    'CRUDEOIL': 100,
    'GOLD': 100,
    'COPPER': 5,
    'SILVER': 100,
    'NICKEL': 10
  };

  static EXCHANGES = {
    'NIFTY': 'NSE',
    'BANKNIFTY': 'NSE',
    'SENSEX': 'BSE',
    'CRUDEOIL': 'MCX',
    'GOLD': 'MCX',
    'COPPER': 'MCX',
    'SILVER': 'MCX',
    'NICKEL': 'MCX'
  };

  static BASE_SYMBOLS = {
    'NIFTY': 'NIFTY',
    'BANKNIFTY': 'BANKNIFTY',
    'SENSEX': 'SENSEX',
    'CRUDEOIL': 'CRUDEOIL',
    'GOLD': 'GOLD',
    'COPPER': 'COPPER',
    'SILVER': 'SILVER',
    'NICKEL': 'NICKEL'
  };

  static EXPIRY_TYPES = {
    'NIFTY': 'weekly',
    'BANKNIFTY': 'monthly',
    'SENSEX': 'weekly',
    'CRUDEOIL': 'monthly',
    'GOLD': 'monthly',
    'COPPER': 'monthly',
    'SILVER': 'monthly'
  };

  static LOT_SIZES = {
    'NIFTY': 75,
    'BANKNIFTY': 35,
    'SENSEX': 20,
    'CRUDEOIL': 100,
    'GOLD': 100,
    'COPPER': 2500,
    'SILVER': 30
  };

  static TICK_SIZES = {
    'NIFTY': 0.05,
    'BANKNIFTY': 0.05,
    'SENSEX': 0.05,
    'CRUDEOIL': 0.01,
    'GOLD': 0.01,
    'COPPER': 0.05,
    'SILVER': 1
  };

  // Stock configurations - updated to match frontend
  static STOCK_SYMBOLS = [
    // All stock symbols are now managed dynamically via symbol configuration
  ];

  static STOCK_EXCHANGES = {
    // All stock exchanges are now managed dynamically via symbol configuration
  };

  // Helper: Get next weekday
  static getNextWeekday(date, weekday) {
    const d = new Date(date);
    const day = d.getDay();
    let offset = (weekday + 7 - day) % 7;
    if (offset === 0) offset = 7;
    d.setDate(d.getDate() + offset);
    return d;
  }

  // Helper: Get last weekday of the month
  static getLastWeekdayOfMonth(year, month, weekday) {
    const lastDay = new Date(year, month, 0); // last day of month
    let day = lastDay.getDate();
    while (lastDay.getDay() !== weekday) {
      lastDay.setDate(--day);
    }
    return new Date(lastDay);
  }

  // Helper: Check if date is last week of month
  static isLastWeekOfMonth(date, weekday) {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const lastWeekday = this.getLastWeekdayOfMonth(year, month, weekday);
    const diffInDays = Math.abs((date.getTime() - lastWeekday.getTime()) / (1000 * 60 * 60 * 24));
    return diffInDays <= 7;
  }

  // Helper: Get next expiry date for any underlying
  static getNextExpiryDate(underlyingName) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    
    let expiry;
    
    if (underlyingName === 'SENSEX') {
      // SENSEX: last Tuesday of the month
      expiry = this.getLastWeekdayOfMonth(year, month, 2);
    } else if (underlyingName === 'BANKNIFTY') {
      // BANKNIFTY: last Thursday of the month
      expiry = this.getLastWeekdayOfMonth(year, month, 4);
    } else if (underlyingName === 'GOLD') {
      // GOLD: 5th of the month
      expiry = this.getGoldFuturesExpiry(year, month);
    } else if (underlyingName === 'CRUDEOIL') {
      // CRUDEOIL: 21st of the month
      expiry = this.getCrudeOilFuturesExpiry(year, month);
    } else if (underlyingName === 'COPPER') {
      // COPPER: last market day of the month
      expiry = this.getLastMarketDayOfMonth(year, month);
    } else if (underlyingName === 'SILVER') {
      // SILVER: 25th of each quarter
      expiry = this.getSilverQuarterExpiry(year, month);
    } else if (underlyingName === 'NICKEL') {
      // NICKEL: last Thursday of the month (same as BANKNIFTY)
      expiry = this.getLastWeekdayOfMonth(year, month, 4);
    } else {
      // NIFTY: weekly expiry (next Thursday)
      expiry = this.getNextWeekday(now, 4);
    }
    
    // If expiry is in the past, roll to next month
    if (now > expiry) {
      const nextMonth = month === 12 ? 1 : month + 1;
      const nextYear = month === 12 ? year + 1 : year;
      
      if (underlyingName === 'SENSEX') {
        expiry = this.getLastWeekdayOfMonth(nextYear, nextMonth, 2);
      } else if (underlyingName === 'BANKNIFTY') {
        expiry = this.getLastWeekdayOfMonth(nextYear, nextMonth, 4);
      } else if (underlyingName === 'GOLD') {
        expiry = this.getGoldFuturesExpiry(nextYear, nextMonth);
      } else if (underlyingName === 'CRUDEOIL') {
        expiry = this.getCrudeOilFuturesExpiry(nextYear, nextMonth);
      } else if (underlyingName === 'COPPER') {
        expiry = this.getLastMarketDayOfMonth(nextYear, nextMonth);
      } else if (underlyingName === 'SILVER') {
        expiry = this.getSilverQuarterExpiry(nextYear, nextMonth);
      } else if (underlyingName === 'NICKEL') {
        expiry = this.getLastWeekdayOfMonth(nextYear, nextMonth, 4);
      } else {
        // For NIFTY, just get next Thursday
        expiry = this.getNextWeekday(now, 4);
      }
    }
    
    return expiry;
  }

  // Helper: Get ATM strike price
  static getATMStrike(underlyingName, spotPrice) {
    const interval = this.STRIKE_INTERVALS[underlyingName] || 50;
    return Math.round(spotPrice / interval) * interval;
  }

  // Helper: Format expiry for NIFTY (weekly expiry with day)
  static formatNiftyExpiry(expiryDate) {
    const year = expiryDate.getFullYear().toString().slice(-2);
    const month = expiryDate.getMonth() + 1;
    const day = expiryDate.getDate().toString().padStart(2, '0');
    
    // NIFTY uses weekly expiry format: YYMMDD
    // Convert month to single character format as per Fyers documentation
    let monthChar;
    if (month === 1) monthChar = '1'; // January
    else if (month === 2) monthChar = '2'; // February
    else if (month === 3) monthChar = '3'; // March
    else if (month === 4) monthChar = '4'; // April
    else if (month === 5) monthChar = '5'; // May
    else if (month === 6) monthChar = '6'; // June
    else if (month === 7) monthChar = '7'; // July
    else if (month === 8) monthChar = '8'; // August
    else if (month === 9) monthChar = '9'; // September
    else if (month === 10) monthChar = 'O'; // October
    else if (month === 11) monthChar = 'N'; // November
    else if (month === 12) monthChar = 'D'; // December
    
    return `${year}${monthChar}${day}`;
  }

  // Helper: Format expiry for BANKNIFTY (monthly expiry)
  static formatBankniftyExpiry(expiryDate) {
    const year = expiryDate.getFullYear().toString().slice(-2);
    const month = expiryDate.toLocaleString('en-US', { month: 'short' }).toUpperCase();
    return `${year}${month}`;
  }

  // Helper: Format expiry for SENSEX (weekly expiry with day)
  static formatSensexExpiry(expiryDate) {
    const year = expiryDate.getFullYear().toString().slice(-2);
    const month = expiryDate.getMonth() + 1;
    const day = expiryDate.getDate().toString().padStart(2, '0');
    
    // SENSEX uses weekly expiry format: YYMMDD
    // Convert month to single character format as per Fyers documentation
    let monthChar;
    if (month === 1) monthChar = '1'; // January
    else if (month === 2) monthChar = '2'; // February
    else if (month === 3) monthChar = '3'; // March
    else if (month === 4) monthChar = '4'; // April
    else if (month === 5) monthChar = '5'; // May
    else if (month === 6) monthChar = '6'; // June
    else if (month === 7) monthChar = '7'; // July
    else if (month === 8) monthChar = '8'; // August
    else if (month === 9) monthChar = '9'; // September
    else if (month === 10) monthChar = 'O'; // October
    else if (month === 11) monthChar = 'N'; // November
    else if (month === 12) monthChar = 'D'; // December
    
    return `${year}${monthChar}${day}`;
  }

  // Helper: Format expiry for commodities (monthly)
  static formatCommodityExpiry(expiryDate) {
    const year = expiryDate.getFullYear().toString().slice(-2);
    const month = expiryDate.toLocaleString('en-US', { month: 'short' }).toUpperCase();
    return `${year}${month}`;
  }

  // Helper: Get last Thursday of the month
  static getLastThursdayOfMonth(year, month) {
    const lastDay = new Date(year, month, 0);
    let day = lastDay.getDate();
    while (lastDay.getDay() !== 4) { // 4 = Thursday
      lastDay.setDate(--day);
    }
    
    // If this expiry is in the past, move to next month
    const now = new Date();
    if (lastDay < now) {
      const nextMonth = month === 12 ? 1 : month + 1;
      const nextYear = month === 12 ? year + 1 : year;
      const nextLastDay = new Date(nextYear, nextMonth, 0);
      let nextDay = nextLastDay.getDate();
      while (nextLastDay.getDay() !== 4) { // 4 = Thursday
        nextLastDay.setDate(--nextDay);
      }
      return new Date(nextLastDay);
    }
    
    return new Date(lastDay);
  }

  // Helper: Get 5th of the month (Gold futures)
  static getGoldFuturesExpiry(year, month) {
    let expiry = new Date(year, month - 1, 5);
    const now = new Date();
    if (expiry < now) {
      // If already past, use next month
      expiry = new Date(year, month, 5);
    }
    return expiry;
  }

  // Helper: Get 25th of the month (Gold/Copper/Silver options)
  static get25thExpiry(year, month) {
    let expiry = new Date(year, month - 1, 25);
    // If 25th is weekend, move to previous weekday
    while (expiry.getDay() === 0 || expiry.getDay() === 6) {
      expiry.setDate(expiry.getDate() - 1);
    }
    return expiry;
  }

  // Helper: Get last market day of the month (Copper futures)
  static getLastMarketDayOfMonth(year, month) {
    let d = new Date(year, month, 0);
    while (d.getDay() === 0 || d.getDay() === 6) {
      d.setDate(d.getDate() - 1);
    }
    
    // If this expiry is in the past, move to next month
    const now = new Date();
    if (d < now) {
      const nextMonth = month === 12 ? 1 : month + 1;
      const nextYear = month === 12 ? year + 1 : year;
      d = new Date(nextYear, nextMonth, 0);
      while (d.getDay() === 0 || d.getDay() === 6) {
        d.setDate(d.getDate() - 1);
      }
    }
    
    return d;
  }

  // Helper: Get 25th of quarter (Silver futures)
  static getSilverQuarterExpiry(year, month) {
    // Quarters: Mar, Jun, Sep, Dec (month is 1-based)
    const quarters = [3, 6, 9, 12];
    let qMonth = quarters.find(qm => qm >= month);
    if (qMonth === undefined) qMonth = 3; // Default to March if not found
    let expiry = new Date(year, qMonth - 1, 25); // month is 0-based for Date constructor
    // If 25th is weekend, move to previous weekday
    while (expiry.getDay() === 0 || expiry.getDay() === 6) {
      expiry.setDate(expiry.getDate() - 1);
    }
    return expiry;
  }

  // Helper: Get 21st of the month (Crudeoil futures)
  static getCrudeOilFuturesExpiry(year, month) {
    let expiry = new Date(year, month - 1, 21);
    // If 21st is weekend, move to previous weekday
    while (expiry.getDay() === 0 || expiry.getDay() === 6) {
      expiry.setDate(expiry.getDate() - 1);
    }
    
    // If this expiry is in the past, move to next month
    const now = new Date();
    if (expiry < now) {
      const nextMonth = month === 12 ? 1 : month + 1;
      const nextYear = month === 12 ? year + 1 : year;
      expiry = new Date(nextYear, nextMonth - 1, 21);
      // If 21st is weekend, move to previous weekday
      while (expiry.getDay() === 0 || expiry.getDay() === 6) {
        expiry.setDate(expiry.getDate() - 1);
      }
    }
    
    return expiry;
  }

  // Helper: Get next Thursday (Crudeoil options)
  static getNextThursday(date) {
    const d = new Date(date);
    const day = d.getDay();
    let offset = (4 + 7 - day) % 7;
    if (offset === 0) offset = 7;
    d.setDate(d.getDate() + offset);
    return d;
  }

  // Helper: Format MCX expiry (YYMMM)
  static formatMCXExpiry(expiryDate) {
    const year = expiryDate.getFullYear().toString().slice(-2);
    const month = expiryDate.toLocaleString('en-US', { month: 'short' }).toUpperCase();
    return `${year}${month}`;
  }

  // Helper: Generate stock underlying symbol
  static generateStockUnderlyingSymbol(stockName) {
    return `NSE:${stockName}-EQ`;
  }

  // Main symbol generation logic
  static generateStrikeSymbols(underlyingType, openPrice) {
    // Stocks: Only underlying, options expire last Thursday of month
    if (this.STOCK_SYMBOLS.includes(underlyingType)) {
      return {
        ce: [],
        pe: [],
        stock: [{
          label: `${underlyingType} - NSE:${underlyingType}-EQ`,
          symbol: this.generateStockUnderlyingSymbol(underlyingType),
          type: 'STOCK',
          exchange: 'NSE'
        }],
        atmStrike: null,
        openPrice: null
      };
    }
    // Commodities
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    let expiry, expiryString, interval;
    let baseSymbol = this.BASE_SYMBOLS[underlyingType] || underlyingType;
    let exchange = this.EXCHANGES[underlyingType] || 'MCX';
    
    // Check if this is a commodity with no expiry
    const expiryDate = this.getNextExpiryDate(underlyingType);
    if (expiryDate === null) {
      return {
        ce: [],
        pe: [],
        underlying: [{
          label: `${underlyingType} - ${exchange}:${baseSymbol}`,
          symbol: this.convertRawUnderlyingToFyersSymbol(underlyingType, openPrice),
          type: 'UNDERLYING',
          exchange: exchange
        }],
        atmStrike: null,
        openPrice: null
      };
    }
    if (underlyingType === 'GOLD') {
      // Futures: 5th, Options: 25th
      expiry = this.getGoldFuturesExpiry(year, month);
      expiryString = this.formatMCXExpiry(expiry);
      interval = 100;
    } else if (underlyingType === 'COPPER') {
      // Futures: last market day, Options: 25th
      expiry = this.getLastMarketDayOfMonth(year, month);
      expiryString = this.formatMCXExpiry(expiry);
      interval = 5;
    } else if (underlyingType === 'SILVER') {
      // Futures: 25th of quarter, Options: 25th
      expiry = this.getSilverQuarterExpiry(year, month);
      expiryString = this.formatMCXExpiry(expiry);
      interval = 100;
    } else if (underlyingType === 'CRUDEOIL') {
      // Futures: 21st, Options: next Thursday
      expiry = this.getCrudeOilFuturesExpiry(year, month);
      expiryString = this.formatMCXExpiry(expiry);
      interval = 100;
    } else if (['NIFTY', 'BANKNIFTY', 'SENSEX'].includes(underlyingType)) {
      // Indices: generate option symbols with proper expiry
      const expiryDate = this.getNextExpiryDate(underlyingType);
      
      // If no expiry is specified, return only underlying symbol
      if (expiryDate === null) {
        return {
          ce: [],
          pe: [],
          underlying: [{
            label: `${underlyingType} - ${this.EXCHANGES[underlyingType]}:${this.BASE_SYMBOLS[underlyingType]}-INDEX`,
            symbol: this.convertRawUnderlyingToFyersSymbol(underlyingType, openPrice),
            type: 'UNDERLYING',
            exchange: this.EXCHANGES[underlyingType] || 'NSE'
          }],
          atmStrike: null,
          openPrice: null
        };
      }
      
      let expiryString;
      
      if (underlyingType === 'SENSEX') {
        expiryString = this.formatSensexExpiry(expiryDate);
      } else if (underlyingType === 'BANKNIFTY') {
        expiryString = this.formatBankniftyExpiry(expiryDate);
      } else {
        // NIFTY: weekly expiry format
        expiryString = this.formatNiftyExpiry(expiryDate);
      }
      
      const exchange = this.EXCHANGES[underlyingType] || 'NSE';
      const baseSymbol = this.BASE_SYMBOLS[underlyingType] || underlyingType;
      const interval = this.STRIKE_INTERVALS[underlyingType] || 50;
      const atmStrike = this.getATMStrike(underlyingType, openPrice);
      
      const ce = [], pe = [];
      
      // Generate 5 ITM strikes (lower strikes for CE)
      for (let i = 5; i >= 1; i--) {
        const strike = atmStrike - (i * interval);
        ce.push({
          label: `ITM ${i} - ${exchange}:${baseSymbol}${expiryString}${strike}CE`,
          symbol: `${exchange}:${baseSymbol}${expiryString}${strike}CE`,
          strike,
          type: 'ITM',
          level: i
        });
        pe.push({
          label: `OTM ${i} - ${exchange}:${baseSymbol}${expiryString}${strike}PE`,
          symbol: `${exchange}:${baseSymbol}${expiryString}${strike}PE`,
          strike,
          type: 'OTM',
          level: i
        });
      }
      
      // ATM
      ce.push({
        label: `ATM - ${exchange}:${baseSymbol}${expiryString}${atmStrike}CE`,
        symbol: `${exchange}:${baseSymbol}${expiryString}${atmStrike}CE`,
        strike: atmStrike,
        type: 'ATM',
        level: 0
      });
      pe.push({
        label: `ATM - ${exchange}:${baseSymbol}${expiryString}${atmStrike}PE`,
        symbol: `${exchange}:${baseSymbol}${expiryString}${atmStrike}PE`,
        strike: atmStrike,
        type: 'ATM',
        level: 0
      });
      
      // Generate 5 OTM strikes (higher strikes for CE)
      for (let i = 1; i <= 5; i++) {
        const strike = atmStrike + (i * interval);
        ce.push({
          label: `OTM ${i} - ${exchange}:${baseSymbol}${expiryString}${strike}CE`,
          symbol: `${exchange}:${baseSymbol}${expiryString}${strike}CE`,
          strike,
          type: 'OTM',
          level: i
        });
        pe.push({
          label: `ITM ${i} - ${exchange}:${baseSymbol}${expiryString}${strike}PE`,
          symbol: `${exchange}:${baseSymbol}${expiryString}${strike}PE`,
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
    } else {
      // Default: fallback
      expiry = this.getLastThursdayOfMonth(year, month);
      expiryString = this.formatMCXExpiry(expiry);
      interval = 50;
    }
    // Generate strikes
    const atmStrike = this.getATMStrike(underlyingType, openPrice);
    const ce = [], pe = [];
    for (let i = 5; i >= 1; i--) {
      const strike = atmStrike - (i * interval);
      ce.push({
        label: `ITM ${i} - ${exchange}:${baseSymbol}${expiryString}${strike}CE`,
        symbol: `${exchange}:${baseSymbol}${expiryString}${strike}CE`,
        strike,
        type: 'ITM',
        level: i
      });
      pe.push({
        label: `OTM ${i} - ${exchange}:${baseSymbol}${expiryString}${strike}PE`,
        symbol: `${exchange}:${baseSymbol}${expiryString}${strike}PE`,
        strike,
        type: 'OTM',
        level: i
      });
    }
    // ATM
    ce.push({
      label: `ATM - ${exchange}:${baseSymbol}${expiryString}${atmStrike}CE`,
      symbol: `${exchange}:${baseSymbol}${expiryString}${atmStrike}CE`,
      strike: atmStrike,
      type: 'ATM',
      level: 0
    });
    pe.push({
      label: `ATM - ${exchange}:${baseSymbol}${expiryString}${atmStrike}PE`,
      symbol: `${exchange}:${baseSymbol}${expiryString}${atmStrike}PE`,
      strike: atmStrike,
      type: 'ATM',
      level: 0
    });
    for (let i = 1; i <= 5; i++) {
      const strike = atmStrike + (i * interval);
      ce.push({
        label: `OTM ${i} - ${exchange}:${baseSymbol}${expiryString}${strike}CE`,
        symbol: `${exchange}:${baseSymbol}${expiryString}${strike}CE`,
        strike,
        type: 'OTM',
        level: i
      });
      pe.push({
        label: `ITM ${i} - ${exchange}:${baseSymbol}${expiryString}${strike}PE`,
        symbol: `${exchange}:${baseSymbol}${expiryString}${strike}PE`,
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
   * Generate commodity symbols (futures and options)
   */
  static generateCommoditySymbols(commodityType, spotPrice) {
    const exchange = this.EXCHANGES[commodityType] || 'MCX';
    const baseSymbol = this.BASE_SYMBOLS[commodityType] || commodityType;
    const interval = this.STRIKE_INTERVALS[commodityType] || 100;
    const atmStrike = this.getATMStrike(commodityType, spotPrice);
    
    // Get expiry date for commodities (monthly)
    const expiryDate = this.getNextExpiryDate(commodityType);
    const expiryString = this.formatCommodityExpiry(expiryDate);
    
    const ce = [];
    const pe = [];
    
    // Generate 5 ITM strikes (lower strikes for CE)
    for (let i = 5; i >= 1; i--) {
      const strike = atmStrike - (i * interval);
      ce.push({
        label: `ITM ${i} - ${exchange}:${baseSymbol}${expiryString}${strike}CE`,
        symbol: `${exchange}:${baseSymbol}${expiryString}${strike}CE`,
        strike,
        type: 'ITM',
        level: i
      });
      pe.push({
        label: `OTM ${i} - ${exchange}:${baseSymbol}${expiryString}${strike}PE`,
        symbol: `${exchange}:${baseSymbol}${expiryString}${strike}PE`,
        strike,
        type: 'OTM',
        level: i
      });
    }
    
    // ATM
    ce.push({
      label: `ATM - ${exchange}:${baseSymbol}${expiryString}${atmStrike}CE`,
      symbol: `${exchange}:${baseSymbol}${expiryString}${atmStrike}CE`,
      strike: atmStrike,
      type: 'ATM',
      level: 0
    });
    pe.push({
      label: `ATM - ${exchange}:${baseSymbol}${expiryString}${atmStrike}PE`,
      symbol: `${exchange}:${baseSymbol}${expiryString}${atmStrike}PE`,
      strike: atmStrike,
      type: 'ATM',
      level: 0
    });
    
    // Generate 5 OTM strikes (higher strikes for CE)
    for (let i = 1; i <= 5; i++) {
      const strike = atmStrike + (i * interval);
      ce.push({
        label: `OTM ${i} - ${exchange}:${baseSymbol}${expiryString}${strike}CE`,
        symbol: `${exchange}:${baseSymbol}${expiryString}${strike}CE`,
        strike,
        type: 'OTM',
        level: i
      });
      pe.push({
        label: `ITM ${i} - ${exchange}:${baseSymbol}${expiryString}${strike}PE`,
        symbol: `${exchange}:${baseSymbol}${expiryString}${strike}PE`,
        strike,
        type: 'ITM',
        level: i
      });
    }
    
    return {
      ce,
      pe,
      atmStrike,
      openPrice: spotPrice
    };
  }

  /**
   * Generate stock symbols (futures only, no options)
   */
  static generateStockSymbols(stockName) {
    const exchange = this.STOCK_EXCHANGES[stockName] || 'NSE';
    const stockSymbol = `${exchange}:${stockName}-EQ`;
    
    // For stocks, we only have futures, not options
    // Return empty arrays for CE and PE since stocks don't have options
    return {
      ce: [],
      pe: [],
      stock: [{
        label: `${stockName} - ${stockSymbol}`,
        symbol: stockSymbol,
        type: 'STOCK',
        exchange: exchange
      }],
      atmStrike: null,
      openPrice: null
    };
  }

  /**
   * Generate futures symbols for commodities
   */
  static generateFuturesSymbols(underlyingType, openPrice) {
    const mappedUnderlying = this.BASE_SYMBOLS[underlyingType];
    const exchange = this.EXCHANGES[mappedUnderlying] || 'MCX';
    const baseSymbol = this.BASE_SYMBOLS[mappedUnderlying] || 'CRUDEOIL';
    
    // Get expiry date
    const expiryDate = this.getNextExpiryDate(mappedUnderlying);
    const expiryString = this.formatCommodityExpiry(expiryDate);
    
    const futuresSymbol = `${exchange}:${baseSymbol}${expiryString}FUT`;
    
    return {
      futures: [{
        label: `FUTURES - ${futuresSymbol}`,
        symbol: futuresSymbol,
        type: 'FUTURES',
        expiry: expiryDate
      }],
      openPrice
    };
  }

  /**
   * Generate stock symbols
   */
  static generateStockSymbols(stockName) {
    const exchange = this.STOCK_EXCHANGES[stockName] || 'NSE';
    const stockSymbol = `${exchange}:${stockName}-EQ`;
    
    return {
      stock: [{
        label: `${stockName} - ${stockSymbol}`,
        symbol: stockSymbol,
        type: 'STOCK',
        exchange: exchange
      }]
    };
  }

  /**
   * Map underlying name for symbol generation
   */
  static mapUnderlyingNameForSymbol(underlyingName) {
    const mapping = {
      'NIFTY': 'NIFTY',
      'BANKNIFTY': 'BANKNIFTY',
      'SENSEX': 'SENSEX',
      'CRUDEOIL': 'CRUDEOIL',
      'GOLD': 'GOLD',
      'COPPER': 'COPPER',
      'SILVER': 'SILVER'
    };
    return mapping[underlyingName] || underlyingName;
  }

  /**
   * Convert frontend symbol to proper Fyers symbol
   * @param {string} frontendSymbol - Symbol like 'NIFTY25300CE' or raw underlying name like 'NIFTY'
   * @param {number} spotPrice - Current spot price for ATM calculation
   * @returns {string} - Proper Fyers symbol like 'NSE:NIFTY2571025300CE'
   */
  static convertToFyersSymbol(frontendSymbol, spotPrice) {
    try {
      // Check if this is a raw underlying name (no strike/option type)
      // Also check if it's a known underlying name that should be treated as raw
      const knownUnderlyings = ['NIFTY', 'BANKNIFTY', 'SENSEX', 'CRUDEOIL', 'GOLD', 'COPPER', 'SILVER', 'NICKEL', ...this.STOCK_SYMBOLS];
      const upperSymbol = frontendSymbol.toUpperCase();
      const isRawUnderlying = !frontendSymbol.includes('CE') && !frontendSymbol.includes('PE') && 
                              knownUnderlyings.includes(upperSymbol);
      
      console.log(`[SymbolService] Converting symbol: ${frontendSymbol}, isRawUnderlying: ${isRawUnderlying}, upperSymbol: ${upperSymbol}, knownUnderlyings: ${knownUnderlyings.join(',')}`);
      
      if (isRawUnderlying) {
        // Handle raw underlying names - generate spot/futures symbols
        console.log(`[SymbolService] Treating ${frontendSymbol} as raw underlying`);
        return this.convertRawUnderlyingToFyersSymbol(frontendSymbol, spotPrice);
      }
      
      // Parse the frontend symbol (existing logic for option symbols)
      // Format: {INDEX}{STRIKE}{OPTION_TYPE}
      // Example: NIFTY25300CE -> index: NIFTY, strike: 25300, type: CE
      
      let underlyingName, strike, optionType;
      
      // Handle different underlying types
      if (frontendSymbol.startsWith('NIFTY')) {
        underlyingName = 'NIFTY';
        const remaining = frontendSymbol.substring(5); // Remove 'NIFTY'
        optionType = remaining.slice(-2); // Last 2 chars: CE or PE
        strike = parseInt(remaining.slice(0, -2)); // Everything except last 2 chars
      } else if (frontendSymbol.startsWith('BANKNIFTY')) {
        underlyingName = 'BANKNIFTY';
        const remaining = frontendSymbol.substring(9); // Remove 'BANKNIFTY'
        optionType = remaining.slice(-2); // Last 2 chars: CE or PE
        strike = parseInt(remaining.slice(0, -2)); // Everything except last 2 chars
      } else if (frontendSymbol.startsWith('SENSEX')) {
        underlyingName = 'SENSEX';
        const remaining = frontendSymbol.substring(6); // Remove 'SENSEX'
        optionType = remaining.slice(-2); // Last 2 chars: CE or PE
        strike = parseInt(remaining.slice(0, -2)); // Everything except last 2 chars
      } else if (frontendSymbol.startsWith('CRUDEOIL')) {
        underlyingName = 'CRUDEOIL';
        const remaining = frontendSymbol.substring(8); // Remove 'CRUDEOIL'
        optionType = remaining.slice(-2); // Last 2 chars: CE or PE
        strike = parseInt(remaining.slice(0, -2)); // Everything except last 2 chars
      } else if (frontendSymbol.startsWith('GOLD')) {
        underlyingName = 'GOLD';
        const remaining = frontendSymbol.substring(4); // Remove 'GOLD'
        optionType = remaining.slice(-2); // Last 2 chars: CE or PE
        strike = parseInt(remaining.slice(0, -2)); // Everything except last 2 chars
      } else if (frontendSymbol.startsWith('COPPER')) {
        underlyingName = 'COPPER';
        const remaining = frontendSymbol.substring(6); // Remove 'COPPER'
        optionType = remaining.slice(-2); // Last 2 chars: CE or PE
        strike = parseInt(remaining.slice(0, -2)); // Everything except last 2 chars
      } else if (frontendSymbol.startsWith('SILVER')) {
        underlyingName = 'SILVER';
        const remaining = frontendSymbol.substring(6); // Remove 'SILVER'
        optionType = remaining.slice(-2); // Last 2 chars: CE or PE
        strike = parseInt(remaining.slice(0, -2)); // Everything except last 2 chars
      } else {
        throw new Error(`Unsupported underlying in symbol: ${frontendSymbol}`);
      }
      
      if (!strike || isNaN(strike)) {
        throw new Error(`Invalid strike price in symbol: ${frontendSymbol}`);
      }
      
      if (!optionType || !['CE', 'PE'].includes(optionType)) {
        throw new Error(`Invalid option type in symbol: ${frontendSymbol}`);
      }
      
      // Get proper expiry date and format
      const expiryDate = this.getNextExpiryDate(underlyingName);
      let expiryString;
      
      if (underlyingName === 'SENSEX') {
        expiryString = this.formatSensexExpiry(expiryDate);
      } else if (underlyingName === 'BANKNIFTY') {
        expiryString = this.formatBankniftyExpiry(expiryDate);
      } else if (['CRUDEOIL', 'GOLD', 'COPPER', 'SILVER', 'NICKEL'].includes(underlyingName)) {
        expiryString = this.formatCommodityExpiry(expiryDate);
      } else {
        // NIFTY: weekly expiry format
        expiryString = this.formatNiftyExpiry(expiryDate);
      }
      
      const exchange = this.EXCHANGES[underlyingName] || 'NSE';
      const baseSymbol = this.BASE_SYMBOLS[underlyingName] || underlyingName;
      
      return `${exchange}:${baseSymbol}${expiryString}${strike}${optionType}`;
      
    } catch (error) {
      console.error('[SymbolService] Error converting to Fyers symbol:', error);
      throw error;
    }
  }

  /**
   * Convert raw underlying name to Fyers symbol
   * @param {string} underlyingName - Raw underlying name like 'NIFTY', 'ADANIPORTS'
   * @param {number} spotPrice - Current spot price
   * @returns {string} - Proper Fyers symbol
   */
  static convertRawUnderlyingToFyersSymbol(underlyingName, spotPrice) {
    try {
      const upperName = underlyingName.toUpperCase();
      
      // Handle indices - return spot symbols
      if (upperName === 'NIFTY') {
        return 'NSE:NIFTY50-INDEX';
      } else if (upperName === 'BANKNIFTY') {
        return 'NSE:NIFTYBANK-INDEX';
      } else if (upperName === 'SENSEX') {
        return 'BSE:SENSEX-INDEX';
      }
      
      // Handle commodities - return futures symbols
      if (['CRUDEOIL', 'GOLD', 'COPPER', 'SILVER', 'NICKEL'].includes(upperName)) {
        const expiryDate = this.getNextExpiryDate(upperName);
        const expiryString = this.formatCommodityExpiry(expiryDate);
        const exchange = this.EXCHANGES[upperName] || 'MCX';
        const baseSymbol = this.BASE_SYMBOLS[upperName] || upperName;
        return `${exchange}:${baseSymbol}${expiryString}FUT`;
      }
      
      // Handle stocks - return equity symbols
      if (this.STOCK_SYMBOLS.includes(upperName)) {
        const exchange = this.STOCK_EXCHANGES[upperName] || 'NSE';
        return `${exchange}:${upperName}-EQ`;
      }
      
      throw new Error(`Unsupported underlying in symbol: ${underlyingName}`);
    } catch (error) {
      console.error('[SymbolService] Error converting raw underlying to Fyers symbol:', error);
      throw error;
    }
  }

  /**
   * Get lot size for any symbol
   */
  static getLotSizeForSymbol(symbolString) {
    const symbolUpper = symbolString?.toUpperCase() || '';
    
    // Check for indices first
    if (symbolUpper.includes('NIFTY') && !symbolUpper.includes('BANKNIFTY')) {
      return 75;
    } else if (symbolUpper.includes('BANKNIFTY')) {
      return 35;
    } else if (symbolUpper.includes('SENSEX')) {
      return 20;
    }
    
    // Check for commodities
    if (symbolUpper.includes('CRUDEOIL')) {
      return 100;
    } else if (symbolUpper.includes('GOLD')) {
      return 100;
    } else if (symbolUpper.includes('COPPER')) {
      return 2500;
    } else if (symbolUpper.includes('SILVER')) {
      return 30;
    } else if (symbolUpper.includes('NICKEL')) {
      return 1500;
    }
    
    // Check for stocks (all stocks have lot size 1)
    for (const stockName of this.STOCK_SYMBOLS) {
      if (symbolUpper.includes(stockName)) {
        return 1;
      }
    }
    
    // Default to NIFTY lot size
    console.log(`⚠️ Unknown underlying type for symbol ${symbolString}, defaulting to NIFTY lot size (75)`);
    return 75;
  }

  /**
   * Get tick size for any symbol
   */
  static getTickSizeForSymbol(symbolString) {
    const symbolUpper = symbolString?.toUpperCase() || '';
    
    // Check for commodities
    if (symbolUpper.includes('CRUDEOIL') || symbolUpper.includes('GOLD')) {
      return 0.01;
    } else if (symbolUpper.includes('COPPER')) {
      return 0.05;
    } else if (symbolUpper.includes('SILVER')) {
      return 1;
    } else if (symbolUpper.includes('NICKEL')) {
      return 0.05;
    }
    
    // Default tick size for indices and stocks
    return 0.05;
  }

  /**
   * Generate strike symbols using custom configuration
   * @param {string} underlyingType - Underlying type
   * @param {number} spotPrice - Current spot price
   * @param {Object} config - Custom configuration
   * @returns {Object} - Generated symbols with custom config
   */
  static generateStrikeSymbolsWithConfig(underlyingType, spotPrice, config) {
    const originalExpiryTypes = this.EXPIRY_TYPES;
    const originalStrikeIntervals = this.STRIKE_INTERVALS;
    const originalGetNextExpiryDate = this.getNextExpiryDate;

    this.EXPIRY_TYPES[underlyingType] = config.nextExpiry;
    this.STRIKE_INTERVALS[underlyingType] = config.strikeInterval;

    try {
      // --- Dynamic Option Symbol Generation ---
      // Calculate expiry date using nearExpiryDate and nextExpiry
      let expiryDate;
      if (config.nearExpiryDate && config.nextExpiry !== 'none') {
        expiryDate = this.getNextExpiryFromAnchor(config.nearExpiryDate, config.nextExpiry);
      } else if (config.expiryDate && config.nextExpiry === 'custom') {
        expiryDate = new Date(config.expiryDate);
      } else if (config.nextExpiry === 'none') {
        expiryDate = null;
      } else {
        expiryDate = this.getNextExpiryDate(underlyingType);
      }

      // Format expiry parts
      const year = expiryDate ? expiryDate.getFullYear() : new Date().getFullYear();
      const YY = String(year).slice(-2);
      const monthNum = expiryDate ? expiryDate.getMonth() + 1 : new Date().getMonth() + 1; // 1-based
      const M = String(monthNum); // e.g. 7
      const MM = String(monthNum).padStart(2, '0'); // e.g. 07
      const MMM = expiryDate ? expiryDate.toLocaleString('en-US', { month: 'short' }).toUpperCase() : new Date().toLocaleString('en-US', { month: 'short' }).toUpperCase();
      const DD = expiryDate ? String(expiryDate.getDate()).padStart(2, '0') : '';

      // Calculate ATM strike
      const strikeInterval = config.strikeInterval || 50;
      const atmStrike = Math.round(spotPrice / strikeInterval) * strikeInterval;
      // Generate strikes (5 ITM, ATM, 5 OTM)
      const strikes = [];
      for (let i = -5; i <= 5; i++) {
        strikes.push(atmStrike + i * strikeInterval);
      }

      // Parse optionSymbolFormat
      let format = config.optionSymbolFormat;
      if (!format || typeof format !== 'string' || !format.includes('{STRIKE}') || !format.includes('{TYPE}')) {
        format = '{STRIKE}{TYPE}';
      }

      // Helper to classify strike
      function getStrikeClassification(strike, type) {
        if (strike === atmStrike) return 'ATM';
        const diff = Math.abs(strike - atmStrike) / strikeInterval;
        if (type === 'CE') {
          return strike < atmStrike ? `ITM ${diff}` : `OTM ${diff}`;
        } else {
          return strike > atmStrike ? `ITM ${diff}` : `OTM ${diff}`;
        }
      }

      // Helper to build symbol
      function buildSymbol(type, strike) {
        return format
          .replace('{YY}', YY)
          .replace('{MMM}', MMM)
          .replace('{MM}', MM)
          .replace('{M}', M)
          .replace('{DD}', DD)
          .replace('{STRIKE}', strike)
          .replace('{TYPE}', type);
      }

      // Generate CE and PE symbols
      const ce = strikes.map(strike => {
        const classification = getStrikeClassification(strike, 'CE');
        return {
          symbol: buildSymbol('CE', strike),
          strike,
          type: 'CE',
          expiry: expiryDate,
          lotSize: config.lotSize || 1,
          label: `${classification} (${buildSymbol('CE', strike)})`,
          classification
        };
      });
      const pe = strikes.map(strike => {
        const classification = getStrikeClassification(strike, 'PE');
        return {
          symbol: buildSymbol('PE', strike),
          strike,
          type: 'PE',
          expiry: expiryDate,
          lotSize: config.lotSize || 1,
          label: `${classification} (${buildSymbol('PE', strike)})`,
          classification
        };
      });

      // Restore original config
      this.EXPIRY_TYPES = originalExpiryTypes;
      this.STRIKE_INTERVALS = originalStrikeIntervals;
      this.getNextExpiryDate = originalGetNextExpiryDate;

      return { ce, pe, atmStrike };
    } catch (error) {
      this.EXPIRY_TYPES = originalExpiryTypes;
      this.STRIKE_INTERVALS = originalStrikeIntervals;
      this.getNextExpiryDate = originalGetNextExpiryDate;
      throw error;
    }
  }

  /**
   * Test function to generate sample symbols for debugging
   * @param {string} underlyingType - Underlying type
   * @param {number} spotPrice - Current spot price
   * @returns {Object} - Sample symbols with expiry info
   */
  static generateTestSymbols(underlyingType, spotPrice) {
    return this.generateStrikeSymbols(underlyingType, spotPrice);
  }
}

module.exports = { SymbolService };