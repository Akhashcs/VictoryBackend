const express = require('express');
const { generateAuthUrl, validateAuthCode, getProfile, getFyersAppId, validateAccessToken } = require('../fyersService');
const auth = require('../middleware/auth');

const router = express.Router();

// POST /api/fyers/generate-auth-url
router.post('/generate-auth-url', auth, async (req, res) => {
  try {
    const { appId, secret, redirectUri } = req.body;
    if (!appId || !secret || !redirectUri) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    const url = generateAuthUrl(appId, secret, redirectUri);
    res.json({ url });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to generate Fyers auth URL' });
  }
});

// POST /api/fyers/authorize
router.post('/authorize', auth, async (req, res) => {
  try {
    const { code, appId, secret, redirectUri } = req.body;
    if (!code || !appId || !secret || !redirectUri) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    const tokenData = await validateAuthCode(code, appId, secret, redirectUri);
    if (!tokenData.access_token) {
      return res.status(400).json({ error: tokenData.message || 'Fyers authorization failed' });
    }
    // Fetch Fyers profile
    const profile = await getProfile(`${appId}:${tokenData.access_token}`);
    // Save to user
    const User = require('../models/User');
    const user = await User.findById(req.user._id);
    if (!user) {
      console.error('[Fyers] User not found for saving token:', req.user._id);
      return res.status(404).json({ error: 'User not found' });
    }
    user.fyers = {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || null,
      profile,
      connected: true
    };
    console.log('[Fyers] Saving Fyers token for user:', user._id, user.fyers);
    try {
      console.log('[Fyers] About to call user.save()...');
      const savedUser = await user.save();
      console.log('[Fyers] User document saved successfully:', user._id);
      console.log('[Fyers] Saved user fyers field:', savedUser.fyers);
    } catch (saveError) {
      console.error('[Fyers] Error saving user with Fyers token:', saveError);
      console.error('[Fyers] Error details:', saveError.message);
      console.error('[Fyers] Error stack:', saveError.stack);
      
      // Try fallback method using findByIdAndUpdate
      try {
        console.log('[Fyers] Trying fallback with findByIdAndUpdate...');
        const updatedUser = await User.findByIdAndUpdate(
          user._id,
          { fyers: user.fyers },
          { new: true, runValidators: true }
        );
        if (updatedUser) {
          console.log('[Fyers] User updated successfully with findByIdAndUpdate:', updatedUser._id);
          console.log('[Fyers] Updated user fyers field:', updatedUser.fyers);
        } else {
          throw new Error('findByIdAndUpdate returned null');
        }
      } catch (fallbackError) {
        console.error('[Fyers] Fallback method also failed:', fallbackError);
        return res.status(500).json({ 
          error: 'Failed to save Fyers token to user', 
          details: `Save error: ${saveError.message}, Fallback error: ${fallbackError.message}` 
        });
      }
    }
    // Restart Fyers WebSocket with new token
    try {
      const { fyersWebSocketService } = require('../services/fyersWebSocketService');
      await fyersWebSocketService.restart();
      console.log('[Fyers] WebSocket restarted with new token');
    } catch (wsError) {
      console.error('[Fyers] Error restarting WebSocket:', wsError);
      // Don't fail the request if WebSocket restart fails
    }

    // Return profile with access token for localStorage storage
    res.json({ 
      success: true, 
      profile: {
        ...profile,
        accessToken: tokenData.access_token
      }
    });
  } catch (error) {
    console.error('[Fyers] Error in /authorize:', error);
    res.status(500).json({ error: error.message || 'Fyers authorization failed' });
  }
});

// GET /api/fyers/profile
router.get('/profile', auth, async (req, res) => {
  try {
    const User = require('../models/User');
    const user = await User.findById(req.user._id);
    if (user && user.fyers && user.fyers.connected && user.fyers.profile) {
      res.json({ 
        connected: true, 
        profile: {
          ...user.fyers.profile,
          accessToken: user.fyers.accessToken
        }
      });
    } else {
      res.json({ connected: false });
    }
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to fetch Fyers profile' });
  }
});

// GET /api/fyers/status
router.get('/status', auth, async (req, res) => {
  try {
    const User = require('../models/User');
    const user = await User.findById(req.user._id);
    if (user && user.fyers && user.fyers.connected && user.fyers.accessToken) {
      // Validate the token to check if it's still valid
      try {
        const appId = getFyersAppId();
        const accessToken = `${appId}:${user.fyers.accessToken}`;
        const validation = await validateAccessToken(accessToken);
        
        if (validation.valid) {
          res.json({ 
            connected: true, 
            profileName: user.fyers.profile?.data?.name || null,
            tokenValid: true
          });
        } else {
          // Token is expired or invalid, mark as disconnected
          console.log(`[Fyers] Token expired for user ${user._id}:`, validation.error);
          
          // Update user's Fyers status to disconnected
          user.fyers.connected = false;
          await user.save();
          
          res.json({ 
            connected: false, 
            tokenExpired: true,
            message: 'Fyers token has expired. Please reconnect.'
          });
        }
      } catch (validationError) {
        console.error('[Fyers] Error validating token:', validationError);
        res.json({ 
          connected: false, 
          tokenExpired: true,
          message: 'Unable to validate Fyers token. Please reconnect.'
        });
      }
    } else {
      res.json({ connected: false });
    }
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to fetch Fyers status' });
  }
});

// GET /api/fyers/access-token
router.get('/access-token', auth, async (req, res) => {
  try {
    const User = require('../models/User');
    const user = await User.findById(req.user._id);
    if (user && user.fyers && user.fyers.connected && user.fyers.accessToken) {
      const appId = getFyersAppId();
      res.json({ 
        success: true, 
        accessToken: user.fyers.accessToken,
        appId: appId
      });
    } else {
      res.status(401).json({ error: 'Fyers not connected or access token not available' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to fetch Fyers access token' });
  }
});

// GET /api/fyers/funds
router.get('/funds', auth, async (req, res) => {
  try {
    const User = require('../models/User');
    const user = await User.findById(req.user._id);
    if (user && user.fyers && user.fyers.connected && user.fyers.accessToken) {
      const appId = getFyersAppId();
      const accessToken = `${appId}:${user.fyers.accessToken}`;
      const funds = await require('../fyersService').getFunds(accessToken);
      res.json({ success: true, funds });
    } else {
      res.status(401).json({ error: 'Fyers not connected or access token not available' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to fetch Fyers funds' });
  }
});

// POST /api/fyers/market-depth
router.post('/market-depth', auth, async (req, res) => {
  try {
    const { symbols } = req.body;
    if (!Array.isArray(symbols) || symbols.length === 0) {
      return res.status(400).json({ error: 'Symbols array is required' });
    }
    const User = require('../models/User');
    const user = await User.findById(req.user._id);
    if (!user || !user.fyers || !user.fyers.connected || !user.fyers.accessToken) {
      return res.status(401).json({ error: 'Fyers not connected. Please connect your Fyers account first.' });
    }
    const appId = getFyersAppId();
    const accessToken = `${appId}:${user.fyers.accessToken}`;
    const result = await require('../fyersService').getMarketDepth(accessToken, symbols);
    res.json({ success: true, depth: result.d || {} });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to fetch market depth' });
  }
});

// POST /api/fyers/disconnect
router.post('/disconnect', auth, async (req, res) => {
  try {
    const User = require('../models/User');
    const user = await User.findById(req.user._id);
    
    if (user && user.fyers) {
      // Clear Fyers connection data
      user.fyers = {
        accessToken: null,
        refreshToken: null,
        profile: null,
        connected: false
      };
      await (user.save ? user.save() : User.findByIdAndUpdate(user._id, { fyers: user.fyers }));
      
      // Restart WebSocket to use another user's token if available
      try {
        const { fyersWebSocketService } = require('../services/fyersWebSocketService');
        await fyersWebSocketService.restart();
        console.log('[Fyers] WebSocket restarted after user disconnect');
      } catch (wsError) {
        console.error('[Fyers] Error restarting WebSocket after disconnect:', wsError);
      }
      
      console.log(`✅ User ${user._id} disconnected from Fyers`);
      res.json({ success: true, message: 'Successfully disconnected from Fyers' });
    } else {
      res.json({ success: true, message: 'Already disconnected from Fyers' });
    }
  } catch (error) {
    console.error('Error disconnecting from Fyers:', error);
    res.status(500).json({ error: error.message || 'Failed to disconnect from Fyers' });
  }
});

// POST /api/fyers/restart-websocket
router.post('/restart-websocket', auth, async (req, res) => {
  try {
    const { fyersWebSocketService } = require('../services/fyersWebSocketService');
    const success = await fyersWebSocketService.restart();
    
    if (success) {
      res.json({ success: true, message: 'Fyers WebSocket restarted successfully' });
    } else {
      res.status(400).json({ error: 'Failed to restart Fyers WebSocket. No valid access token found.' });
    }
  } catch (error) {
    console.error('Error restarting Fyers WebSocket:', error);
    res.status(500).json({ error: error.message || 'Failed to restart Fyers WebSocket' });
  }
});

// GET /api/fyers/validate-token (public route to check token validity)
router.get('/validate-token', auth, async (req, res) => {
  try {
    const User = require('../models/User');
    const user = await User.findById(req.user._id);
    
    if (!user || !user.fyers || !user.fyers.accessToken) {
      return res.json({ 
        valid: false, 
        connected: false,
        message: 'No Fyers token found'
      });
    }
    
    const appId = getFyersAppId();
    const accessToken = `${appId}:${user.fyers.accessToken}`;
    const validation = await validateAccessToken(accessToken);
    
    if (validation.valid) {
      res.json({ 
        valid: true, 
        connected: true,
        profileName: user.fyers.profile?.data?.name || null
      });
    } else {
      // Update user's Fyers status to disconnected
      user.fyers.connected = false;
      await user.save();
      
      res.json({ 
        valid: false, 
        connected: false,
        expired: validation.expired,
        message: validation.error || 'Token validation failed'
      });
    }
  } catch (error) {
    console.error('Error validating Fyers token:', error);
    res.status(500).json({ 
      valid: false, 
      connected: false,
      error: error.message || 'Failed to validate token'
    });
  }
});

// GET /api/fyers/websocket-status
router.get('/websocket-status', auth, async (req, res) => {
  try {
    const { fyersWebSocketService } = require('../services/fyersWebSocketService');
    const status = fyersWebSocketService.getConnectionStatus();
    res.json({ success: true, status });
  } catch (error) {
    console.error('Error getting WebSocket status:', error);
    res.status(500).json({ error: error.message || 'Failed to get WebSocket status' });
  }
});

// GET /api/fyers/maintenance-status
router.get('/maintenance-status', auth, async (req, res) => {
  try {
    const MaintenanceService = require('../maintenanceService');
    const maintenanceInfo = MaintenanceService.getMaintenanceInfo();
    
    res.json({
      success: true,
      maintenance: maintenanceInfo
    });
  } catch (error) {
    console.error('Error getting maintenance status:', error);
    res.status(500).json({ error: error.message || 'Failed to get maintenance status' });
  }
});

// POST /api/fyers/sync-positions
router.post('/sync-positions', auth, async (req, res) => {
  try {
    const { fyersWebSocketService } = require('../services/fyersWebSocketService');
    const result = await fyersWebSocketService.syncPositionsFromFyersAPI(req.user._id);
    
    if (result.success) {
      res.json({ 
        success: true, 
        message: `Successfully synced ${result.positionsCount} positions from Fyers`,
        positionsCount: result.positionsCount
      });
    } else {
      res.status(400).json({ error: result.error || 'Failed to sync positions from Fyers' });
    }
  } catch (error) {
    console.error('Error syncing positions from Fyers:', error);
    res.status(500).json({ error: error.message || 'Failed to sync positions from Fyers' });
  }
});

module.exports = router; 