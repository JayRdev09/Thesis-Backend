const supabaseService = require('./supabaseService');

class LoggingService {
  constructor() {
    this.supabase = supabaseService;
    console.log('📝 Logging Service initialized');
  }

  /**
   * SYSTEM LOGGING SERVICE
   *
   * This service provides centralized logging for all system activities.
   * It stores logs in the 'system_logs' table with the following structure:
   * - log_id: serial (auto-increment primary key)
   * - user_id: uuid (nullable, references users_registered.user_id)
   * - action_type: varchar(255) (e.g., 'USER_SIGNUP', 'LOGIN', 'IMAGE_UPLOAD')
   * - module_source: varchar(255) (e.g., 'auth', 'ml-service', 'soil-analysis')
   * - status_message: varchar(255) (descriptive message)
   * - date_done: timestamp with time zone (defaults to now())
   *
   * USAGE EXAMPLES:
   *
   * // Log user authentication activities
   * await loggingService.logAuthActivity(userId, 'USER_LOGIN', 'User logged in successfully');
   *
   * // Log ML service activities
   * await loggingService.logMLActivity(userId, 'ANALYSIS_COMPLETED', 'Soil analysis completed');
   *
   * // Log image activities
   * await loggingService.logImageActivity(userId, 'BATCH_UPLOAD', 'Uploaded 5 images');
   *
   * // Log system-level activities (no user context)
   * await loggingService.logSystemActivity('BACKUP_STARTED', 'Database backup initiated');
   *
   * // Log custom activities
   * await loggingService.logActivity({
   *   userId: userId,
   *   actionType: 'CUSTOM_ACTION',
   *   moduleSource: 'custom-module',
   *   statusMessage: 'Custom action performed'
   * });
   *
   * API ENDPOINTS:
   * - GET /api/logs/my-logs - Get current user's logs
   * - GET /api/logs/system-logs - Get all system logs (admin)
   * - GET /api/logs/logs-by-module/:module - Get logs for specific module
   */

  /**
   * Log a system activity
   * @param {Object} logData - The log data
   * @param {string} logData.userId - User ID (optional)
   * @param {string} logData.actionType - Type of action (e.g., 'LOGIN', 'UPLOAD_IMAGE', 'ANALYSIS_COMPLETED')
   * @param {string} logData.moduleSource - Source module (e.g., 'auth', 'ml-service', 'soil-analysis')
   * @param {string} logData.statusMessage - Status message describing the action
   * @param {Date} logData.dateDone - Timestamp (optional, defaults to now)
   */
  async logActivity({
    userId = null,
    actionType,
    moduleSource,
    statusMessage,
    dateDone = new Date()
  }) {
    try {
      if (!this.supabase.initialized) {
        await this.supabase.waitForInitialization();
        if (!this.supabase.initialized) {
          console.error('❌ Cannot log activity: Supabase not initialized');
          return false;
        }
      }

      // Validate required fields
      if (!actionType || !moduleSource || !statusMessage) {
        console.error('❌ Missing required fields for logging:', { actionType, moduleSource, statusMessage });
        return false;
      }

      const logEntry = {
        user_id: userId,
        action_type: actionType,
        module_source: moduleSource,
        status_message: statusMessage,
        date_done: dateDone.toISOString()
      };

      const { data, error } = await this.supabase.client
        .from('system_logs')
        .insert(logEntry)
        .select();

      if (error) {
        console.error('❌ Error logging activity:', error);
        return false;
      }

      console.log(`✅ Activity logged: ${actionType} - ${statusMessage}`);
      return true;

    } catch (error) {
      console.error('❌ Logging service error:', error);
      return false;
    }
  }

  /**
   * Log user authentication activities
   */
  async logAuthActivity(userId, action, message) {
    return this.logActivity({
      userId,
      actionType: action,
      moduleSource: 'auth',
      statusMessage: message
    });
  }

  /**
   * Log ML service activities
   */
  async logMLActivity(userId, action, message) {
    return this.logActivity({
      userId,
      actionType: action,
      moduleSource: 'ml-service',
      statusMessage: message
    });
  }

  /**
   * Log soil analysis activities
   */
  async logSoilActivity(userId, action, message) {
    return this.logActivity({
      userId,
      actionType: action,
      moduleSource: 'soil-analysis',
      statusMessage: message
    });
  }

  /**
   * Log plant analysis activities
   */
  async logPlantActivity(userId, action, message) {
    return this.logActivity({
      userId,
      actionType: action,
      moduleSource: 'plant-analysis',
      statusMessage: message
    });
  }

  /**
   * Log image upload activities
   */
  async logImageActivity(userId, action, message) {
    return this.logActivity({
      userId,
      actionType: action,
      moduleSource: 'image-upload',
      statusMessage: message
    });
  }

  /**
   * Log system-level activities (no user context)
   */
  async logSystemActivity(action, message) {
    return this.logActivity({
      actionType: action,
      moduleSource: 'system',
      statusMessage: message
    });
  }

  /**
   * Get logs for a specific user
   * @param {string} userId - User ID
   * @param {number} limit - Maximum number of logs to return (default: 50)
   * @param {number} offset - Offset for pagination (default: 0)
   */
  async getUserLogs(userId, limit = 50, offset = 0) {
    try {
      if (!this.supabase.initialized) {
        await this.supabase.waitForInitialization();
        if (!this.supabase.initialized) {
          throw new Error('Supabase not initialized');
        }
      }

      const { data, error } = await this.supabase.client
        .from('system_logs')
        .select('*')
        .eq('user_id', userId)
        .order('date_done', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) {
        console.error('❌ Error fetching user logs:', error);
        throw error;
      }

      return data || [];

    } catch (error) {
      console.error('❌ Error in getUserLogs:', error);
      throw error;
    }
  }

  /**
   * Get system logs (all users)
   * @param {number} limit - Maximum number of logs to return (default: 100)
   * @param {number} offset - Offset for pagination (default: 0)
   */
  async getSystemLogs(limit = 100, offset = 0) {
    try {
      if (!this.supabase.initialized) {
        await this.supabase.waitForInitialization();
        if (!this.supabase.initialized) {
          throw new Error('Supabase not initialized');
        }
      }

      const { data, error } = await this.supabase.client
        .from('system_logs')
        .select('*')
        .order('date_done', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) {
        console.error('❌ Error fetching system logs:', error);
        throw error;
      }

      return data || [];

    } catch (error) {
      console.error('❌ Error in getSystemLogs:', error);
      throw error;
    }
  }

  /**
   * Get logs by module source
   * @param {string} moduleSource - Module source to filter by
   * @param {number} limit - Maximum number of logs to return (default: 50)
   * @param {number} offset - Offset for pagination (default: 0)
   */
  async getLogsByModule(moduleSource, limit = 50, offset = 0) {
    try {
      if (!this.supabase.initialized) {
        await this.supabase.waitForInitialization();
        if (!this.supabase.initialized) {
          throw new Error('Supabase not initialized');
        }
      }

      const { data, error } = await this.supabase.client
        .from('system_logs')
        .select('*')
        .eq('module_source', moduleSource)
        .order('date_done', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) {
        console.error('❌ Error fetching logs by module:', error);
        throw error;
      }

      return data || [];

    } catch (error) {
      console.error('❌ Error in getLogsByModule:', error);
      throw error;
    }
  }
}

module.exports = new LoggingService();