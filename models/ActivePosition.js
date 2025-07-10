const mongoose = require('mongoose');

const activePositionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  symbol: {
    type: String,
    required: true
  },
  buy_price: {
    type: Number,
    required: true
  },
  buy_date: {
    type: Date,
    required: true
  },
  quantity: {
    type: Number,
    required: true
  },
  // Auto-calculated fields (stored for performance)
  current_price: {
    type: Number,
    default: 0
  },
  hma_55: {
    type: Number,
    default: 0
  },
  signal: {
    type: String,
    enum: ['Buy', 'Sell', 'Bullish', 'Bearish'],
    default: 'Buy'
  },
  holding_days: {
    type: Number,
    default: 0
  },
  invested_value: {
    type: Number,
    default: 0
  },
  current_value: {
    type: Number,
    default: 0
  },
  pnl_amount: {
    type: Number,
    default: 0
  },
  pnl_percentage: {
    type: Number,
    default: 0
  },
  last_updated: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Index for efficient queries by user
activePositionSchema.index({ userId: 1 });

// Index for symbol queries
activePositionSchema.index({ symbol: 1 });

module.exports = mongoose.model('ActivePosition', activePositionSchema); 