const mongoose = require('mongoose');

const hmaSignalSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  symbol: {
    type: String,
    required: true
  },
  hma_value: {
    type: Number,
    required: true
  },
  // Hull Suite HMA9 strategy fields
  hma9_value: {
    type: Number,
    default: null
  },
  hma55_minus2_value: {
    type: Number,
    default: null
  },
  crossover_date: {
    type: Date,
    required: true
  },
  signal_type: {
    type: String,
    enum: ['Buy', 'Sell', 'Bullish', 'Bearish', 'No Signal'],
    required: true
  },
  current_price: {
    type: Number,
    default: 0
  },
  previous_close: {
    type: Number,
    default: 0
  },
  daily_signal: {
    type: String,
    enum: ['Bullish', 'Bearish', 'Neutral', 'N/A'],
    default: 'N/A'
  },
  weekly_signal: {
    type: String,
    enum: ['Bullish', 'Bearish', 'Neutral', 'N/A'],
    default: 'N/A'
  },
  daily_close: {
    type: Number,
    default: 0
  },
  weekly_close: {
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
hmaSignalSchema.index({ userId: 1 });

// Index for symbol queries
hmaSignalSchema.index({ symbol: 1 });

// Index for signal type queries
hmaSignalSchema.index({ signal_type: 1 });

// Compound index for user + symbol queries
hmaSignalSchema.index({ userId: 1, symbol: 1 }, { unique: true });

module.exports = mongoose.model('HMASignal', hmaSignalSchema); 