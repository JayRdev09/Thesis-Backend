// services/soilTrendService.js
const supabaseService = require('./supabaseService');

class SoilTrendService {
  constructor() {
    this.supabase = supabaseService;
  }

  _getClient() {
    let supabaseClient;
    if (typeof this.supabase === 'function') {
      supabaseClient = this.supabase();
    } else if (this.supabase?.client) {
      supabaseClient = this.supabase.client;
    } else {
      supabaseClient = this.supabase;
    }
    return supabaseClient;
  }

  /**
   * Get soil health trend dashboard data
   * @param {string} userId - User ID
   * @param {string} cropType - Crop type (default: 'tomato')
   * @param {number} months - Number of months to analyze (default: 12)
   */
  async getSoilHealthTrends(userId, cropType = 'tomato', months = 12) {
    try {
      console.log(`📊 Fetching soil health trends for user: ${userId}`);
      
      const supabaseClient = this._getClient();
      if (!supabaseClient) {
        throw new Error('Supabase client not available');
      }

      // Get data from last X months
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - months);

      const { data, error } = await supabaseClient
        .from('soil_analysis_history')
        .select('created_at, soil_quality_score, ph_level, nitrogen, phosphorus, potassium, moisture, temperature, soil_status')
        .eq('user_id', userId)
        .eq('crop_type', cropType)
        .gte('created_at', startDate.toISOString())
        .order('created_at', { ascending: true });

      if (error) throw error;

      if (!data || data.length === 0) {
        return {
          success: true,
          hasData: false,
          message: 'No soil analysis data found for this user',
          trends: []
        };
      }

      // Process data into monthly trends
      const monthlyData = this._aggregateMonthlyData(data);
      
      // Calculate trends
      const trends = this._calculateTrends(monthlyData);
      
      // Get current status
      const currentStatus = this._getCurrentStatus(data);
      
      // Get recommendations based on trends
      const recommendations = this._generateRecommendations(trends, currentStatus);

      return {
        success: true,
        hasData: true,
        current_status: currentStatus,
        trends: trends,
        recommendations: recommendations,
        summary: this._getSummary(trends, currentStatus),
        raw_data: data // Optional: remove if too large
      };

    } catch (error) {
      console.error('❌ Error fetching soil trends:', error);
      return {
        success: false,
        error: error.message,
        hasData: false,
        trends: []
      };
    }
  }

  /**
   * Aggregate data by month
   */
  _aggregateMonthlyData(data) {
    const monthlyMap = new Map();

    data.forEach(record => {
      const date = new Date(record.created_at);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const monthName = date.toLocaleString('default', { month: 'long' });
      const year = date.getFullYear();

      if (!monthlyMap.has(monthKey)) {
        monthlyMap.set(monthKey, {
          month_key: monthKey,
          month_name: monthName,
          year: year,
          month_num: date.getMonth() + 1,
          total_quality: 0,
          total_ph: 0,
          total_n: 0,
          total_p: 0,
          total_k: 0,
          total_moisture: 0,
          total_temp: 0,
          count: 0,
          samples: []
        });
      }

      const monthData = monthlyMap.get(monthKey);
      monthData.total_quality += record.soil_quality_score || 0;
      monthData.total_ph += record.ph_level || 0;
      monthData.total_n += record.nitrogen || 0;
      monthData.total_p += record.phosphorus || 0;
      monthData.total_k += record.potassium || 0;
      monthData.total_moisture += record.moisture || 0;
      monthData.total_temp += record.temperature || 0;
      monthData.count++;
      monthData.samples.push(record);
    });

    // Calculate averages and convert to array
    const monthlyArray = Array.from(monthlyMap.values()).map(month => ({
      month_key: month.month_key,
      month_name: month.month_name,
      year: month.year,
      month_num: month.month_num,
      avg_quality: parseFloat((month.total_quality / month.count).toFixed(1)),
      avg_ph: parseFloat((month.total_ph / month.count).toFixed(2)),
      avg_nitrogen: parseFloat((month.total_n / month.count).toFixed(1)),
      avg_phosphorus: parseFloat((month.total_p / month.count).toFixed(1)),
      avg_potassium: parseFloat((month.total_k / month.count).toFixed(1)),
      avg_moisture: parseFloat((month.total_moisture / month.count).toFixed(1)),
      avg_temperature: parseFloat((month.total_temp / month.count).toFixed(1)),
      sample_count: month.count,
      samples: month.samples
    }));

    // Sort by date
    monthlyArray.sort((a, b) => a.month_key.localeCompare(b.month_key));

    return monthlyArray;
  }

  /**
   * Calculate trends between months
   */
  _calculateTrends(monthlyData) {
    const trends = [];

    for (let i = 0; i < monthlyData.length; i++) {
      const current = monthlyData[i];
      const previous = i > 0 ? monthlyData[i - 1] : null;
      
      let quality_change = null;
      let trend_direction = 'start';
      
      if (previous) {
        quality_change = parseFloat((current.avg_quality - previous.avg_quality).toFixed(1));
        
        if (quality_change > 5) {
          trend_direction = 'improving';
        } else if (quality_change < -5) {
          trend_direction = 'degrading';
        } else {
          trend_direction = 'stable';
        }
      }

      trends.push({
        month_key: current.month_key,
        month_name: current.month_name,
        year: current.year,
        month_num: current.month_num,
        avg_quality: current.avg_quality,
        quality_change: quality_change,
        trend_direction: trend_direction,
        trend_icon: trend_direction === 'improving' ? '📈' : (trend_direction === 'degrading' ? '📉' : (trend_direction === 'stable' ? '➡️' : '🟢')),
        avg_ph: current.avg_ph,
        avg_nitrogen: current.avg_nitrogen,
        avg_phosphorus: current.avg_phosphorus,
        avg_potassium: current.avg_potassium,
        avg_moisture: current.avg_moisture,
        avg_temperature: current.avg_temperature,
        sample_count: current.sample_count
      });
    }

    return trends;
  }

  /**
   * Get current soil status
   */
  _getCurrentStatus(data) {
    if (!data || data.length === 0) return null;
    
    const latest = data[data.length - 1];
    
    return {
      date: latest.created_at,
      soil_quality_score: latest.soil_quality_score,
      soil_status: latest.soil_status,
      ph_level: latest.ph_level,
      nitrogen: latest.nitrogen,
      phosphorus: latest.phosphorus,
      potassium: latest.potassium,
      moisture: latest.moisture,
      temperature: latest.temperature,
      confidence: latest.confidence_score || null
    };
  }

  /**
   * Generate actionable recommendations
   */
  _generateRecommendations(trends, currentStatus) {
    const recommendations = [];
    
    if (!currentStatus) return recommendations;

    // Check current nutrient levels
    if (currentStatus.phosphorus < 50) {
      recommendations.push({
        priority: 'high',
        type: 'nutrient_deficiency',
        parameter: 'phosphorus',
        current: currentStatus.phosphorus,
        optimal_min: 50,
        optimal_max: 80,
        action: 'Apply phosphorus fertilizer (bone meal or rock phosphate)',
        urgency: 'immediate'
      });
    }

    if (currentStatus.potassium < 450) {
      recommendations.push({
        priority: 'high',
        type: 'nutrient_deficiency',
        parameter: 'potassium',
        current: currentStatus.potassium,
        optimal_min: 450,
        optimal_max: 720,
        action: 'Apply potassium fertilizer (potash or greensand)',
        urgency: 'immediate'
      });
    }

    if (currentStatus.ph_level < 6.0) {
      recommendations.push({
        priority: 'medium',
        type: 'ph_correction',
        parameter: 'ph_level',
        current: currentStatus.ph_level,
        optimal_min: 6.0,
        optimal_max: 7.0,
        action: 'Add agricultural lime to raise pH',
        urgency: 'soon'
      });
    } else if (currentStatus.ph_level > 7.0) {
      recommendations.push({
        priority: 'medium',
        type: 'ph_correction',
        parameter: 'ph_level',
        current: currentStatus.ph_level,
        optimal_min: 6.0,
        optimal_max: 7.0,
        action: 'Add elemental sulfur to lower pH',
        urgency: 'soon'
      });
    }

    if (currentStatus.moisture < 60) {
      recommendations.push({
        priority: 'medium',
        type: 'moisture',
        parameter: 'moisture',
        current: currentStatus.moisture,
        optimal_min: 60,
        optimal_max: 70,
        action: 'Increase irrigation frequency',
        urgency: 'soon'
      });
    } else if (currentStatus.moisture > 70) {
      recommendations.push({
        priority: 'medium',
        type: 'moisture',
        parameter: 'moisture',
        current: currentStatus.moisture,
        optimal_min: 60,
        optimal_max: 70,
        action: 'Reduce irrigation, improve drainage',
        urgency: 'soon'
      });
    }

    // Check trends
    if (trends.length >= 2) {
      const lastTwo = trends.slice(-2);
      const recentTrend = lastTwo[1];
      
      if (recentTrend.trend_direction === 'degrading') {
        recommendations.push({
          priority: 'high',
          type: 'trend_alert',
          parameter: 'soil_quality',
          change: recentTrend.quality_change,
          action: 'Soil quality is degrading. Review recent farming practices.',
          urgency: 'immediate'
        });
      } else if (recentTrend.trend_direction === 'improving') {
        recommendations.push({
          priority: 'low',
          type: 'trend_positive',
          parameter: 'soil_quality',
          change: recentTrend.quality_change,
          action: 'Continue current practices - soil health is improving!',
          urgency: 'monitor'
        });
      }
    }

    return recommendations;
  }

  /**
   * Get summary statistics
   */
  _getSummary(trends, currentStatus) {
    if (!trends.length || !currentStatus) return null;

    const qualities = trends.map(t => t.avg_quality);
    const firstQuality = trends[0]?.avg_quality || currentStatus.soil_quality_score;
    const lastQuality = currentStatus.soil_quality_score;
    const overallChange = parseFloat((lastQuality - firstQuality).toFixed(1));
    
    const improvingMonths = trends.filter(t => t.trend_direction === 'improving').length;
    const degradingMonths = trends.filter(t => t.trend_direction === 'degrading').length;
    const stableMonths = trends.filter(t => t.trend_direction === 'stable').length;

    return {
      total_months: trends.length,
      overall_change: overallChange,
      overall_trend: overallChange > 5 ? 'improving' : (overallChange < -5 ? 'degrading' : 'stable'),
      best_month: trends.reduce((best, current) => 
        current.avg_quality > (best?.avg_quality || 0) ? current : best, null),
      worst_month: trends.reduce((worst, current) => 
        current.avg_quality < (worst?.avg_quality || Infinity) ? current : worst, null),
      improving_months: improvingMonths,
      degrading_months: degradingMonths,
      stable_months: stableMonths,
      average_quality: parseFloat((qualities.reduce((a,b) => a + b, 0) / qualities.length).toFixed(1))
    };
  }

  /**
   * Get raw data for charts (simplified)
   */
  async getChartData(userId, cropType = 'tomato', months = 12) {
    try {
      const result = await this.getSoilHealthTrends(userId, cropType, months);
      
      if (!result.success || !result.hasData) {
        return { success: false, data: [] };
      }

      // Format data for charts
      const chartData = {
        labels: result.trends.map(t => `${t.month_name} ${t.year}`),
        quality_scores: result.trends.map(t => t.avg_quality),
        ph_levels: result.trends.map(t => t.avg_ph),
        nitrogen: result.trends.map(t => t.avg_nitrogen),
        phosphorus: result.trends.map(t => t.avg_phosphorus),
        potassium: result.trends.map(t => t.avg_potassium),
        moisture: result.trends.map(t => t.avg_moisture),
        temperature: result.trends.map(t => t.avg_temperature),
        sample_counts: result.trends.map(t => t.sample_count),
        trends: result.trends.map(t => t.trend_direction)
      };

      return {
        success: true,
        current_status: result.current_status,
        chart_data: chartData,
        summary: result.summary,
        recommendations: result.recommendations
      };

    } catch (error) {
      console.error('❌ Error getting chart data:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get historical comparison (year over year)
   */
  async getYearOverYearComparison(userId, cropType = 'tomato') {
    try {
      const supabaseClient = this._getClient();
      
      const { data, error } = await supabaseClient
        .from('soil_analysis_history')
        .select('created_at, soil_quality_score, ph_level')
        .eq('user_id', userId)
        .eq('crop_type', cropType)
        .order('created_at', { ascending: true });

      if (error) throw error;

      // Group by year
      const yearlyData = {};
      data.forEach(record => {
        const year = new Date(record.created_at).getFullYear();
        if (!yearlyData[year]) {
          yearlyData[year] = {
            year: year,
            total_quality: 0,
            count: 0
          };
        }
        yearlyData[year].total_quality += record.soil_quality_score || 0;
        yearlyData[year].count++;
      });

      const comparison = Object.values(yearlyData).map(year => ({
        year: year.year,
        avg_quality: parseFloat((year.total_quality / year.count).toFixed(1)),
        sample_count: year.count
      })).sort((a,b) => a.year - b.year);

      return {
        success: true,
        comparison: comparison,
        best_year: comparison.reduce((best, current) => 
          current.avg_quality > (best?.avg_quality || 0) ? current : best, null),
        improvement_rate: comparison.length >= 2 ? 
          parseFloat((comparison[comparison.length - 1].avg_quality - comparison[0].avg_quality).toFixed(1)) : 0
      };

    } catch (error) {
      console.error('❌ Error getting year-over-year comparison:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = SoilTrendService;