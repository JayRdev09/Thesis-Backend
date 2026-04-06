const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const supabaseService = require('./services/supabaseService');
require('dotenv').config();

// Configuration
const PORT = process.env.PORT || 10000;
const NODE_ENV = process.env.NODE_ENV || 'production';

const app = express();
// 👇 Add this line
app.set('trust proxy', 1);
const server = http.createServer(app);

// ============ HEALTH CHECK ENDPOINT - MUST BE FIRST ============
app.get('/health', (req, res) => {
  // Log the requester for debugging
  console.log(`📡 Health check from: ${req.headers['user-agent'] || 'unknown'}`);
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    port: PORT,
    environment: NODE_ENV,
    uptime: process.uptime()
  });
});

// ============ SOCKET.IO CONFIGURATION - UPDATED ============
const io = socketIo(server, {
  cors: {
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps)
      if (!origin) return callback(null, true);
      
      // IMPORTANT: Add your exact Flutter web origin
      const allowedOrigins = [
        // Production
        'https://tomato-ai-backend-tzfu.onrender.com',
        /^https:\/\/.*\.onrender\.com$/,
        
        // Your CURRENT Flutter web origin (from logs)
        'http://localhost:57721',
        'http://127.0.0.1:57721',
        
        // Common Flutter web ports
        'http://localhost:3000',
        'http://localhost:5000',
        'http://localhost:8000',
        'http://localhost:8080',
        'http://localhost:49603',
        'http://localhost:51000',
        'http://localhost:52000',
        'http://localhost:53000',
        'http://localhost:54000',
        'http://localhost:55000',
        'http://localhost:56000',
        'http://localhost:57000',
        'http://localhost:58000',
        'http://localhost:59000',
        
        // Allow any localhost port
        /^http:\/\/localhost:\d+$/,
        /^http:\/\/127\.0\.0\.1:\d+$/
      ];
      
      console.log('🔍 Incoming origin:', origin); // Debug log
      
      if (allowedOrigins.some(allowed => {
        if (typeof allowed === 'string') {
          return origin === allowed;
        } else if (allowed instanceof RegExp) {
          return allowed.test(origin);
        }
        return false;
      })) {
        console.log('✅ CORS allowed for:', origin);
        callback(null, true);
      } else {
        console.log('🚫 CORS blocked origin:', origin);
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'Origin',
      'X-Requested-With',
      'apikey'
    ]
  },
  transports: ['websocket', 'polling'], // Allow both
  pingTimeout: 60000,
  pingInterval: 25000,
  allowEIO3: true, // Support older clients
  path: '/socket.io/' // Explicit path
});

// Add this debugging middleware BEFORE your routes
app.use((req, res, next) => {
  console.log(`📡 ${req.method} ${req.url} - Origin: ${req.headers.origin}`);
  next();
});

// Store connected users and their rooms
const connectedUsers = new Map();

// Make io available to routes
app.set('io', io);

// ============ MIDDLEWARE ============
// Security middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(compression());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false
});

app.use(limiter);

// CORS configuration - Allow all development origins
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      // Production
      'https://tomato-ai-backend-tzfu.onrender.com',
      /^https:\/\/.*\.onrender\.com$/,
      
      // Flutter Web Development - Localhost
      'http://localhost',
      'http://localhost:8080',
      'http://localhost:3000',
      'http://localhost:5000',
      'http://localhost:8000',
      'http://localhost:49603',
      'http://localhost:51003',
      'http://localhost:52003',
      'http://localhost:53003',
      'http://localhost:54003',
      'http://localhost:55003',
      /^http:\/\/localhost:\d+$/,  // Any localhost port
      
      // Flutter Web Development - 127.0.0.1
      'http://127.0.0.1',
      'http://127.0.0.1:8080',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:5000',
      'http://127.0.0.1:8000',
      'http://127.0.0.1:49603',
      'http://127.0.0.1:51003',
      'http://127.0.0.1:52003',
      'http://127.0.0.1:53003',
      'http://127.0.0.1:54003',
      'http://127.0.0.1:55003',
      /^http:\/\/127\.0\.0\.1:\d+$/,  // Any 127.0.0.1 port
      
      // Common Flutter web ports range
      'http://localhost:51000',
      'http://localhost:51100',
      'http://localhost:51200',
      'http://localhost:51300',
      'http://localhost:51400',
      'http://localhost:51500',
      'http://localhost:51600',
      'http://localhost:51700',
      'http://localhost:51800',
      'http://localhost:51900',
      'http://localhost:52000',
      'http://localhost:52100',
      'http://localhost:52200',
      'http://localhost:52300',
      'http://localhost:52400',
      'http://localhost:52500',
      'http://localhost:52600',
      'http://localhost:52700',
      'http://localhost:52800',
      'http://localhost:52900',
      'http://localhost:53000',
      'http://localhost:53100',
      'http://localhost:53200',
      'http://localhost:53300',
      'http://localhost:53400',
      'http://localhost:53500',
      'http://localhost:53600',
      'http://localhost:53700',
      'http://localhost:53800',
      'http://localhost:53900',
      'http://localhost:54000',
      'http://localhost:54100',
      'http://localhost:54200',
      'http://localhost:54300',
      'http://localhost:54400',
      'http://localhost:54500',
      'http://localhost:54600',
      'http://localhost:54700',
      'http://localhost:54800',
      'http://localhost:54900',
      'http://localhost:55000',
      
      // Same for 127.0.0.1
      'http://127.0.0.1:51000',
      'http://127.0.0.1:51100',
      'http://127.0.0.1:51200',
      'http://127.0.0.1:51300',
      'http://127.0.0.1:51400',
      'http://127.0.0.1:51500',
      'http://127.0.0.1:51600',
      'http://127.0.0.1:51700',
      'http://127.0.0.1:51800',
      'http://127.0.0.1:51900',
      'http://127.0.0.1:52000',
      'http://127.0.0.1:52100',
      'http://127.0.0.1:52200',
      'http://127.0.0.1:52300',
      'http://127.0.0.1:52400',
      'http://127.0.0.1:52500',
      'http://127.0.0.1:52600',
      'http://127.0.0.1:52700',
      'http://127.0.0.1:52800',
      'http://127.0.0.1:52900',
      'http://127.0.0.1:53000',
      'http://127.0.0.1:53100',
      'http://127.0.0.1:53200',
      'http://127.0.0.1:53300',
      'http://127.0.0.1:53400',
      'http://127.0.0.1:53500',
      'http://127.0.0.1:53600',
      'http://127.0.0.1:53700',
      'http://127.0.0.1:53800',
      'http://127.0.0.1:53900',
      'http://127.0.0.1:54000',
      'http://127.0.0.1:54100',
      'http://127.0.0.1:54200',
      'http://127.0.0.1:54300',
      'http://127.0.0.1:54400',
      'http://127.0.0.1:54500',
      'http://127.0.0.1:54600',
      'http://127.0.0.1:54700',
      'http://127.0.0.1:54800',
      'http://127.0.0.1:54900',
      'http://127.0.0.1:55000'
    ];
    
    if (allowedOrigins.some(allowed => {
      if (typeof allowed === 'string') {
        return origin === allowed;
      } else if (allowed instanceof RegExp) {
        return allowed.test(origin);
      }
      return false;
    })) {
      callback(null, true);
    } else {
      console.log('🚫 CORS blocked origin:', origin);
      callback(null, false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'Accept', 
    'Origin', 
    'X-Requested-With',
    'apikey',
    'X-Auth-Token'
  ],
  exposedHeaders: ['Content-Length', 'X-Total-Count'],
  preflightContinue: false,
  optionsSuccessStatus: 204
}));

// Handle preflight requests explicitly
app.options('*', cors());

// Body parsing middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// System activity logger middleware: store request actions in public.system_logs
app.use((req, res, next) => {
  const userId = req.header('x-user-id') || req.query.userId || req.query.user_id || req.body?.userId || req.body?.user_id || null;
  const actionType = `${req.method} ${req.originalUrl}`;
  const moduleSource = req.baseUrl || req.originalUrl || req.path || 'unknown';

  res.on('finish', async () => {
    const statusMessage = `${res.statusCode} ${res.statusMessage || ''}`.trim();

    try {
      await supabaseService.insertSystemLog({
        userId,
        actionType,
        moduleSource,
        statusMessage
      });
    } catch (error) {
      console.error('❌ System log middleware error:', error.message);
    }
  });

  next();
});

// Serve static files if needed
app.use('/temp', express.static(path.join(__dirname, '../temp')));

// ============ SOCKET.IO CONNECTION HANDLING ============
io.on('connection', (socket) => {
  console.log('🔌 New socket client connected:', socket.id);

  // Log all socket events in development
  if (NODE_ENV !== 'production') {
    socket.onAny((eventName, ...args) => {
      console.log(`📡 Socket event [${eventName}] from ${socket.id}:`, args.length > 0 ? args[0] : 'no data');
    });
  }

  // Join user room when they provide userId
  socket.on('join-soil-room', (userId) => {
    if (userId) {
      const roomName = `soil:${userId}`;
      socket.join(roomName);
      connectedUsers.set(socket.id, { userId, roomName });
      console.log(`👤 User ${userId} joined soil room: ${roomName}, socket: ${socket.id}`);
      
      socket.emit('room-joined', { 
        success: true, 
        room: roomName,
        userId: userId,
        socketId: socket.id 
      });
    } else {
      socket.emit('room-error', { error: 'User ID is required' });
    }
  });

  // Handle manual soil data update request
  socket.on('request-soil-update', async (data) => {
    try {
      const { userId } = data;
      
      if (!userId) {
        socket.emit('soil-update-error', { error: 'User ID is required' });
        return;
      }

      console.log(`📡 Soil update requested by user ${userId}`);
      
      const storageService = require('./services/storageService');
      
      const soilData = await storageService.getLatestSoilData(userId);
      
      if (!soilData) {
        socket.emit('soil-status-update', {
          success: true,
          data_status: 'no_data',
          message: 'No soil data available.',
          user_id: userId,
          timestamp: new Date().toISOString()
        });
        return;
      }

      const now = new Date();
      const soilTime = new Date(soilData.date_gathered);
      const dataAgeHours = (now - soilTime) / (1000 * 60 * 60);
      
      let dataFreshness = 'unknown';
      let dataStatus = 'fresh';
      
      if (dataAgeHours <= 1) {
        dataFreshness = 'very_fresh';
        dataStatus = 'fresh';
      } else if (dataAgeHours <= 6) {
        dataFreshness = 'fresh';
        dataStatus = 'fresh';
      } else if (dataAgeHours <= 24) {
        dataFreshness = 'acceptable';
        dataStatus = 'fresh';
      } else {
        dataFreshness = 'stale';
        dataStatus = 'stale';
      }

      const enhancedStatus = {
        success: true,
        npk_levels: {
          nitrogen: `${soilData.nitrogen || 0}mg/kg`,
          phosphorus: `${soilData.phosphorus || 0}mg/kg`,
          potassium: `${soilData.potassium || 0}mg/kg`
        },
        other_parameters: {
          ph: `${(soilData.ph_level || soilData.ph || 0).toFixed(1)} pH`,
          moisture: `${soilData.moisture || 0}%`,
          temperature: `${soilData.temperature || 0}°C`
        },
        data_status: dataStatus,
        data_age_hours: parseFloat(dataAgeHours.toFixed(1)),
        data_freshness: dataFreshness,
        last_updated: soilData.date_gathered,
        can_analyze: dataStatus === 'fresh',
        message: dataStatus === 'fresh' ? 
          'Soil data is current and ready for analysis' :
          `Soil data is ${dataAgeHours.toFixed(1)} hours old.`,
        user_id: userId,
        timestamp: new Date().toISOString()
      };

      socket.emit('soil-status-update', enhancedStatus);
      
      console.log(`📤 Soil update sent to user ${userId}`);
      
    } catch (error) {
      console.error('❌ Error handling soil update request:', error);
      socket.emit('soil-update-error', { error: error.message });
    }
  });

  // Handle new soil data from sensors
  socket.on('soil-data-update', async (data) => {
    try {
      const { userId, soilData } = data;
      
      if (!userId || !soilData) {
        socket.emit('soil-update-error', { error: 'User ID and soil data are required' });
        return;
      }

      console.log(`📡 New soil data received from user ${userId}:`, soilData);
      
      const storageService = require('./services/storageService');
      
      const storedData = await storageService.storeSoilData(userId, soilData);
      
      const now = new Date();
      const enhancedStatus = {
        success: true,
        npk_levels: {
          nitrogen: `${storedData.nitrogen || 0}mg/kg`,
          phosphorus: `${storedData.phosphorus || 0}mg/kg`,
          potassium: `${storedData.potassium || 0}mg/kg`
        },
        other_parameters: {
          ph: `${(storedData.ph_level || storedData.ph || 0).toFixed(1)} pH`,
          moisture: `${storedData.moisture || 0}%`,
          temperature: `${storedData.temperature || 0}°C`
        },
        data_status: 'fresh',
        data_age_hours: 0,
        data_freshness: 'very_fresh',
        last_updated: storedData.date_gathered,
        can_analyze: true,
        message: 'Fresh soil data received and stored',
        user_id: userId,
        timestamp: new Date().toISOString()
      };

      io.to(`soil:${userId}`).emit('soil-status-update', enhancedStatus);
      
      console.log(`📤 Soil update broadcasted to room soil:${userId}`);
      
    } catch (error) {
      console.error('❌ Error broadcasting soil update:', error);
      socket.emit('soil-update-error', { error: error.message });
    }
  });

  // Handle ping/pong for connection health
  socket.on('ping', (data) => {
    socket.emit('pong', { 
      timestamp: new Date().toISOString(),
      serverTime: Date.now(),
      ...data 
    });
  });

  // Get connection info
  socket.on('get-connection-info', () => {
    const userInfo = connectedUsers.get(socket.id);
    socket.emit('connection-info', {
      socketId: socket.id,
      userId: userInfo?.userId || null,
      room: userInfo?.roomName || null,
      connectedUsers: connectedUsers.size,
      timestamp: new Date().toISOString()
    });
  });

  // Handle disconnection
  socket.on('disconnect', (reason) => {
    const userInfo = connectedUsers.get(socket.id);
    if (userInfo) {
      console.log(`👋 User ${userInfo.userId} disconnected, socket: ${socket.id}, reason: ${reason}`);
      connectedUsers.delete(socket.id);
    } else {
      console.log(`🔌 Client disconnected: ${socket.id}, reason: ${reason}`);
    }
  });

  // Handle errors
  socket.on('error', (error) => {
    console.error('❌ Socket error:', error);
  });
});

// ============ ROUTES ============
// Import routes
const healthRoutes = require('./routes/health');
const soilRoutes = require('./routes/soil');
const analysisRoutes = require('./routes/analysis');
const imageRoutes = require('./routes/images');
const authRoutes = require('./routes/auth');
const soilTypeRoutes = require('./routes/soiltype');
const plantsRoutes = require('./routes/plants');
const growthRoutes = require('./routes/growth');
const ageAnalysisRoutes = require('./routes/age-analysis');
const harvestScheduleRoutes = require('./routes/harvest-schedule');

// Use routes
app.use('/api/health', healthRoutes);
app.use('/api/soil', soilRoutes);
app.use('/api/analysis', analysisRoutes);
app.use('/api/images', imageRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/soiltype', soilTypeRoutes);
app.use('/api/plants', plantsRoutes);
app.use('/api/growth', growthRoutes);
app.use('/api/age-analysis', ageAnalysisRoutes);
app.use('/api/harvest-schedule', harvestScheduleRoutes);

// ============ ADDITIONAL ENDPOINTS ============
// Socket.IO connection test endpoint
app.get('/api/socket-test', (req, res) => {
  res.json({
    success: true,
    message: 'Socket.IO server is running',
    socketEnabled: true,
    connectedUsers: connectedUsers.size,
    socketUrl: `wss://${req.get('host')}`,
    apiUrl: `https://${req.get('host')}`,
    timestamp: new Date().toISOString()
  });
});

// Socket.IO status endpoint
app.get('/api/socket-status', (req, res) => {
  if (req.query.secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  
  const rooms = io.sockets.adapter.rooms;
  const soilRooms = [];
  
  rooms.forEach((sockets, roomName) => {
    if (roomName.startsWith('soil:')) {
      const userId = roomName.replace('soil:', '');
      soilRooms.push({
        userId: userId,
        socketCount: sockets.size,
        roomName: roomName,
        sockets: Array.from(sockets)
      });
    }
  });

  res.json({
    success: true,
    socketServer: 'running',
    serverPort: PORT,
    totalConnections: io.engine.clientsCount,
    connectedUsers: connectedUsers.size,
    soilRooms: soilRooms.length,
    rooms: soilRooms,
    environment: NODE_ENV,
    timestamp: new Date().toISOString()
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Tomato AI Backend API with Supabase & Socket.IO',
    version: '3.0.0',
    environment: NODE_ENV,
    server: {
      url: `https://${req.get('host')}`
    },
    storage: 'Supabase Storage + Database',
    auth: 'Supabase Auth',
    realtime: 'Socket.IO Enabled',
    endpoints: {
      health: '/health',
      api_health: '/api/health',
      soil: '/api/soil',
      analysis: '/api/analysis',
      images: '/api/images',
      auth: '/api/auth',
      socket_test: '/api/socket-test'
    },
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `API endpoint not found: ${req.method} ${req.path}`,
    timestamp: new Date().toISOString()
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('❌ Server error:', error);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: NODE_ENV === 'development' ? error.message : undefined,
    timestamp: new Date().toISOString()
  });
});

// ============ START SERVER ============
// CRITICAL: Bind to '0.0.0.0' for Render
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Tomato AI Backend with Supabase & Socket.IO`);
  console.log(`=============================================`);
  console.log(`📡 Environment: ${NODE_ENV}`);
  console.log(`📡 Server running on PORT: ${PORT}`);
  console.log(`📍 Binding to: 0.0.0.0:${PORT}`);
  console.log(`📍 Production URL: https://tomato-ai-backend-tzfu.onrender.com`);
  console.log(`📍 CORS enabled for localhost and Flutter web development`);
  console.log(`=============================================`);
});

// ============ BACKGROUND SERVICES ============
// Database change listener
const setupDatabaseChangeListener = async () => {
  try {
    console.log('🔍 Setting up database change listener...');
    
    const storageService = require('./services/storageService');
    const supabase = storageService.client;
    
    if (!supabase) {
      console.warn('⚠️ Supabase client not available for change listening');
      return;
    }

    const soilDataSubscription = supabase
      .channel('soil-data-changes')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'soil_data',
        },
        async (payload) => {
          try {
            console.log('📊 Database change detected (INSERT):', {
              soil_id: payload.new.soil_id,
              user_id: payload.new.user_id
            });

            const userId = payload.new.user_id;
            
            const { data: fullSoilData, error } = await supabase
              .from('soil_data')
              .select('*')
              .eq('soil_id', payload.new.soil_id)
              .single();

            if (error) {
              console.error('❌ Error fetching complete soil data:', error);
              return;
            }

            const now = new Date();
            const soilTime = new Date(fullSoilData.date_gathered);
            const dataAgeHours = (now - soilTime) / (1000 * 60 * 60);
            
            let dataFreshness = 'stale';
            let dataStatus = 'stale';
            
            if (dataAgeHours <= 1) {
              dataFreshness = 'very_fresh';
              dataStatus = 'fresh';
            } else if (dataAgeHours <= 6) {
              dataFreshness = 'fresh';
              dataStatus = 'fresh';
            } else if (dataAgeHours <= 24) {
              dataFreshness = 'acceptable';
              dataStatus = 'fresh';
            }

            const enhancedStatus = {
              success: true,
              npk_levels: {
                nitrogen: `${fullSoilData.nitrogen || 0}mg/kg`,
                phosphorus: `${fullSoilData.phosphorus || 0}mg/kg`,
                potassium: `${fullSoilData.potassium || 0}mg/kg`
              },
              other_parameters: {
                ph: `${(fullSoilData.ph_level || fullSoilData.ph || 0).toFixed(1)} pH`,
                moisture: `${fullSoilData.moisture || 0}%`,
                temperature: `${fullSoilData.temperature || 0}°C`
              },
              data_status: dataStatus,
              data_age_hours: parseFloat(dataAgeHours.toFixed(1)),
              data_freshness: dataFreshness,
              last_updated: fullSoilData.date_gathered,
              can_analyze: dataStatus === 'fresh',
              message: dataStatus === 'fresh' 
                ? 'Fresh soil data received from sensors!' 
                : `Soil data is ${dataAgeHours.toFixed(1)} hours old.`,
              user_id: userId,
              timestamp: new Date().toISOString(),
              source: 'sensor-auto-update'
            };

            io.to(`soil:${userId}`).emit('soil-status-update', enhancedStatus);
            
            console.log(`📤 Auto-emitted soil update to user ${userId}`);

          } catch (error) {
            console.error('❌ Error processing database change:', error);
          }
        }
      )
      .subscribe((status) => {
        console.log('📡 Database change listener status:', status);
      });

    console.log('✅ Database change listener setup complete');
    
    process.on('SIGINT', () => {
      console.log('🔌 Cleaning up database subscriptions...');
      supabase.removeChannel(soilDataSubscription);
      process.exit(0);
    });

  } catch (error) {
    console.error('❌ Failed to setup database change listener:', error);
  }
};

// Setup background services
setupDatabaseChangeListener();
