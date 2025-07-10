const jwt = require('jsonwebtoken');
const LoggerService = require('../services/loggerService');

const auth = async (req, res, next) => {
  const User = require('../models/User');
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      LoggerService.error('Auth', 'No token provided');
      return res.status(401).json({ error: 'Access denied. No token provided.' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production');
    
    let user;
    if (global.useInMemoryStorage) {
      user = await User.findById(decoded.userId);
    } else {
      user = await User.findById(decoded.userId).select('-password');
    }
    
    if (!user || !user.isActive) {
      LoggerService.error('Auth', `User not found or inactive: ${decoded.userId}`);
      return res.status(401).json({ error: 'Invalid token or user not found.' });
    }

    // Use the new auth check method to reduce repetitive logs
    LoggerService.authCheck(decoded.userId, true, `${req.method} ${req.path}`);
    
    req.user = user;
    next();
  } catch (error) {
    LoggerService.error('Auth', `Authentication error: ${error.message}`, error);
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token.' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired.' });
    }
    res.status(500).json({ error: 'Server error.' });
  }
};

module.exports = auth; 