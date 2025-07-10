const { MonitoringService } = require('./monitoringService');
const TradingState = require('../models/TradingState');

/**
 * Backend Monitoring Scheduler
 * Automatically runs monitoring cycles for all users
 * This ensures trades execute even when browser is closed
 */
class MonitoringScheduler {
  static monitoringTimer = null;
  static hmaUpdateTimer = null;
  static isRunning = false;

  /**
   * Start the monitoring scheduler
   */
  static start() {
    if (this.isRunning) {
      console.log('🔄 Monitoring scheduler is already running');
      return;
    }

    console.log('🚀 Starting backend monitoring scheduler...');
    this.isRunning = true;

    // Run monitoring cycle every 5 seconds for all users (increased from 2 seconds to reduce race conditions)
    this.monitoringTimer = setInterval(async () => {
      try {
        await this.runMonitoringCycleForAllUsers();
      } catch (error) {
        console.error('❌ Error in monitoring scheduler:', error);
      }
    }, 5000); // 5 seconds - increased from 2 seconds to reduce race conditions

    // Run HMA updates every 5 minutes for all users
    this.hmaUpdateTimer = setInterval(async () => {
      try {
        await this.updateHMAForAllUsers();
      } catch (error) {
        console.error('❌ Error in HMA update scheduler:', error);
      }
    }, 5 * 60 * 1000); // 5 minutes

    console.log('✅ Backend monitoring scheduler started (5-second intervals)');
    console.log('✅ HMA update scheduler started (5-minute intervals)');
  }

  /**
   * Stop the monitoring scheduler
   */
  static stop() {
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
      this.monitoringTimer = null;
    }
    if (this.hmaUpdateTimer) {
      clearInterval(this.hmaUpdateTimer);
      this.hmaUpdateTimer = null;
    }
    this.isRunning = false;
    console.log('🛑 Backend monitoring scheduler stopped');
  }

  /**
   * Update HMA values for all users with active monitoring
   */
  static async updateHMAForAllUsers() {
    try {
      // Find all users with active monitoring
      const activeStates = await TradingState.find({
        'tradeExecutionState.isMonitoring': true
      });

      if (activeStates.length === 0) {
        return; // No active monitoring
      }

      console.log(`📈 Updating HMA values for ${activeStates.length} users`);

      // Update HMA for each user
      for (const state of activeStates) {
        try {
          await MonitoringService.updateHMAValues(state.userId);
          console.log(`✅ Updated HMA for user ${state.userId}`);
        } catch (error) {
          console.error(`❌ Error updating HMA for user ${state.userId}:`, error);
        }
      }

    } catch (error) {
      console.error('❌ Error updating HMA for all users:', error);
    }
  }

  /**
   * Run monitoring cycle for all users with active monitoring
   */
  static async runMonitoringCycleForAllUsers() {
    try {
      // Find all users with active monitoring
      const activeStates = await TradingState.find({
        'tradeExecutionState.isMonitoring': true
      });

      console.log(`🔍 Monitoring scheduler: Found ${activeStates.length} users with active monitoring`);
      
      if (activeStates.length === 0) {
        console.log(`🔍 Monitoring scheduler: No users with active monitoring found`);
        return; // No active monitoring
      }

      console.log(`🔄 Running monitoring cycle for ${activeStates.length} users`);

      // Run monitoring cycle for each user
      for (const state of activeStates) {
        try {
          console.log(`🔄 Executing monitoring cycle for user ${state.userId}`);
          const results = await MonitoringService.executeMonitoringCycle(state.userId);
          
          console.log(`📊 Monitoring cycle results for user ${state.userId}:`, results);
          
          if (results.executed > 0) {
            console.log(`✅ User ${state.userId}: ${results.executed} trades executed`);
          }
          
          if (results.errors.length > 0) {
            console.error(`❌ User ${state.userId}: ${results.errors.length} errors`);
          }
        } catch (error) {
          console.error(`❌ Error in monitoring cycle for user ${state.userId}:`, error);
        }
      }

      // Also update active positions for all users
      await this.updateActivePositionsForAllUsers();

      // Manage WebSocket connections for all users
      await this.manageWebSocketConnectionsForAllUsers();

    } catch (error) {
      console.error('❌ Error in monitoring cycle for all users:', error);
    }
  }

  /**
   * Manage WebSocket connections for all users
   */
  static async manageWebSocketConnectionsForAllUsers() {
    try {
      const { fyersWebSocketService } = require('./fyersWebSocketService');
      
      // Check if WebSocket should be active globally
      const shouldBeActive = await fyersWebSocketService.shouldBeActive();
      const isConnected = fyersWebSocketService.getConnectionStatus().isConnected;
      
      if (shouldBeActive && !isConnected) {
        console.log('🔌 Starting WebSocket - monitoring activity detected');
        await fyersWebSocketService.startConnection();
      } else if (!shouldBeActive && isConnected) {
        console.log('🔌 Stopping WebSocket - no monitoring activity');
        fyersWebSocketService.disconnect();
      }
    } catch (error) {
      console.error('❌ Error managing WebSocket connections:', error);
    }
  }

  /**
   * Update active positions for all users
   */
  static async updateActivePositionsForAllUsers() {
    try {
      const activeStates = await TradingState.find({
        'activePositions.0': { $exists: true } // Has active positions
      });

      for (const state of activeStates) {
        try {
          const results = await MonitoringService.updateActivePositions(state.userId);
          
          if (results.closed > 0) {
            console.log(`🎯 User ${state.userId}: ${results.closed} positions closed`);
          }
        } catch (error) {
          console.error(`❌ Error updating positions for user ${state.userId}:`, error);
        }
      }
    } catch (error) {
      console.error('❌ Error updating active positions for all users:', error);
    }
  }

  /**
   * Get scheduler status
   */
  static getStatus() {
    return {
      isRunning: this.isRunning,
      monitoringInterval: 5000,
      hmaUpdateInterval: 5 * 60 * 1000,
      description: 'Backend monitoring scheduler - runs trade logic every 5 seconds, HMA updates every 5 minutes'
    };
  }
}

module.exports = { MonitoringScheduler }; 