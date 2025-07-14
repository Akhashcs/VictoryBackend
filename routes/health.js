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

/**
 * @route   GET /api/ping
 * @desc    Ping endpoint to wake up inactive server
 * @access  Public
 */
router.get('/ping', (req, res) => {
  const now = new Date();
  const istTime = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  
  console.log(`[Health] Ping request received at ${istTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
  
  res.json({
    status: 'pong',
    timestamp: istTime.toISOString(),
    istTime: istTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
    message: 'Server is awake and responding'
  });
});

module.exports = router; 