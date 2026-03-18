// mlService.js - Clean version without fallbacks
const axios = require('axios');
const supabaseService = require('./supabaseService');

class MLService {
  constructor() {
    this.mlServiceUrl = process.env.ML_SERVICE_URL || 'https://tomato-ai-ml-service.onrender.com';
    this.supabase = supabaseService;
    this.initialized = true;
    console.log('🤖 ML Service initialized (using external Python service at:', this.mlServiceUrl, ')');
  }

  // ============ FETCH CONFIGURATIONS FROM DATABASE ============
  async fetchOptimalRanges() {
    try {
      console.log('📊 Fetching optimal ranges from Supabase...');
      
      const supabaseClient = this.supabase?.client || this.supabase;
      
      const { data: rangesData, error: rangesError } = await supabaseClient
        .from('optimal_ranges')
        .select('parameter, optimal_min, optimal_max, unit')
        .eq('crop_type', 'tomato');
      
      if (rangesError) throw new Error(`Failed to fetch optimal ranges: ${rangesError.message}`);
      
      const { data: qualityData, error: qualityError } = await supabaseClient
        .from('soil_quality_thresholds')
        .select('thresholds, labels')
        .eq('crop_type', 'tomato')
        .limit(1);
      
      if (qualityError) throw new Error(`Failed to fetch quality thresholds: ${qualityError.message}`);
      
      const optimalRanges = {};
      
      rangesData.forEach(row => {
        optimalRanges[row.parameter] = {
          optimal: [parseFloat(row.optimal_min), parseFloat(row.optimal_max)],
          unit: row.unit || ''
        };
      });
      
      // Add default moisture threshold
      optimalRanges.moisture_threshold = { optimal: [20, 0], unit: '%' };
      
      optimalRanges.quality_thresholds = {
        thresholds: qualityData[0].thresholds,
        labels: qualityData[0].labels
      };
      
      return optimalRanges;
    } catch (error) {
      console.error('❌ Failed to fetch optimal ranges:', error.message);
      throw error; // Re-throw to be handled by caller
    }
  }

  async fetchTomatoPredictionThresholds() {
    try {
      console.log('📊 Fetching tomato prediction thresholds...');
      
      const supabaseClient = this.supabase?.client || this.supabase;
      
      const tomatoConfig = {
        confidence_threshold: 0.3,
        health_thresholds: {
          healthy_threshold: 0.7,
          moderate_keywords: ['early', 'mild', 'minor', 'spot'],
          critical_keywords: ['late', 'severe', 'rot', 'blight', 'mosaic', 'virus'],
          disease_severities: {}
        },
        scoring_config: {
          base_scores: { healthy: 95, moderate: 70, critical: 25, default: 45 },
          confidence_adjustment_factor: 30,
          min_score: 0,
          max_score: 100
        },
        recommendation_config: {
          max_recommendations: 6,
          low_confidence_recommendations: [
            "The model is not confident about this prediction.",
            "Please upload a clearer image of a tomato leaf or fruit.",
            "Ensure the image is well-lit and focused on the plant part."
          ],
          non_tomato_recommendations: [
            "This does not appear to be a tomato plant.",
            "Please upload clear images of tomato leaves or fruits."
          ],
          health_status_recommendations: {
            "Healthy": ["Continue current care practices.", "Monitor plants weekly."],
            "Moderate": ["Address the issue promptly.", "Remove affected plant parts."],
            "Critical": ["URGENT: Treat the disease immediately.", "Consult agriculture expert."]
          }
        },
        disease_recommendations: {}
      };
      
      // Fetch disease recommendations from database
      const { data: recommendationsData, error: recError } = await supabaseClient
        .from('disease_recommendations')
        .select('disease_name, recommendation, severity')
        .eq('is_active', true);
      
      if (recError) {
        console.warn('⚠️ Could not fetch disease recommendations:', recError.message);
      } else if (recommendationsData) {
        recommendationsData.forEach(rec => {
          tomatoConfig.disease_recommendations[rec.disease_name] = {
            recommendation: rec.recommendation,
            severity: rec.severity
          };
        });
      }
      
      return tomatoConfig;
    } catch (error) {
      console.error('❌ Failed to fetch tomato config:', error.message);
      throw error; // Re-throw to be handled by caller
    }
  }

  // ============ ML SERVICE API CALLS ============
  async analyzeSoil(soilData, userId, soilId) {
    try {
      console.log('🌱 Calling Python ML service for soil analysis...');
      
      const optimalRanges = await this.fetchOptimalRanges();
      
      const response = await axios.post(`${this.mlServiceUrl}/analyze/soil`, {
        soil_data: soilData,
        optimal_ranges: optimalRanges,
        user_id: userId,
        soil_id: soilId
      }, { 
        timeout: 60000,
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.data?.success) {
        throw new Error(response.data?.error || 'Soil analysis failed');
      }

      console.log('✅ Soil analysis completed by ML service');
      return {
        success: true,
        ...response.data,
        user_id: userId,
        soil_id: soilId
      };
    } catch (error) {
      console.error('❌ ML service soil analysis failed:', error.message);
      throw new Error(`Soil analysis failed: ${error.message}`);
    }
  }

  async analyzeImage(imageData, userId, imageId) {
    try {
      console.log('🖼️ Calling Python ML service for image analysis...');
      
      // Handle different image input types
      let imageUrl = imageData;
      if (typeof imageData === 'object') {
        imageUrl = imageData.publicUrl || imageData.url || imageData.image_url;
      }
      
      if (!imageUrl) {
        throw new Error('No valid image URL provided');
      }
      
      const tomatoConfig = await this.fetchTomatoPredictionThresholds();
      
      const response = await axios.post(`${this.mlServiceUrl}/analyze/tomato`, {
        image_url: imageUrl,
        tomato_config: tomatoConfig,
        user_id: userId,
        image_id: imageId
      }, { 
        timeout: 60000,
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.data?.success) {
        throw new Error(response.data?.error || 'Image analysis failed');
      }

      console.log('✅ Image analysis completed by ML service');
      return {
        success: true,
        ...response.data,
        user_id: userId,
        image_id: imageId
      };
    } catch (error) {
      console.error('❌ ML service image analysis failed:', error.message);
      throw new Error(`Image analysis failed: ${error.message}`);
    }
  }

  async analyzeBatch(requests, type, userId) {
    try {
      console.log(`📦 Sending batch of ${requests.length} to ML service...`);
      
      const response = await axios.post(`${this.mlServiceUrl}/analyze/batch`, {
        requests: requests,
        analysis_type: type
      }, { 
        timeout: 300000,
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.data?.success) {
        throw new Error(response.data?.error || 'Batch analysis failed');
      }

      console.log(`✅ Batch analysis completed: ${response.data.successful}/${response.data.total} successful`);
      return response.data;
    } catch (error) {
      console.error('❌ ML service batch analysis failed:', error.message);
      throw new Error(`Batch analysis failed: ${error.message}`);
    }
  }

  async analyzeBatchImages(imageDataList, userId, soilAnalysis = null, options = {}) {
    try {
      console.log(`🤖 Processing batch of ${imageDataList.length} images for user ${userId}`);
      
      const requests = imageDataList.map(img => ({
        image_url: img.publicUrl || img.url || img.image_url,
        image_id: img.image_id
      }));
      
      const result = await this.analyzeBatch(requests, 'tomato', userId);
      
      return {
        success: true,
        ...result,
        batch_timestamp: options.batch_timestamp || new Date().toISOString()
      };
    } catch (error) {
      console.error('❌ Batch image analysis failed:', error);
      throw error;
    }
  }

  // ============ HEALTH CHECK ============
  healthCheck() {
    return {
      initialized: this.initialized,
      ml_service_url: this.mlServiceUrl,
      status: 'operational',
      timestamp: new Date().toISOString()
    };
  }
}

// Create and export a single instance
const mlServiceInstance = new MLService();
module.exports = mlServiceInstance;
