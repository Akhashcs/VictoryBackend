const LoggerService = {
    error: (s, m, e) => console.error('❌', s, m, e),
    warn: (s, m) => console.warn('⚠️', s, m),
    info: (s, m) => console.log('ℹ️', s, m),
    success: (s, m) => console.log('✅', s, m),
    debug: (s, m) => console.log('🔍', s, m),
    log: (s, i, m) => console.log(i, s, m),
    
    // Track repeated logs to reduce noise
    _repeatedLogs: new Map(),
    _logCounters: new Map(),
    
    // Check if verbose logging is enabled
    _isVerbose: () => process.env.LOG_VERBOSE === 'true',
    
    quoteFetched: (s) => {
      // Only log individual quotes in verbose mode or occasionally
      if (LoggerService._isVerbose()) {
        console.log('📊 [MarketService]', s, 'quote fetched successfully');
        return;
      }
      
      const key = `quote_${s}`;
      const count = LoggerService._logCounters.get(key) || 0;
      LoggerService._logCounters.set(key, count + 1);
      
      // Log every 100th quote fetch to reduce noise
      if (count % 100 === 0) {
        console.log('📊 [MarketService]', s, 'quote fetched successfully');
      }
    },
    
    hmaCalculated: (s) => console.log('📈 [HMAService]', s, 'HMA calculated successfully'),
    
    authCheck: (u, s, e) => {
      if (s) {
        // Only log auth checks in verbose mode or occasionally
        if (LoggerService._isVerbose()) {
          console.log('🔐 [Auth] User', u, 'authenticated for', e);
          return;
        }
        
        const key = `auth_${u}_${e}`;
        const count = LoggerService._logCounters.get(key) || 0;
        LoggerService._logCounters.set(key, count + 1);
        
        // Log every 50th auth check to reduce noise
        if (count % 50 === 0) {
          console.log('🔐 [Auth] User', u, 'authenticated for', e);
        }
      } else {
        console.error('❌ [Auth] Authentication failed for user', u, 'on', e);
      }
    },
    
    cacheOperation: (o, k) => {
      if (LoggerService._isVerbose()) {
        console.log('💾 [Cache]', o, k);
      }
    },
    
    pollingActivity: (t, c) => {
      // Only log polling activity in verbose mode or occasionally
      if (LoggerService._isVerbose()) {
        console.log('🔄 [Polling]', t, 'polling:', c, 'symbols');
        return;
      }
      
      const key = `polling_${t}`;
      const count = LoggerService._logCounters.get(key) || 0;
      LoggerService._logCounters.set(key, count + 1);
      
      // Log every 60th polling activity to reduce noise
      if (count % 60 === 0) {
        console.log('🔄 [Polling]', t, 'polling:', c, 'symbols');
      }
    },
    
    databaseOperation: (o, c, d) => console.log('🗄️ [Database]', o, c, d),
    networkRequest: (s, e, st) => console.log('🌐 [Network]', e, st >= 200 && st < 300 ? '✅' : '❌', '(', st, ')'),
    websocketEvent: (e, d) => console.log('🔌 [WebSocket]', e, d),
    tradeOperation: (o, s, d) => console.log('💰 [Trade]', o, s, d),
    monitoringEvent: (e, s, d) => console.log('👁️ [Monitoring]', e, s, d),
    
    // Batch logging for market data polling
    batchMarketData: (type, count) => {
      const key = `batch_${type}`;
      const lastLog = LoggerService._repeatedLogs.get(key) || 0;
      const now = Date.now();
      
      // Log batch operations every 60 seconds to reduce noise (or immediately in verbose mode)
      if (LoggerService._isVerbose() || now - lastLog > 60000) {
        console.log(`📊 [MarketService] ${type} data fetched successfully for ${count} symbols`);
        LoggerService._repeatedLogs.set(key, now);
      }
    },
    
    clearRepeatedLogs: () => {
      LoggerService._repeatedLogs.clear();
      LoggerService._logCounters.clear();
    },
    
    getRepeatedLogsStats: () => {
      const stats = {};
      LoggerService._logCounters.forEach((count, key) => {
        stats[key] = count;
      });
      return stats;
    },
    
    setLevel: (l) => console.log('ℹ️ [Logger] Log level set to', l.toUpperCase()),
    
    // Show current logging configuration
    showConfig: () => {
      console.log('ℹ️ [Logger] Verbose mode:', LoggerService._isVerbose() ? 'enabled' : 'disabled');
      console.log('ℹ️ [Logger] Set LOG_VERBOSE=true in .env to enable detailed logging');
    }
  };
  
  module.exports = LoggerService;