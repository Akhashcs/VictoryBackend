// Force schema reload - clear any cached version
// Schema updated on 2025-07-03 to fix monitoredSymbols casting issue
// Schema updated on 2025-07-03 to fix activePositions casting issue
// Schema updated to add advanced trailing stoploss parameters
const mongoose = require('mongoose');

const TradingStateSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  index: {
    type: String,
    default: 'NIFTY'
  },
  timeframe: {
    type: String,
    default: '5m'
  },
  // Detailed monitored symbols with full configuration
  monitoredSymbols: [{
    id: { type: String },
    symbol: { type: String },
    type: { type: String }, // 'BUY' or 'SELL'
    lots: { type: Number },
    targetPoints: { type: Number },
    stopLossPoints: { type: Number },
    entryMethod: { type: String },
    autoExitOnTarget: { type: Boolean },
    autoExitOnStopLoss: { type: Boolean },
    trailingStopLoss: { type: Boolean },
    trailingStopLossOffset: { type: Number },
    // New advanced trailing stoploss parameters
    useTrailingStoploss: { type: Boolean, default: false },
    trailingX: { type: Number, default: 20 },
    trailingY: { type: Number, default: 15 },
    timeBasedExit: { type: Boolean },
    exitAtMarketClose: { type: Boolean },
    exitAfterMinutes: { type: Number },
    maxReEntries: { type: Number },
    tradingMode: { type: String, default: 'LIVE' }, // 'LIVE' only
    productType: { type: String },
    orderType: { type: String },
    index: {
      name: { type: String },
      lotSize: { type: Number },
      defaultTarget: { type: Number },
      defaultStopLoss: { type: Number }
    },
    hmaValue: { type: Number },
    lastUpdate: { type: Date },
    currentLTP: { type: Number },
    triggerStatus: {
      type: String,
      enum: ['WAITING', 'ORDER_PLACED', 'ORDER_MODIFIED', 'ORDER_REJECTED', 'WAITING_REENTRY', 'TRIGGERED', 'CONFIRMED', 'EXECUTED', 'CANCELLED'],
      default: 'WAITING'
    },
    // Order tracking fields
    orderPlaced: { type: Boolean, default: false },
    orderPlacedAt: { type: Date },
    orderId: { type: String }, // Fyers order ID (BUY order)
    sellOrderId: { type: String }, // SELL order ID
    orderStatus: { type: String }, // PENDING, FILLED, REJECTED, CANCELLED
    lastOrderModification: { type: Date },
    orderModificationCount: { type: Number, default: 0 },
    // Stop loss tracking
    slStopPrice: { type: Number }, // Stop loss price for SELL order
    slTriggerPrice: { type: Number }, // Trigger price for SELL order
    // Re-entry tracking
    reEntryCount: {
      type: Number,
      default: 0
    },
    maxReEntries: { type: Number, default: 0 },
    // Order modification tracking
    lastHmaValue: { type: Number }, // Previous HMA value for comparison
    orderModificationReason: { type: String }, // Reason for order modification
    pendingSignal: {
      direction: { type: String },
      triggeredAt: { type: Date },
      hmaAtTrigger: { type: Number },
      waitStartTime: { type: Date }
    }
  }],
  // Active positions - Fixed schema with proper type definitions
  activePositions: [{
    id: { type: String },
    symbol: { type: String },
    type: { type: String }, // 'BUY' or 'SELL'
    lots: { type: Number },
    quantity: { type: Number }, // Qty = lots * lotSize
    boughtPrice: { type: Number },
    currentPrice: { type: Number },
    target: { type: Number },
    stopLoss: { type: Number },
    initialStopLoss: { type: Number },
    // New advanced trailing stoploss parameters
    useTrailingStoploss: { type: Boolean, default: false },
    trailingX: { type: Number, default: 20 },
    trailingY: { type: Number, default: 15 },
    status: {
      type: String,
      enum: ['Active', 'Pending', 'Target Hit', 'Stop Loss Hit', 'Closed'],
      default: 'Active'
    },
    timestamp: { type: Date },
    tradingMode: { type: String, default: 'LIVE' }, // 'LIVE' only
    orderType: { type: String },
    productType: { type: String },
    // Order tracking
    buyOrderId: { type: String }, // BUY order ID from Fyers
    sellOrderId: { type: String }, // SELL order ID from Fyers
    slOrder: { type: Object }, // SL-M order details
    reEntryCount: { type: Number, default: 0 },
    pnl: { type: Number },
    pnlPercentage: { type: Number },
    hmaValue: { type: Number }, // Current HMA value for monitoring
    slOrderId: { type: String }, // SL-M order ID from Fyers
    slStopPrice: { type: Number }, // Current SL stop price
    slTriggerPrice: { type: Number }, // Current SL trigger price
    // Financial tracking
    invested: { type: Number }, // Qty * bought price
    // Exit tracking
    exitPrice: { type: Number }, // Price when position was closed
    exitTimestamp: { type: Date }, // When position was closed
    exitOrderId: { type: String }, // Order ID for the exit order
    // Modification tracking
    slModifications: [{ // Array of SL modifications
      timestamp: { type: Date },
      oldStopLoss: { type: Number },
      newStopLoss: { type: Number },
      reason: { type: String }, // e.g., "Trailing stop loss update", "Manual modification"
      orderId: { type: String } // Fyers order ID for the modification
    }],
    index: { // Index information for lot size calculation
      name: { type: String },
      lotSize: { type: Number },
      defaultTarget: { type: Number },
      defaultStopLoss: { type: Number }
    }
  }],
  // Trade execution state
  tradeExecutionState: {
    isMonitoring: {
      type: Boolean,
      default: false
    },
    lastMarketDataUpdate: Date,
    lastHMAUpdate: Date,
    monitoringStartTime: Date,
    totalTradesExecuted: {
      type: Number,
      default: 0
    },
    totalPnL: {
      type: Number,
      default: 0
    }
  },
  settings: {
    type: Object,
    default: {}
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  }
});

// Add method to check if the state is from today
TradingStateSchema.methods.isFromToday = function() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const stateDate = new Date(this.lastUpdated);
  stateDate.setHours(0, 0, 0, 0);
  
  return today.getTime() === stateDate.getTime();
};

// Add method to get formatted state
TradingStateSchema.methods.getFormattedState = function() {
  return {
    index: this.index,
    timeframe: this.timeframe,
    monitoredSymbols: this.monitoredSymbols,
    activePositions: this.activePositions,
    tradeExecutionState: this.tradeExecutionState,
    settings: this.settings,
    lastUpdated: this.lastUpdated
  };
};

module.exports = mongoose.model('TradingState', TradingStateSchema);
