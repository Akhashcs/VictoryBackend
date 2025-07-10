const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const signalTableService = require('../services/signalTableService');
const LoggerService = require('../services/loggerService');

// Signal table service is already instantiated

// Get all signal table data
router.get('/data', auth, async (req, res) => {
  try {
    const data = await signalTableService.getSignalTableData();
    res.json(data);
  } catch (error) {
    LoggerService.error('SignalTable', 'Error fetching signal table data:', error);
    res.status(500).json({ error: 'Failed to fetch signal table data' });
  }
});

// Get last updated time
router.get('/last-updated', auth, async (req, res) => {
  try {
    const lastUpdated = await signalTableService.getLastUpdatedTime();
    res.json({ lastUpdated });
  } catch (error) {
    LoggerService.error('SignalTable', 'Error fetching last updated time:', error);
    res.status(500).json({ error: 'Failed to fetch last updated time' });
  }
});

// Initialize signal table service
router.post('/initialize', auth, async (req, res) => {
  try {
    await signalTableService.initialize();
    res.json({ message: 'Signal table service initialized successfully' });
  } catch (error) {
    LoggerService.error('SignalTable', 'Error initializing signal table service:', error);
    res.status(500).json({ error: 'Failed to initialize signal table service' });
  }
});

// Manual trigger for updating signal data
router.post('/trigger-update', auth, async (req, res) => {
  try {
    const results = await signalTableService.triggerUpdate();
    res.json({ 
      message: 'Signal table update triggered successfully',
      updatedCount: results ? results.length : 0
    });
  } catch (error) {
    LoggerService.error('SignalTable', 'Error triggering signal table update:', error);
    res.status(500).json({ error: 'Failed to trigger signal table update' });
  }
});

// Stop update interval
router.post('/stop-updates', auth, async (req, res) => {
  try {
    signalTableService.stopUpdateInterval();
    res.json({ message: 'Signal table updates stopped successfully' });
  } catch (error) {
    LoggerService.error('SignalTable', 'Error stopping signal table updates:', error);
    res.status(500).json({ error: 'Failed to stop signal table updates' });
  }
});

module.exports = router; 