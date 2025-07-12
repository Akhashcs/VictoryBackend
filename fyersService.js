const axios = require('axios');
const crypto = require('crypto');

// Fyers API v3 configuration
const FYERS_BASE_URL = 'https://api-t1.fyers.in/api/v3';
const FYERS_APP_ID = process.env.FYERS_APP_ID || 'XJFL311ATX-100';
const FYERS_SECRET = process.env.FYERS_SECRET || '';

/**
 * Generate Fyers authorization URL using API v3
 */
function generateAuthUrl(appId, secret, redirectUri) {
  const state = crypto.randomBytes(32).toString('hex');
  const nonce = crypto.randomBytes(32).toString('hex');
  
  const url = `${FYERS_BASE_URL}/generate-authcode?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=${state}&nonce=${nonce}`;
  return url;
}

/**
 * Validate authorization code and get access token using API v3
 */
async function validateAuthCode(code, appId, secret, redirectUri) {
  try {
    if (!code) {
      throw new Error('auth code is required');
    }
    
    // Generate appIdHash as per Fyers API requirements
    const appIdHash = generateAppIdHash(appId, secret, redirectUri);
    const requestBody = {
      grant_type: 'authorization_code',
      appIdHash,
      code: code
    };
    
    const response = await axios.post(`${FYERS_BASE_URL}/validate-authcode`, requestBody, {
      headers: { 'Content-Type': 'application/json' }
    });
    
    if (response.data.s === 'ok') {
      return {
        access_token: response.data.access_token,
        refresh_token: response.data.refresh_token
      };
    } else {
      return { message: response.data.message || 'Authorization failed' };
    }
  } catch (error) {
    console.error('Fyers auth validation error:', error.response?.data || error.message);
    throw new Error(error.response?.data?.message || 'Failed to validate authorization code');
  }
}

/**
 * Generate appIdHash as SHA-256 of appId + ":" + appSecret (per Fyers documentation)
 */
function generateAppIdHash(appId, appSecret, redirectUri) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(`${appId}:${appSecret}`).digest('hex');
}

/**
 * Get Fyers user profile using API v3
 */
async function getProfile(accessToken) {
  try {
    // Extract appId from the token format (appId:token)
    const [appId, token] = accessToken.split(':');
    
    if (!appId || !token) {
      throw new Error('Invalid access token format - expected appId:token');
    }
    
    // Initialize Fyers API client
    const FyersAPI = require("fyers-api-v3").fyersModel;
    const fyers = new FyersAPI();
    fyers.setAppId(appId);
    fyers.setAccessToken(token);
    
    // Use the get_profile method which is a direct property on the fyers instance
    const response = await fyers.get_profile();
    return response;
  } catch (error) {
    console.error('Error fetching Fyers profile:', error);
    throw error;
  }
}

/**
 * Get Fyers app ID
 */
function getFyersAppId() {
  return FYERS_APP_ID;
}

/**
 * Get Fyers funds using API v3
 */
async function getFunds(accessToken) {
  try {
    // Extract appId from the token format (appId:token)
    const [appId, token] = accessToken.split(':');
    
    if (!appId || !token) {
      throw new Error('Invalid access token format - expected appId:token');
    }
    
    // Initialize Fyers API client
    const FyersAPI = require("fyers-api-v3").fyersModel;
    const fyers = new FyersAPI();
    fyers.setAppId(appId);
    fyers.setAccessToken(token);
    
    // Use the get_funds method
    const response = await fyers.get_funds();
    return response;
  } catch (error) {
    console.error('Error fetching Fyers funds:', error);
    throw error;
  }
}

/**
 * Get market depth for symbols using API v3
 */
async function getMarketDepth(accessToken, symbols) {
  try {
    // Extract appId from the token format (appId:token)
    const [appId, token] = accessToken.split(':');
    
    if (!appId || !token) {
      throw new Error('Invalid access token format - expected appId:token');
    }
    
    // Initialize Fyers API client
    const FyersAPI = require("fyers-api-v3").fyersModel;
    const fyers = new FyersAPI();
    fyers.setAppId(appId);
    fyers.setAccessToken(token);
    
    const inp = { symbol: symbols, ohlcv_flag: 1 };
    const response = await fyers.getMarketDepth(inp);
    
    return response;
  } catch (error) {
    console.error('Fyers market depth error:', error.response?.data || error.message);
    throw new Error('Failed to get market depth');
  }
}

module.exports = {
  generateAuthUrl,
  validateAuthCode,
  getProfile,
  getFyersAppId,
  getFunds,
  getMarketDepth,
  generateAppIdHash
}; 