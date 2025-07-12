const fs = require('fs').promises;
const path = require('path');

class MaintenanceService {
  static MAINTENANCE_START_HOUR = 5; // 5 AM
  static MAINTENANCE_END_HOUR = 8;   // 8 AM
  static DAILY_RESET_FILE = path.join(__dirname, 'data', 'daily_reset.json');

  // Check if we're in the maintenance window (5-8 AM IST)
  static isInMaintenanceWindow() {
    const now = new Date();
    const istTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const hour = istTime.getHours();
    
    return hour >= this.MAINTENANCE_START_HOUR && hour < this.MAINTENANCE_END_HOUR;
  }

  // Check if it's after 8 AM (maintenance window ended)
  static isAfterMaintenanceWindow() {
    const now = new Date();
    const istTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const hour = istTime.getHours();
    
    return hour >= this.MAINTENANCE_END_HOUR;
  }

  // Get current IST time
  static getCurrentISTTime() {
    const now = new Date();
    return new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  }

  // Check if we need to force re-authentication (first server run after 8 AM)
  static async shouldForceReAuth() {
    try {
      const today = this.getCurrentISTTime().toDateString();
      
      // Ensure data directory exists
      const dataDir = path.dirname(this.DAILY_RESET_FILE);
      try {
        await fs.access(dataDir);
      } catch {
        await fs.mkdir(dataDir, { recursive: true });
      }

      // Check if we've already reset today
      let resetData = {};
      try {
        const data = await fs.readFile(this.DAILY_RESET_FILE, 'utf8');
        resetData = JSON.parse(data);
      } catch {
        // File doesn't exist or is invalid, create new
        resetData = {};
      }

      // If we haven't reset today and it's after 8 AM, we need to force re-auth
      if (resetData.lastResetDate !== today && this.isAfterMaintenanceWindow()) {
        return true;
      }

      return false;
    } catch (error) {
      console.error('Error checking force re-auth status:', error);
      return false;
    }
  }

  // Mark that we've done the daily reset
  static async markDailyReset() {
    try {
      const today = this.getCurrentISTTime().toDateString();
      const resetData = {
        lastResetDate: today,
        resetTime: this.getCurrentISTTime().toISOString()
      };

      // Ensure data directory exists
      const dataDir = path.dirname(this.DAILY_RESET_FILE);
      try {
        await fs.access(dataDir);
      } catch {
        await fs.mkdir(dataDir, { recursive: true });
      }

      await fs.writeFile(this.DAILY_RESET_FILE, JSON.stringify(resetData, null, 2));
      console.log(`✅ Daily reset marked for ${today}`);
    } catch (error) {
      console.error('Error marking daily reset:', error);
    }
  }

  // Get maintenance window info
  static getMaintenanceInfo() {
    const now = this.getCurrentISTTime();
    const hour = now.getHours();
    const minutes = now.getMinutes();
    
    if (this.isInMaintenanceWindow()) {
      // Calculate time until maintenance ends
      const endTime = new Date(now);
      endTime.setHours(this.MAINTENANCE_END_HOUR, 0, 0, 0);
      
      const timeUntilEnd = endTime - now;
      const hoursUntilEnd = Math.floor(timeUntilEnd / (1000 * 60 * 60));
      const minutesUntilEnd = Math.floor((timeUntilEnd % (1000 * 60 * 60)) / (1000 * 60));
      
      return {
        inMaintenance: true,
        timeUntilEnd: `${hoursUntilEnd}h ${minutesUntilEnd}m`,
        endTime: endTime.toLocaleTimeString('en-IN', { 
          timeZone: 'Asia/Kolkata',
          hour: '2-digit',
          minute: '2-digit'
        })
      };
    } else if (hour < this.MAINTENANCE_START_HOUR) {
      // Calculate time until maintenance starts
      const startTime = new Date(now);
      startTime.setHours(this.MAINTENANCE_START_HOUR, 0, 0, 0);
      
      const timeUntilStart = startTime - now;
      const hoursUntilStart = Math.floor(timeUntilStart / (1000 * 60 * 60));
      const minutesUntilStart = Math.floor((timeUntilStart % (1000 * 60 * 60)) / (1000 * 60));
      
      return {
        inMaintenance: false,
        timeUntilStart: `${hoursUntilStart}h ${minutesUntilStart}m`,
        startTime: startTime.toLocaleTimeString('en-IN', { 
          timeZone: 'Asia/Kolkata',
          hour: '2-digit',
          minute: '2-digit'
        })
      };
    } else {
      return {
        inMaintenance: false,
        nextMaintenance: 'Tomorrow 5:00 AM'
      };
    }
  }
}

module.exports = MaintenanceService; 