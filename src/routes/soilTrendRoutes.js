// routes/soilTrendRoutes.js
const express = require('express');
const router = express.Router();
const SoilTrendService = require('../services/soilTrendService');

const soilTrendService = new SoilTrendService();

/**
 * GET /api/soil/trends
 * Get soil health trends dashboard
 * Query params:
 * - userId (required)
 * - cropType (optional, default: tomato)
 * - months (optional, default: 12)
 */
router.get('/trends', async (req, res) => {
  try {
    const { userId, cropType = 'tomato', months = 12 } = req.query;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'userId is required'
      });
    }

    const result = await soilTrendService.getSoilHealthTrends(userId, cropType, parseInt(months));
    
    if (!result.success) {
      return res.status(500).json(result);
    }

    res.json(result);

  } catch (error) {
    console.error('Error in /trends route:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/soil/chart-data
 * Get formatted data for charts
 * Query params:
 * - userId (required)
 * - cropType (optional, default: tomato)
 * - months (optional, default: 12)
 */
router.get('/chart-data', async (req, res) => {
  try {
    const { userId, cropType = 'tomato', months = 12 } = req.query;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'userId is required'
      });
    }

    const result = await soilTrendService.getChartData(userId, cropType, parseInt(months));
    
    if (!result.success) {
      return res.status(500).json(result);
    }

    res.json(result);

  } catch (error) {
    console.error('Error in /chart-data route:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/soil/year-over-year
 * Get year over year comparison
 * Query params:
 * - userId (required)
 * - cropType (optional, default: tomato)
 */
router.get('/year-over-year', async (req, res) => {
  try {
    const { userId, cropType = 'tomato' } = req.query;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'userId is required'
      });
    }

    const result = await soilTrendService.getYearOverYearComparison(userId, cropType);
    
    if (!result.success) {
      return res.status(500).json(result);
    }

    res.json(result);

  } catch (error) {
    console.error('Error in /year-over-year route:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/soil/latest
 * Get only the latest soil analysis
 * Query params:
 * - userId (required)
 * - cropType (optional, default: tomato)
 */
router.get('/latest', async (req, res) => {
  try {
    const { userId, cropType = 'tomato' } = req.query;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'userId is required'
      });
    }

    const result = await soilTrendService.getSoilHealthTrends(userId, cropType, 1);
    
    if (!result.success) {
      return res.status(500).json(result);
    }

    res.json({
      success: true,
      current_status: result.current_status,
      latest_trend: result.trends[result.trends.length - 1] || null
    });

  } catch (error) {
    console.error('Error in /latest route:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/soil/summary
 * Get only summary statistics
 * Query params:
 * - userId (required)
 * - cropType (optional, default: tomato)
 * - months (optional, default: 12)
 */
router.get('/summary', async (req, res) => {
  try {
    const { userId, cropType = 'tomato', months = 12 } = req.query;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'userId is required'
      });
    }

    const result = await soilTrendService.getSoilHealthTrends(userId, cropType, parseInt(months));
    
    if (!result.success) {
      return res.status(500).json(result);
    }

    res.json({
      success: true,
      summary: result.summary,
      current_status: result.current_status,
      recommendations: result.recommendations.filter(r => r.priority === 'high')
    });

  } catch (error) {
    console.error('Error in /summary route:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;