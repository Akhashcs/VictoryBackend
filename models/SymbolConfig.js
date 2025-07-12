const mongoose = require('mongoose');

const SymbolConfigSchema = new mongoose.Schema({
  symbolName: { type: String, required: true },
  symbolInput: { type: String, required: true },
  tabType: { type: String, enum: ['index', 'stock', 'commodity'], required: true },
  optionSymbolFormat: { type: String, default: '' },
  nextExpiry: { type: String, enum: ['weekly', 'monthly', 'quarterly', 'custom', 'none'], required: true },
  expiryDate: { type: String, default: '' },
  nearExpiryDate: { type: String, default: '' },
  strikeInterval: { type: Number, default: 50 },
  lotSize: { type: Number, default: 1 },
}, { timestamps: true });

module.exports = mongoose.model('SymbolConfig', SymbolConfigSchema); 