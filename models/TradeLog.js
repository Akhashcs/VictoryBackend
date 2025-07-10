const mongoose = require('mongoose');

const TradeLogSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  symbol: {
    type: String,
    required: true
  },
  action: {
    type: String,
    enum: [
      'ORDER_PLACED',
      'ORDER_FILLED', 
      'ORDER_REJECTED',
      'ORDER_MODIFIED',
      'ORDER_CANCELLED',
      'TARGET_HIT',
      'STOP_LOSS_HIT',
      'TRAILING_UPDATE',
      'RE_ENTRY_ADDED',
      'POSITION_CLOSED'
    ],
    required: true
  },
  orderType: {
    type: String,
    enum: ['LIMIT', 'MARKET', 'SL-M', 'SL-L', 'BUY_SL_LIMIT', 'SELL_SL_LIMIT', 'SL_LIMIT'],
    required: true
  },
  quantity: {
    type: Number,
    required: true
  },
  price: {
    type: Number,
    required: true
  },
  side: {
    type: String,
    enum: ['BUY', 'SELL'],
    required: false
  },
  productType: {
    type: String,
    enum: ['INTRADAY', 'MARGIN', 'CNC'],
    required: false
  },
  orderId: {
    type: String,
    required: false
  },
  status: {
    type: String,
    enum: [
      'PENDING',
      'FILLED',
      'REJECTED',
      'CANCELLED',
      'MODIFIED',
      'TARGET_EXECUTED',
      'SL_EXECUTED',
      'PARTIALLY_FILLED'
    ],
    required: true
  },
  reason: {
    type: String,
    enum: [
      'ENTRY',
      'SL',
      'TARGET',
      'TRAILING',
      'STOP_LOSS',
      'RE_ENTRY',
      'MANUAL'
    ],
    required: false
  },
  timestamp: {
    type: Date,
    default: Date.now,
    required: true,
    index: true
  },
  details: {
    type: Object,
    default: {}
  },
  pnl: {
    type: Number,
    default: 0
  },
  pnlPercentage: {
    type: Number,
    default: 0
  },
  tradeType: {
    type: String,
    enum: ['LIVE'],
    default: 'LIVE'
  },
  remarks: {
    type: String,
    default: ''
  },
  fyersOrderId: {
    type: String,
    required: false
  },
  fyersOrderStatus: {
    type: String,
    required: false
  },
  fyersRemarks: {
    type: String,
    default: ''
  }
});

// Add indexes for efficient querying
TradeLogSchema.index({ userId: 1, timestamp: -1 });
TradeLogSchema.index({ userId: 1, action: 1 });
TradeLogSchema.index({ userId: 1, status: 1 });
TradeLogSchema.index({ timestamp: -1 });

// Add method to get formatted log entry
TradeLogSchema.methods.getFormattedLog = function() {
  return {
    id: this._id,
    symbol: this.symbol,
    action: this.action,
    orderType: this.orderType,
    quantity: this.quantity,
    price: this.price,
    side: this.side,
    status: this.status,
    reason: this.reason,
    timestamp: this.timestamp,
    details: this.details,
    pnl: this.pnl,
    pnlPercentage: this.pnlPercentage,
    remarks: this.remarks,
    fyersOrderId: this.fyersOrderId,
    fyersOrderStatus: this.fyersOrderStatus,
    fyersRemarks: this.fyersRemarks
  };
};

module.exports = mongoose.model('TradeLog', TradeLogSchema);
