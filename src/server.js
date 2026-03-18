const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
require('dotenv').config();

// Configuration
const PORT = process.env.PORT || 10000;
const NODE_ENV = process.env.NODE_ENV || 'production';

const app = express();
const server = http.createServer(app);

// ============ HEALTH CHECK ENDPOINT - MUST BE FIRST ============
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    port: PORT,
    environment: NODE_ENV,
    uptime: process.uptime()
  });
});

// ============ SOCKET.IO CONFIGURATION ============
const io = socketIo(server, {
  cors: {
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps)
      if (!origin) return callback(null, true);
      
      // Production-only allowed origins
      const allowedOrigins = [
        'https://tomato-ai-backend-tzfu.onrender.com',
        /^https:\/\/.*\.onrender\.com$/,
        // Add your Flutter app's production domain here when available
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
        console.log('🚫 Socket.IO CORS blocked origin:', origin);
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ["GET", "POST"]
  },
  transports: ['websocket', 'polling']
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
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // limit each IP to 200 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use(limiter);

// CORS configuration - Production only
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      'https://tomato-ai-backend-tzfu.onrender.com',
      /^https:\/\/.*\.onrender\.com$/
      // Add your Flutter app's production domain here when available
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
    'apikey'
  ]
}));

// Handle preflight requests
app.options('*', cors());

// Body parsing middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static files if needed
app.use('/temp', express.static(path.join(__dirname, '../temp')));

// ============ SOCKET.IO CONNECTION HANDLING ============
io.on('connection', (socket) => {
  console.log('🔌 New socket client connected:', socket.id);

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
