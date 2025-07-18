const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const http = require('http');
const socketIo = require('socket.io');
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.join(__dirname, '.env') });

// Import logger service
const LoggerService = require('./services/loggerService');

// Show logging configuration
LoggerService.showConfig();

// Debug: Check if environment variables are loaded
LoggerService.info('Server', 'Environment check:');
LoggerService.info('Server', `  MONGODB_URI: ${process.env.MONGODB_URI ? 'SET' : 'NOT SET'}`);
LoggerService.info('Server', `  JWT_SECRET: ${process.env.JWT_SECRET ? 'SET' : 'NOT SET'}`);
LoggerService.info('Server', `  NODE_ENV: ${process.env.NODE_ENV || 'development'}`);

const { corsMiddleware, handlePreflight } = require('./middleware/cors');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const fyersRoutes = require('./routes/fyers');
const marketRoutes = require('./routes/market');
const hmaRoutes = require('./routes/hma');
const tradeRoutes = require('./routes/trade');
const notificationRoutes = require('./routes/notifications');
const monitoringRoutes = require('./routes/monitoring');
const signalTableRoutes = require('./routes/signalTable');
const backtestRoutes = require('./routes/backtest');
const { router: symbolConfigRoutes } = require('./routes/symbolConfig');
const { fyersWebSocketService } = require('./services/fyersWebSocketService');
const { WebSocketService } = require('./services/websocketService');
const { MarketService } = require('./services/marketService');
const { MonitoringScheduler } = require('./services/monitoringScheduler');

const app = express();
const PORT = process.env.PORT || 5000;
const isDevelopment = process.env.NODE_ENV !== 'production';

// Apply CORS middleware first - before any other middleware
app.use(corsMiddleware);
app.use(handlePreflight);

// Security middleware with settings compatible with CORS
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false
}));

// Rate limiting - only apply in production mode
if (!isDevelopment) {
  // Production rate limiting
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 50000 // limit each IP to 50,000 requests per windowMs
  });
  app.use(limiter);
} else {
  // In development mode, completely disable rate limiting
  LoggerService.warn('Server', 'Running in development mode with NO rate limiting');
}

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// MongoDB Connection with timeout
const connectDB = async () => {
  const mongoURI = process.env.MONGODB_URI;
  if (!mongoURI) {
    LoggerService.error('Server', 'MONGODB_URI is not set in environment variables. Exiting.');
    process.exit(1);
  }
  try {
    LoggerService.info('Server', 'Attempting to connect to MongoDB...');
    LoggerService.debug('Server', `Connection URI: ${mongoURI}`);
    LoggerService.debug('Server', `Environment: ${process.env.NODE_ENV || 'development'}`);

    // Set connection timeout
    const connectionPromise = mongoose.connect(mongoURI, {
      serverSelectionTimeoutMS: 10000, // 10 second timeout
      socketTimeoutMS: 10000,
      connectTimeoutMS: 10000,
      maxPoolSize: 10,
      minPoolSize: 1,
    });

    // Add timeout to the connection
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout after 10 seconds')), 10000);
    });

    await Promise.race([connectionPromise, timeoutPromise]);
    LoggerService.success('Server', 'MongoDB connected successfully');
    LoggerService.info('Server', `Database: ${mongoose.connection.db.databaseName}`);
    LoggerService.info('Server', `Connection state: ${mongoose.connection.readyState}`);
  } catch (error) {
    LoggerService.error('Server', 'MongoDB connection failed');
    LoggerService.error('Server', `Error details: ${error.message}`);
    LoggerService.error('Server', `Error code: ${error.code || 'N/A'}`);
    LoggerService.error('Server', `Error name: ${error.name || 'N/A'}`);
    process.exit(1);
  }
};

// Health check endpoint
app.get('/api/health', (req, res) => {
  const now = new Date();
  const istTime = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  
  res.json({
    status: 'healthy',
    timestamp: istTime.toISOString(),
    istTime: istTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
    environment: process.env.NODE_ENV || 'development',
    dbConnected: mongoose.connection.readyState === 1,
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

// Ping endpoint to wake up inactive server
app.get('/api/ping', (req, res) => {
  const now = new Date();
  const istTime = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  
  LoggerService.info('Server', `Ping request received at ${istTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
  
  res.json({
    status: 'pong',
    timestamp: istTime.toISOString(),
    istTime: istTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
    message: 'Server is awake and responding'
  });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/fyers', fyersRoutes);
app.use('/api/market', marketRoutes);
app.use('/api/hma', hmaRoutes);
app.use('/api/trade', tradeRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/monitoring', monitoringRoutes);
app.use('/api/signal-table', signalTableRoutes);
app.use('/api/backtest', backtestRoutes);
app.use('/api/market', symbolConfigRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  LoggerService.error('Server', 'Unhandled error:', err);
  res.status(500).json({ 
    error: 'Something went wrong!',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: '*' } });

// Initialize WebSocket service
WebSocketService.initialize(server);

// Initialize Fyers WebSocket service
fyersWebSocketService.initialize(io);

// Start market data polling
MarketService.startMarketDataPolling();

// Start monitoring scheduler
MonitoringScheduler.start();

// Temporary manual fix for monitoring state
setTimeout(async () => {
  try {
    const { manualFix } = require('./manual-fix');
    await manualFix();
  } catch (error) {
    console.error('Error in manual fix:', error);
  }
}, 5000); // Run after 5 seconds

// WebSocket will be managed by monitoring service - no automatic periodic checks

// Start server
const startServer = async () => {
  await connectDB();

  // Start socket.io server
  server.listen(PORT, () => {
      LoggerService.success('Server', `Victory Trading API server running on port ${PORT}`);
  LoggerService.info('Server', `Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log('✅ Server started successfully');
  console.log('📊 Market polling: 1 second intervals');
  console.log('🔌 WebSocket: Order updates only');
  });

  // Fyers WebSocket will be managed by monitoring service
  LoggerService.info('Server', 'Fyers WebSocket service initialized - will start only when monitoring begins or active positions exist');
};

// Graceful shutdown
const gracefulShutdown = () => {
  LoggerService.info('Server', 'Shutting down gracefully...');
  
  // Stop WebSocket services
  const { WebSocketService } = require('./services/websocketService');
  const wsService = WebSocketService.getInstance();
  if (wsService) {
    wsService.cleanup();
  }
  
  // Stop Fyers WebSocket service
  const { fyersWebSocketService } = require('./services/fyersWebSocketService');
  fyersWebSocketService.disconnect();
  
  // Stop market data polling
  const { MarketService } = require('./services/marketService');
  if (MarketService && MarketService.stopMarketDataPolling) {
    MarketService.stopMarketDataPolling();
  }

  // Stop monitoring scheduler
  const { MonitoringScheduler } = require('./services/monitoringScheduler');
  if (MonitoringScheduler) {
    MonitoringScheduler.stop();
  }
  
  // Close MongoDB connection
  if (mongoose.connection.readyState === 1) {
    mongoose.connection.close(() => {
      LoggerService.info('Server', 'MongoDB connection closed');
    });
  }
  
  // Close server
  server.close(() => {
    LoggerService.info('Server', 'Server closed');
    process.exit(0);
  });
  
  // Force exit after timeout
  setTimeout(() => {
    LoggerService.error('Server', 'Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
};

// Handle process termination
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
process.on('uncaughtException', (error) => {
  LoggerService.error('Server', 'Uncaught Exception:', error);
  gracefulShutdown();
});

startServer(); 