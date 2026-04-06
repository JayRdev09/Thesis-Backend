const express = require('express');
const router = express.Router();
const loggingService = require('../services/loggingService');
const supabaseService = require('../services/supabaseService');

// Middleware to validate user authentication
const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Authorization token required'
      });
    }

    const token = authHeader.substring(7);
    const { data: { user }, error } = await supabaseService.client.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired token'
      });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({
      success: false,
      message: 'Authentication error'
    });
  }
};

// Get user's own logs
router.get('/my-logs', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    console.log(`📋 Fetching logs for user: ${userId}, limit: ${limit}, offset: ${offset}`);

    const logs = await loggingService.getUserLogs(userId, limit, offset);

    // Log the log retrieval activity
    await loggingService.logAuthActivity(
      userId,
      'VIEW_LOGS',
      'User viewed their activity logs'
    );

    res.json({
      success: true,
      message: `Retrieved ${logs.length} log entries`,
      data: logs,
      pagination: {
        limit,
        offset,
        hasMore: logs.length === limit
      }
    });

  } catch (error) {
    console.error('❌ Error fetching user logs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch logs',
      error: error.message
    });
  }
});

// Get system logs (admin only - you might want to add admin role checking)
router.get('/system-logs', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;
    const module = req.query.module; // Optional filter by module

    console.log(`📋 Fetching system logs, limit: ${limit}, offset: ${offset}, module: ${module || 'all'}`);

    let logs;
    if (module) {
      logs = await loggingService.getLogsByModule(module, limit, offset);
    } else {
      logs = await loggingService.getSystemLogs(limit, offset);
    }

    // Log the system log retrieval activity
    await loggingService.logAuthActivity(
      userId,
      'VIEW_SYSTEM_LOGS',
      `Viewed system logs${module ? ` for module: ${module}` : ''}`
    );

    res.json({
      success: true,
      message: `Retrieved ${logs.length} system log entries`,
      data: logs,
      pagination: {
        limit,
        offset,
        hasMore: logs.length === limit
      },
      filter: module ? { module } : null
    });

  } catch (error) {
    console.error('❌ Error fetching system logs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch system logs',
      error: error.message
    });
  }
});

// Get logs by module
router.get('/logs-by-module/:module', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const module = req.params.module;
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    console.log(`📋 Fetching logs for module: ${module}, limit: ${limit}, offset: ${offset}`);

    const logs = await loggingService.getLogsByModule(module, limit, offset);

    // Log the module log retrieval activity
    await loggingService.logAuthActivity(
      userId,
      'VIEW_MODULE_LOGS',
      `Viewed logs for module: ${module}`
    );

    res.json({
      success: true,
      message: `Retrieved ${logs.length} log entries for module: ${module}`,
      data: logs,
      pagination: {
        limit,
        offset,
        hasMore: logs.length === limit
      },
      module
    });

  } catch (error) {
    console.error('❌ Error fetching module logs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch module logs',
      error: error.message
    });
  }
});

module.exports = router;