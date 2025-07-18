const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const TokenValidationService = require('../services/tokenValidationService');
const LoggerService = require('../services/loggerService');

/**
 * GET /api/token-validation/status
 * Get token validation status for the authenticated user
 */
router.get('/status', auth, async (req, res) => {
  try {
    const user = req.user;
    const isValid = await TokenValidationService.validateFyersToken(user);
    
    res.json({
      success: true,
      isValid,
      userId: user._id,
      hasToken: !!(user.fyers && user.fyers.accessToken),
      isConnected: !!(user.fyers && user.fyers.connected)
    });
  } catch (error) {
    LoggerService.error('TokenValidation', 'Error checking token status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check token status'
    });
  }
});

/**
 * POST /api/token-validation/validate-all
 * Validate all active users' tokens (admin only)
 */
router.post('/validate-all', auth, async (req, res) => {
  try {
    // Check if user is admin (you can implement your own admin check)
    if (user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }

    const results = await TokenValidationService.validateAllActiveUsers();
    
    res.json({
      success: true,
      results
    });
  } catch (error) {
    LoggerService.error('TokenValidation', 'Error validating all tokens:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to validate all tokens'
    });
  }
});

/**
 * GET /api/token-validation/cache-stats
 * Get token validation cache statistics
 */
router.get('/cache-stats', auth, async (req, res) => {
  try {
    const stats = TokenValidationService.getCacheStats();
    
    res.json({
      success: true,
      stats
    });
  } catch (error) {
    LoggerService.error('TokenValidation', 'Error getting cache stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get cache statistics'
    });
  }
});

/**
 * POST /api/token-validation/clear-cache
 * Clear token validation cache for the authenticated user
 */
router.post('/clear-cache', auth, async (req, res) => {
  try {
    const user = req.user;
    TokenValidationService.clearUserCache(user._id);
    
    res.json({
      success: true,
      message: 'Cache cleared for user'
    });
  } catch (error) {
    LoggerService.error('TokenValidation', 'Error clearing cache:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to clear cache'
    });
  }
});

module.exports = router; 