// Add axios for HTTP requests
const axios = require('axios');

class MLService {
  constructor() {
    // URL of your Python ML service on Render
    this.mlServiceUrl = process.env.ML_SERVICE_URL || 'https://tomato-ai-ml-service.onrender.com';
    this.initialized = true; // No need to load Python locally
  }

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
        timeout: 60000, // 60 second timeout
        headers: { 'Content-Type': 'application/json' }
      });

      console.log('✅ Soil analysis completed by ML service');
      return response.data;
    } catch (error) {
      console.error('❌ ML service soil analysis failed:', error.message);
      return this.getSoilFallbackAnalysis(error.message);
    }
  }

  async analyzeImage(imageUrl, userId, imageId) {
    try {
      console.log('🖼️ Calling Python ML service for image analysis...');
      
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

      console.log('✅ Image analysis completed by ML service');
      return response.data;
    } catch (error) {
      console.error('❌ ML service image analysis failed:', error.message);
      return this.getImageFallbackAnalysis(error.message);
    }
  }

  async analyzeBatch(requests, type) {
    try {
      console.log(`📦 Sending batch of ${requests.length} to ML service...`);
      
      const response = await axios.post(`${this.mlServiceUrl}/analyze/batch`, {
        requests: requests,
        analysis_type: type
      }, {
        timeout: 300000, // 5 minute timeout for batches
        headers: { 'Content-Type': 'application/json' }
      });

      console.log(`✅ Batch analysis completed: ${response.data.successful}/${response.data.total} successful`);
      return response.data;
    } catch (error) {
      console.error('❌ ML service batch analysis failed:', error.message);
      return { success: false, error: error.message };
    }
  }
}
