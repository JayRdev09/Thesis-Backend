const express = require('express');
const router = express.Router();
const storageService = require('../services/storageService');

router.get('/', async (req, res) => {
  try {
    const storageHealth = await storageService.healthCheck();
    
    res.json({
      status: 'healthy',
      message: 'Tomato AI Backend  is running!',
      timestamp: new Date().toISOString(),
      version: '2.0.0',
      storage: storageHealth,
      services: {
        database: storageHealth.database,
        ml_service: 'ready'
      }
    });
  } catch (error) {
    res.status(500).json({
      status: 'degraded',
      message: 'Service experiencing issues',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;