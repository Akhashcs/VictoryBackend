const LoggerService = require('./loggerService');

/**
 * Token Validation Service
 * Handles Fyers token validation and automatic user status updates
 */
class TokenValidationService {
  static tokenValidationCache = new Map();
  static VALIDATION_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  /**
   * Validate Fyers token for a user
   * @param {Object} user - User object
   * @returns {Promise<boolean>} - Whether token is valid
   */
  static async validateFyersToken(user) {
    if (!user || !user.fyers || !user.fyers.accessToken) {
      return false;
    }

    // Check cache first
    const cacheKey = `${user._id}_${user.fyers.accessToken}`;
    const cached = this.tokenValidationCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < this.VALIDATION_CACHE_TTL) {
      return cached.isValid;
    }

    try {
      const { getFyersAppId } = require('../fyersService');
      const appId = getFyersAppId();
      const accessToken = `${appId}:${user.fyers.accessToken}`;

      // Test token with a simple API call
      const FyersAPI = require("fyers-api-v3").fyersModel;
      const fyers = new FyersAPI();
      fyers.setAppId(appId);
      fyers.setAccessToken(user.fyers.accessToken);

      // Try to get profile info (lightweight call)
      const response = await fyers.getProfile();
      
      const isValid = response && response.s === 'ok';
      
      // Cache the result
      this.tokenValidationCache.set(cacheKey, {
        isValid,
        timestamp: Date.now()
      });

      if (!isValid) {
        LoggerService.warn('TokenValidationService', `Token validation failed for user ${user._id}`);
        await this.markUserAsDisconnected(user._id);
      }

      return isValid;
    } catch (error) {
      LoggerService.error('TokenValidationService', `Error validating token for user ${user._id}:`, error);
      
      // Check if it's a token expiration error
      const errorMessage = error.message || '';
      const isTokenExpired = 
        errorMessage.includes('Could not authenticate') ||
        errorMessage.includes('token expired') ||
        errorMessage.includes('invalid token') ||
        errorMessage.includes('unauthorized') ||
        errorMessage.includes('access denied') ||
        errorMessage.includes('code: -16');

      if (isTokenExpired) {
        await this.markUserAsDisconnected(user._id);
      }

      // Cache the failure
      this.tokenValidationCache.set(cacheKey, {
        isValid: false,
        timestamp: Date.now()
      });

      return false;
    }
  }

  /**
   * Mark user as disconnected in database
   * @param {string} userId - User ID
   */
  static async markUserAsDisconnected(userId) {
    try {
      const User = require('../models/User');
      await User.findByIdAndUpdate(userId, {
        'fyers.connected': false,
        'fyers.lastDisconnectTime': new Date()
      });
      LoggerService.info('TokenValidationService', `Marked user ${userId} as disconnected due to expired token`);
    } catch (error) {
      LoggerService.error('TokenValidationService', `Error marking user ${userId} as disconnected:`, error);
    }
  }

  /**
   * Clear validation cache for a user
   * @param {string} userId - User ID
   */
  static clearUserCache(userId) {
    for (const [key] of this.tokenValidationCache) {
      if (key.startsWith(`${userId}_`)) {
        this.tokenValidationCache.delete(key);
      }
    }
  }

  /**
   * Clear all validation cache
   */
  static clearAllCache() {
    this.tokenValidationCache.clear();
  }

  /**
   * Get cache statistics
   */
  static getCacheStats() {
    return {
      size: this.tokenValidationCache.size,
      entries: Array.from(this.tokenValidationCache.entries()).map(([key, value]) => ({
        key: key.split('_')[0], // Just the user ID part
        isValid: value.isValid,
        age: Date.now() - value.timestamp
      }))
    };
  }

  /**
   * Validate all active users' tokens
   * @returns {Promise<Object>} - Validation results
   */
  static async validateAllActiveUsers() {
    try {
      const User = require('../models/User');
      const activeUsers = await User.find({ 'fyers.connected': true });
      
      const results = {
        total: activeUsers.length,
        valid: 0,
        invalid: 0,
        errors: []
      };

      for (const user of activeUsers) {
        try {
          const isValid = await this.validateFyersToken(user);
          if (isValid) {
            results.valid++;
          } else {
            results.invalid++;
          }
        } catch (error) {
          results.errors.push({ userId: user._id, error: error.message });
        }
      }

      LoggerService.info('TokenValidationService', `Token validation complete: ${results.valid} valid, ${results.invalid} invalid`);
      return results;
    } catch (error) {
      LoggerService.error('TokenValidationService', 'Error validating all users:', error);
      throw error;
    }
  }

  /**
   * Start periodic token validation
   * @param {number} intervalMinutes - Validation interval in minutes
   */
  static startPeriodicValidation(intervalMinutes = 30) {
    if (this.validationTimer) {
      clearInterval(this.validationTimer);
    }

    this.validationTimer = setInterval(async () => {
      try {
        await this.validateAllActiveUsers();
      } catch (error) {
        LoggerService.error('TokenValidationService', 'Error in periodic validation:', error);
      }
    }, intervalMinutes * 60 * 1000);

    LoggerService.info('TokenValidationService', `Started periodic token validation every ${intervalMinutes} minutes`);
  }

  /**
   * Stop periodic token validation
   */
  static stopPeriodicValidation() {
    if (this.validationTimer) {
      clearInterval(this.validationTimer);
      this.validationTimer = null;
      LoggerService.info('TokenValidationService', 'Stopped periodic token validation');
    }
  }
}

module.exports = TokenValidationService; 