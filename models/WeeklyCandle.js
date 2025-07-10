const mongoose = require('mongoose');

const weeklyDataSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  symbol: {
    type: String,
    required: true,
    index: true
  },
  week_start_date: {
    type: String,
    required: true,
    index: true
  },
  open: {
    type: Number,
    required: true
  },
  high: {
    type: Number,
    required: true
  },
  low: {
    type: Number,
    required: true
  },
  close: {
    type: Number,
    required: true
  },
  volume: {
    type: Number,
    required: true
  },
  candle_count: {
    type: Number,
    default: 1
  }
}, {
  timestamps: true
});

// Compound index to ensure unique user + symbol + week combinations
weeklyDataSchema.index({ userId: 1, symbol: 1, week_start_date: 1 }, { unique: true });

// Index for efficient queries by user
weeklyDataSchema.index({ userId: 1 });

// Index for efficient queries by symbol
weeklyDataSchema.index({ symbol: 1, week_start_date: -1 });

module.exports = mongoose.model('WeeklyData', weeklyDataSchema); 