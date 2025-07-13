/**
 * Health Check Routes
 */
const express = require('express');
const router = express.Router();

/**
 * @route   GET /api/health
 * @desc    Health check endpoint for ping service
 * @access  Public
 */
router.get('/', (req, res) => {
  const now = new Date();
  const istTime = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  
  res.json({
    status: 'healthy',
    timestamp: istTime.toISOString(),
    istTime: istTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    environment: process.env.NODE_ENV || 'development'
  });
});

module.exports = router; 