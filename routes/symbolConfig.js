const express = require('express');
const router = express.Router();
const { SymbolService } = require('../services/symbolService');
const SymbolConfig = require('../models/SymbolConfig');

// Remove in-memory storage for symbol configurations
// let symbolConfigs = [ ... ];

// Get all symbol configurations
router.get('/config', async (req, res) => {
  try {
    const symbolConfigs = await SymbolConfig.find({});
    res.json({
      success: true,
      data: symbolConfigs
    });
  } catch (error) {
    console.error('Error getting symbol configs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get symbol configurations'
    });
  }
});

// Add new symbol configuration
router.post('/config', async (req, res) => {
  try {
    const { symbolName, symbolInput, tabType, optionSymbolFormat, nextExpiry, expiryDate, nearExpiryDate, strikeInterval, lotSize } = req.body;
    
    if (!symbolName || !symbolInput) {
      return res.status(400).json({
        success: false,
        message: 'Symbol name and symbol input are required'
      });
    }

    const newSymbol = new SymbolConfig({
      symbolName,
      symbolInput,
      tabType: tabType || 'index',
      optionSymbolFormat: optionSymbolFormat || '',
      nextExpiry: nextExpiry || 'monthly',
      expiryDate: expiryDate || '',
      nearExpiryDate: nearExpiryDate || '',
      strikeInterval: strikeInterval || 50,
      lotSize: lotSize || 1
    });

    const savedSymbol = await newSymbol.save();

    res.json({
      success: true,
      data: savedSymbol,
      message: 'Symbol configuration added successfully'
    });
  } catch (error) {
    console.error('Error adding symbol config:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add symbol configuration'
    });
  }
});

// Update symbol configuration
router.put('/config/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const update = req.body;
    const updatedSymbol = await SymbolConfig.findByIdAndUpdate(id, update, { new: true });
    if (!updatedSymbol) {
      return res.status(404).json({ success: false, message: 'Symbol configuration not found' });
    }
    res.json({
      success: true,
      data: updatedSymbol,
      message: 'Symbol configuration updated successfully'
    });
  } catch (error) {
    console.error('Error updating symbol config:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update symbol configuration'
    });
  }
});

// Delete symbol configuration
router.delete('/config/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const deletedSymbol = await SymbolConfig.findByIdAndDelete(id);
    if (!deletedSymbol) {
      return res.status(404).json({ success: false, message: 'Symbol configuration not found' });
    }
    res.json({
      success: true,
      data: deletedSymbol,
      message: 'Symbol configuration deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting symbol config:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete symbol configuration'
    });
  }
});

// Bulk save symbol configurations
router.post('/config/bulk', async (req, res) => {
  try {
    const { symbols } = req.body;
    if (!Array.isArray(symbols)) {
      return res.status(400).json({ success: false, message: 'Symbols must be an array' });
    }
    // Remove all existing and insert new
    await SymbolConfig.deleteMany({});
    await SymbolConfig.insertMany(symbols);
    res.json({ success: true, message: 'All symbols saved successfully' });
  } catch (error) {
    console.error('Error in bulk save:', error);
    res.status(500).json({ success: false, message: 'Failed to save symbols' });
  }
});

// Get symbols by tab type
router.get('/config/tab/:tabType', async (req, res) => {
  try {
    const { tabType } = req.params;
    const filteredSymbols = await SymbolConfig.find({ tabType });
    
    res.json({
      success: true,
      data: filteredSymbols
    });
  } catch (error) {
    console.error('Error getting symbols by tab type:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get symbols by tab type'
    });
  }
});

// Get all symbols for market data fetching
router.get('/config/market-data', async (req, res) => {
  try {
    const symbolConfigs = await SymbolConfig.find({});
    const marketDataSymbols = symbolConfigs.map(symbol => symbol.symbolInput);
    
    res.json({
      success: true,
      data: marketDataSymbols
    });
  } catch (error) {
    console.error('Error getting market data symbols:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get market data symbols'
    });
  }
});

// Export the symbol configs for use in other services
const getSymbolConfigs = () => {
  // This function is no longer needed as symbolConfigs is removed
  // return symbolConfigs;
};

module.exports = { router, getSymbolConfigs }; 