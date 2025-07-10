const mongoose = require('mongoose');

const exitLogSchema = new mongoose.Schema({
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
  sell_price: {
    type: Number,
    required: true
  },
  sell_date: {
    type: Date,
    required: true
  },
  quantity: {
    type: Number,
    required: true
  },
  holding_days: {
    type: Number,
    required: true
  },
  invested_value: {
    type: Number,
    required: true
  },
  pnl_amount: {
    type: Number,
    required: true
  },
  pnl_percentage: {
    type: Number,
    required: true
  },
  exit_reason: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

// Index for efficient queries by user
exitLogSchema.index({ userId: 1 });

// Index for symbol queries
exitLogSchema.index({ symbol: 1 });

// Index for date range queries
exitLogSchema.index({ sell_date: -1 });

module.exports = mongoose.model('ExitLog', exitLogSchema); 