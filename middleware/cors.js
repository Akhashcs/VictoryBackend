const cors = require('cors');

// Custom CORS middleware with more permissive settings
const corsMiddleware = cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, curl requests)
    if (!origin) {
      return callback(null, true);
    }
    
    // Allow all origins in development and your deployed frontend
    const allowedOrigins = [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'https://victor-client.vercel.app',
      'https://victory-client-lac.vercel.app' // <-- your Vercel frontend
    ];
    if (allowedOrigins.indexOf(origin) !== -1 || !origin) {
      // Only log occasionally to reduce noise (every 100th request)
      if (Math.random() < 0.01) {
        console.log('[CORS] Allowed:', origin);
      }
      callback(null, true);
    } else {
      console.log('[CORS] Denied:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Origin', 'Accept'],
  exposedHeaders: ['Content-Length', 'X-Requested-With'],
  maxAge: 86400 // 24 hours
});

// Handle preflight requests
const handlePreflight = (req, res, next) => {
  // Set CORS headers manually for preflight OPTIONS requests
  if (req.method === 'OPTIONS') {
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Origin, Accept');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Max-Age', '86400');
    return res.status(200).end();
  }
  return next();
};

module.exports = { corsMiddleware, handlePreflight }; 