const express = require('express');
const router = express.Router();
const storageService = require('../services/storageService');
const SocketEmitter = require('../services/socketEmitter');

// Middleware to validate userId
const validateUserId = (req, res, next) => {
  const userId = req.body.userId || req.query.userId;
  
  if (!userId) {
    return res.status(400).json({
      success: false,
      message: 'User ID is required'
    });
  }
  
  next();
};

// Enhanced soil status endpoint - with socket support
router.get('/status', validateUserId, async (req, res) => {
  try {
    const userId = req.query.userId;
    const io = req.app.get('io'); // Get io instance from app
    const socketEmitter = new SocketEmitter(io);
    
    console.log('📊 Fetching enhanced soil status for user:', userId);
    const soilData = await storageService.getLatestSoilData(userId);

    const now = new Date();
    let dataStatus = 'no_data';
    let dataAgeHours = null;
    let dataFreshness = 'unknown';

    if (soilData && soilData.date_gathered) {
      const soilTime = new Date(soilData.date_gathered);
      dataAgeHours = (now - soilTime) / (1000 * 60 * 60);
      
      // Determine freshness
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
    }

    if (!soilData) {
      console.log('No soil data found for user:', userId, 'returning enhanced defaults');
      
      // If socket is available, emit no-data status
      if (socketEmitter) {
        socketEmitter.emitSoilUpdate(userId, {
          date_gathered: new Date().toISOString(),
          nitrogen: 0,
          phosphorus: 0,
          potassium: 0,
          ph: 0,
          moisture: 0,
          temperature: 0
        });
      }
      
      return res.json({
        success: true,
        npk_levels: {
          nitrogen: '0.0 mg/kg',
          phosphorus: '0.0 mg/kg', 
          potassium: '0.0 mg/kg'
        },
        other_parameters: {
          ph: '0.0 pH',
          moisture: '0.0%',
          temperature: '0.0°C'
        },
        data_status: 'no_data',
        data_age_hours: null,
        data_freshness: 'no_data',
        last_updated: null,
        can_analyze: false,
        message: 'No soil data available.',
        user_id: userId
      });
    }

    console.log('Enhanced soil data found for user:', userId, {
      data_status: dataStatus,
      age_hours: dataAgeHours?.toFixed(1),
      freshness: dataFreshness
    });
    
    const responseData = {
      success: true,
      npk_levels: {
        nitrogen: `${soilData.nitrogen || 0}mg/kg`,
        phosphorus: `${soilData.phosphorus || 0}mg/kg`,
        potassium: `${soilData.potassium || 0}mg/kg`
      },
      other_parameters: {
        ph: `${(soilData.ph_level || soilData.ph || 0).toFixed(1)} pH`,
        moisture: `${soilData.moisture || soilData.moisture || 0}%`,
        temperature: `${soilData.temperature || 0}°C`
      },
      data_status: dataStatus,
      data_age_hours: dataAgeHours ? parseFloat(dataAgeHours.toFixed(1)) : null,
      data_freshness: dataFreshness,
      last_updated: soilData.date_gathered || soilData.timestamp,
      can_analyze: dataStatus === 'fresh',
      message: dataStatus === 'fresh' ? 
        'Soil data is current and ready for analysis' :
        dataStatus === 'stale' ? 
          `Soil data is ${dataAgeHours?.toFixed(1)} hours old.` :
          'No soil data available',
      user_id: userId
    };

    // If socket is available, emit update
    if (socketEmitter) {
      socketEmitter.emitSoilUpdate(userId, soilData);
    }
    
    res.json(responseData);
  } catch (error) {
    console.error('❌ Error fetching enhanced soil status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch soil status: ' + error.message
    });
  }
});

// Store soil data with socket broadcast
// In routes/soil.js, update the store endpoint:
router.post('/store', validateUserId, async (req, res) => {
  try {
    const userId = req.body.userId;
    const soilData = req.body.soilData;
    const io = req.app.get('io');
    
    if (!soilData) {
      return res.status(400).json({
        success: false,
        message: 'Soil data is required'
      });
    }

    console.log('🌱 Storing soil data for user:', userId, soilData);
    
    // Store in database
    const storedData = await storageService.storeSoilData(userId, soilData);
    
    // Calculate freshness immediately (since it's fresh data)
    const now = new Date();
    const soilTime = new Date(storedData.date_gathered);
    const dataAgeHours = (now - soilTime) / (1000 * 60 * 60);
    
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
      timestamp: new Date().toISOString(),
      source: 'direct-store'
    };

    // ALWAYS emit via socket (even if no socket emitter instance)
    if (io) {
      io.to(`soil:${userId}`).emit('soil-status-update', enhancedStatus);
      console.log(`📤 Socket update emitted for user ${userId}`);
    }
    
    res.json({
      success: true,
      message: 'Soil data stored successfully',
      data: storedData,
      socket_broadcast: io ? 'sent' : 'not_available'
    });
    
  } catch (error) {
    console.error('❌ Error storing soil data:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to store soil data: ' + error.message
    });
  }
});

// Push soil update via socket (manual trigger)
router.post('/push-update', validateUserId, async (req, res) => {
  try {
    const userId = req.body.userId;
    const io = req.app.get('io');
    
    if (!io) {
      return res.status(500).json({
        success: false,
        message: 'Socket server not available'
      });
    }

    console.log(`📤 Manual soil update push requested for user ${userId}`);
    
    const soilData = await storageService.getLatestSoilData(userId);
    
    if (!soilData) {
      return res.json({
        success: false,
        message: 'No soil data found for user'
      });
    }

    // Calculate freshness
    const now = new Date();
    const soilTime = new Date(soilData.date_gathered);
    const dataAgeHours = (now - soilTime) / (1000 * 60 * 60);
    
    const enhancedStatus = {
      success: true,
      npk_levels: {
        nitrogen: `${soilData.nitrogen || 0}mg/kg`,
        phosphorus: `${soilData.phosphorus || 0}mg/kg`,
        potassium: `${soilData.potassium || 0}mg/kg`
      },
      other_parameters: {
        ph: `${(soilData.ph_level || soilData.ph || 0).toFixed(1)} pH`,
        moisture: `${soilData.moisture || soilData.moisture || 0}%`,
        temperature: `${soilData.temperature || 0}°C`
      },
      data_status: dataAgeHours <= 24 ? 'fresh' : 'stale',
      data_age_hours: parseFloat(dataAgeHours.toFixed(1)),
      data_freshness: dataAgeHours <= 1 ? 'very_fresh' : 
                    dataAgeHours <= 6 ? 'fresh' : 
                    dataAgeHours <= 24 ? 'acceptable' : 'stale',
      last_updated: soilData.date_gathered,
      can_analyze: dataAgeHours <= 24,
      message: dataAgeHours <= 24 ? 
        'Soil data is current and ready for analysis' :
        `Soil data is ${dataAgeHours.toFixed(1)} hours old.`,
      user_id: userId,
      timestamp: new Date().toISOString(),
      source: 'manual-push'
    };

    // Emit via socket
    io.to(`soil:${userId}`).emit('soil-status-update', enhancedStatus);
    
    console.log(`📤 Manual push update sent to user ${userId}`);
    
    res.json({
      success: true,
      message: 'Soil update pushed successfully via socket',
      data: enhancedStatus
    });
    
  } catch (error) {
    console.error('❌ Error pushing soil update:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to push soil update: ' + error.message
    });
  }
});

// Get soil data history
router.get('/history', validateUserId, async (req, res) => {
  try {
    const userId = req.query.userId;
    const limit = parseInt(req.query.limit) || 10;
    
    console.log('📚 Fetching soil data history for user:', userId, 'limit:', limit);
    
    const analysisHistory = await storageService.getAnalysisHistory(userId, limit);
    
    const soilHistory = analysisHistory
      .filter(analysis => analysis.soil_data)
      .map(analysis => ({
        soil_id: analysis.soil_id,
        ...analysis.soil_data,
        date_gathered: analysis.soil_data.date_gathered,
        analysis_date: analysis.date_predicted
      }));

    res.json({
      success: true,
      soil_history: soilHistory,
      count: soilHistory.length,
      user_id: userId
    });
  } catch (error) {
    console.error('❌ Error fetching soil history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch soil history: ' + error.message
    });
  }
});

// Get soil statistics
router.get('/stats', validateUserId, async (req, res) => {
  try {
    const userId = req.query.userId;
    
    console.log('📈 Fetching soil statistics for user:', userId);
    
    const soilData = await storageService.getLatestSoilData(userId);
    const analysisHistory = await storageService.getAnalysisHistory(userId, 50);
    
    const soilEntries = analysisHistory
      .filter(analysis => analysis.soil_data)
      .map(analysis => analysis.soil_data);

    const stats = {
      total_entries: soilEntries.length,
      average_nitrogen: 0,
      average_phosphorus: 0,
      average_potassium: 0,
      average_ph: 0,
      average_temperature: 0,
      average_moisture: 0
    };

    if (soilEntries.length > 0) {
      stats.average_nitrogen = (soilEntries.reduce((sum, entry) => sum + (entry.nitrogen || 0), 0) / soilEntries.length).toFixed(2);
      stats.average_phosphorus = (soilEntries.reduce((sum, entry) => sum + (entry.phosphorus || 0), 0) / soilEntries.length).toFixed(2);
      stats.average_potassium = (soilEntries.reduce((sum, entry) => sum + (entry.potassium || 0), 0) / soilEntries.length).toFixed(2);
      stats.average_ph = (soilEntries.reduce((sum, entry) => sum + (entry.ph_level || entry.ph || 0), 0) / soilEntries.length).toFixed(2);
      stats.average_temperature = (soilEntries.reduce((sum, entry) => sum + (entry.temperature || 0), 0) / soilEntries.length).toFixed(2);
      stats.average_moisture = (soilEntries.reduce((sum, entry) => sum + (entry.moisture || entry.moisture || 0), 0) / soilEntries.length).toFixed(2);
    }

    res.json({
      success: true,
      statistics: stats,
      user_id: userId,
      last_update: soilData?.date_gathered || null
    });
  } catch (error) {
    console.error('❌ Error fetching soil statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch soil statistics: ' + error.message
    });
  }
});

module.exports = router;