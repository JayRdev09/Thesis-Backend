// mlService.js - MODIFIED (Remove JavaScript Late Fusion storage)
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const supabaseService = require('./supabaseService');
// const LateFusionService = require('./lateFusionService'); // ← COMMENT OUT - NOT USING
const https = require('https');

// Try to import form-data, but don't fail if not available
let FormData;
try {
  FormData = require('form-data');
} catch (e) {
  console.warn('⚠️ form-data package not installed, file uploads will use JSON fallback');
}

class MLService {
  constructor() {
    this.initialized = true;
    this.model_loaded = true;
    this.runtime = 'nodejs';
    this.class_count = 6;
    
    // Hugging Face ML Service URL - from environment variable
    this.mlApiUrl = process.env.ML_SERVICE_URL || 'https://JayRexe09-tomato-ai-ml-service.hf.space';
    
    // Paths for local operations
    this.pythonScriptsPath = path.join(__dirname, '..', '..', 'python_scripts');
    this.tempDir = process.env.NODE_ENV === 'production' 
      ? '/tmp/tomato-ai-temp'
      : path.join(__dirname, '..', '..', 'temp');
    
    // this.lateFusionService = new LateFusionService(); // ← COMMENT OUT
    this.supabase = supabaseService;
    
    // Create temp directory if it doesn't exist
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
    
    console.log(`🤖 ML Service initialized with API URL: ${this.mlApiUrl}`);
    console.log(`✅ JavaScript Late Fusion DISABLED - Python service handles storage`);
  }

  // ============ HUGGING FACE API METHODS ============

  /**
   * Analyze soil data using Hugging Face ML service
   */
  async analyzeSoil(soilData, userId, soilId, optimalRanges = null) {
    try {
      console.log('🌱 Calling Hugging Face ML service for soil analysis...');
      
      const endpoint = `${this.mlApiUrl}/analyze-soil`;
      console.log(`📍 Endpoint: ${endpoint}`);
      
      const requestBody = {
        soil_data: soilData,
        user_id: userId ? String(userId) : null,
        soil_id: soilId ? String(soilId) : null
      };
      
      if (optimalRanges) {
        requestBody.optimal_ranges = optimalRanges;
      }
      
      console.log('📦 Request body soil analysis:', JSON.stringify(requestBody, null, 2));
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ ML service responded with status: ${response.status}`);
        console.error(`❌ Error details: ${errorText.substring(0, 500)}...`);
        
        try {
          const errorJson = JSON.parse(errorText);
          throw new Error(`ML service error (${response.status}): ${JSON.stringify(errorJson)}`);
        } catch {
          throw new Error(`ML service error (${response.status})`);
        }
      }

      const result = await response.json();
      console.log('✅ Soil analysis from ML service:', {
        success: result.success,
        soil_status: result.soil_status,
        soil_quality_score: result.soil_quality_score,
        confidence_score: result.confidence_score,
        issues_count: result.soil_issues?.length || 0,
        recommendations_count: result.recommendations?.length || 0
      });
      
      return result;
      
    } catch (error) {
      console.error('❌ Error calling ML service for soil analysis:', error);
      return {
        success: false,
        error: error.message,
        fallback: true,
        soil_status: 'Unknown',
        soil_quality_score: 0,
        confidence_score: 0,
        soil_issues: ['Analysis failed: ' + error.message],
        soil_recommendations: ['Please try again later or check system configuration.']
      };
    }
  }

  /**
   * Analyze tomato image using Hugging Face ML service (by URL)
   */
  async analyzeTomatoByUrl(imageUrl, userId, imageId, tomatoConfig = null) {
    try {
      console.log('🍅 Calling Hugging Face ML service for tomato analysis (URL)...');
      
      const endpoint = `${this.mlApiUrl}/analyze-tomato`;
      console.log(`📍 Endpoint: ${endpoint}`);
      console.log(`📷 Image URL: ${imageUrl}`);
      
      const requestBody = {
        image_url: imageUrl,
        user_id: userId ? String(userId) : null,
        image_id: imageId ? String(imageId) : null
      };
      
      if (tomatoConfig) {
        requestBody.tomato_config = tomatoConfig;
      }
      
      console.log('📦 Request body tomato analysis:', JSON.stringify(requestBody, null, 2));
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ ML service responded with status: ${response.status}`);
        console.error(`❌ Error details: ${errorText.substring(0, 500)}...`);
        throw new Error(`ML service error: ${response.status}`);
      }

      const result = await response.json();
      console.log('✅ Tomato analysis from ML service:', {
        success: result.success,
        predicted_class: result.predicted_class,
        confidence: result.confidence,
        disease_type: result.disease_type,
        health_status: result.health_status,
        recommendations_count: result.recommendations?.length || 0
      });
      
      return result;
      
    } catch (error) {
      console.error('❌ Error calling ML service for tomato analysis:', error);
      return {
        success: false,
        error: error.message,
        fallback: true,
        predicted_class: 'Unknown',
        confidence: 0,
        disease_type: 'Unknown',
        health_status: 'Unknown',
        plant_recommendations: ['Analysis failed: ' + error.message],
        soil_recommendations: [],
        soil_issues: []
      };
    }
  }

  /**
   * Analyze tomato image by file upload
   */
  async analyzeTomatoByFile(imagePath, userId, imageId, tomatoConfig = null) {
    try {
      console.log('🍅 Calling Hugging Face ML service for tomato analysis (file upload)...');
      
      const endpoint = `${this.mlApiUrl}/analyze-tomato-file`;
      console.log(`📍 Endpoint: ${endpoint}`);
      console.log(`📷 Image path: ${imagePath}`);
      
      if (!FormData) {
        console.warn('⚠️ form-data not available, falling back to URL method');
        const imageUrl = await this.uploadImageToTempUrl(imagePath);
        if (imageUrl) {
          return this.analyzeTomatoByUrl(imageUrl, userId, imageId, tomatoConfig);
        }
        throw new Error('form-data package required for file uploads');
      }
      
      const formData = new FormData();
      const fileBuffer = await fs.promises.readFile(imagePath);
      formData.append('file', fileBuffer, {
        filename: path.basename(imagePath),
        contentType: 'image/jpeg'
      });
      
      if (userId) formData.append('user_id', String(userId));
      if (imageId) formData.append('image_id', String(imageId));
      
      const response = await fetch(endpoint, {
        method: 'POST',
        body: formData,
        headers: formData.getHeaders ? formData.getHeaders() : {}
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ ML service responded with status: ${response.status}`);
        console.error(`❌ Error details: ${errorText.substring(0, 500)}...`);
        throw new Error(`ML service error: ${response.status}`);
      }

      const result = await response.json();
      console.log('✅ Tomato analysis from ML service (file):', {
        success: result.success,
        predicted_class: result.predicted_class,
        confidence: result.confidence,
        disease_type: result.disease_type,
        health_status: result.health_status
      });
      return result;
      
    } catch (error) {
      console.error('❌ Error calling ML service for tomato file analysis:', error);
      return {
        success: false,
        error: error.message,
        fallback: true
      };
    }
  }

  /**
   * Upload image to temporary URL (fallback for when form-data not available)
   */
  async uploadImageToTempUrl(imagePath) {
    try {
      console.warn('⚠️ uploadImageToTempUrl not implemented');
      return null;
    } catch (error) {
      console.error('❌ Error uploading to temp URL:', error);
      return null;
    }
  }

  /**
   * Main analyzeImage method - chooses appropriate method based on input
   */
  async analyzeImage(imageData, userId, imageId) {
    try {
      console.log('🤖 Starting image analysis for disease identification...');
      console.log('📦 Image data type:', typeof imageData);
      
      let imageUrl = null;
      let imagePath = null;
      
      if (typeof imageData === 'string') {
        if (imageData.startsWith('http')) {
          imageUrl = imageData;
          console.log('📷 Using image URL:', imageUrl);
        } else if (fs.existsSync(imageData)) {
          imagePath = imageData;
          console.log('📷 Using image path:', imagePath);
        } else {
          throw new Error(`Invalid image data: ${imageData}`);
        }
      } else if (imageData && imageData.publicUrl) {
        imageUrl = imageData.publicUrl;
        console.log('📷 Using publicUrl:', imageUrl);
      } else if (imageData && imageData.image_path) {
        imageUrl = await this.getImagePublicUrl(imageData.image_path);
        console.log('📷 Using image_path converted to URL:', imageUrl);
      } else if (imageData && imageData.buffer) {
        imagePath = path.join(this.tempDir, `temp_image_${Date.now()}.jpg`);
        await fs.promises.writeFile(imagePath, imageData.buffer);
        console.log('📷 Saved buffer to temp file:', imagePath);
      } else {
        console.error('❌ Cannot resolve image to URL or path:', imageData);
        throw new Error('Cannot resolve image to URL or path');
      }
      
      const tomatoConfig = await this.fetchTomatoPredictionThresholds();
      
      let result;
      if (imageUrl) {
        result = await this.analyzeTomatoByUrl(imageUrl, userId, imageId, tomatoConfig);
      } else if (imagePath) {
        result = await this.analyzeTomatoByFile(imagePath, userId, imageId, tomatoConfig);
        
        if (imagePath.includes(this.tempDir)) {
          this.cleanupTempFile(imagePath);
        }
      } else {
        throw new Error('No valid image source found');
      }
      
      const formattedResult = {
        success: result.success,
        tomato_type: result.tomato_type || 'Unknown',
        health_status: result.health_status || 'Unknown',
        disease_type: result.disease_type || result.predicted_class || 'Unknown',
        confidence_score: result.confidence || result.model_confidence || 0,
        plant_health_score: result.plant_health_score || 0,
        plant_recommendations: result.plant_recommendations || result.recommendations || [],
        soil_recommendations: result.soil_recommendations || [],
        soil_issues: result.soil_issues || [],
        disease: result.disease_type || result.predicted_class || 'Unknown',
        confidence: result.confidence || result.model_confidence || 0,
        is_tomato: result.is_tomato || false,
        top_predictions: result.top_predictions || [],
        features: result.features || [],
        model_used: 'huggingface-ml-service',
        inference_time: result.inference_time || 0,
        timestamp: new Date().toISOString(),
        user_id: userId,
        image_id: imageId
      };
      
      console.log('✅ Formatted result:', {
        success: formattedResult.success,
        disease_type: formattedResult.disease_type,
        confidence: formattedResult.confidence,
        plant_recommendations_count: formattedResult.plant_recommendations?.length || 0
      });
      
      return formattedResult;

    } catch (error) {
      console.error('❌ Image analysis failed:', error);
      return this.getImageFallbackAnalysis(error.message);
    }
  }

  /**
   * Analyze batch of images - MODIFIED to NOT store results (Python handles storage)
   */
  async analyzeBatchImages(imageDataList, userId, soilAnalysis = null, options = {}) {
    try {
      console.log(`🤖 Processing batch of ${imageDataList.length} images for user ${userId}`);
      console.log(`⚠️ NOTE: No storage will happen here. Python ML service handles storage.`);
      
      const results = [];
      let successful_predictions = 0;
      let failed_predictions = 0;
      
      const batch_timestamp = options.batch_timestamp || new Date().toISOString();
      
      for (let i = 0; i < imageDataList.length; i++) {
        try {
          const imageData = imageDataList[i];
          console.log(`🖼️ Processing batch image ${i + 1}/${imageDataList.length}`);
          
          const imageResult = await this.analyzeImage(
            imageData, 
            userId, 
            imageData.image_id || `batch_${userId}_${Date.now()}_${i}`
          );
          
          if (imageResult.success) {
            successful_predictions++;
            
            // Store additional metadata but DON'T store in database
            results.push({
              ...imageResult,
              batch_index: i,
              batch_timestamp: batch_timestamp,
              success: true,
              stored_by_python: true  // Flag indicating Python will handle storage
            });
          } else {
            failed_predictions++;
            results.push({
              success: false,
              image_id: imageData.image_id,
              error: imageResult.error || 'Unknown error',
              batch_index: i
            });
          }
        } catch (error) {
          console.error(`❌ Error processing batch image ${i + 1}:`, error.message);
          failed_predictions++;
          results.push({
            success: false,
            image_id: imageDataList[i]?.image_id,
            error: error.message,
            batch_index: i
          });
        }
      }
      
      console.log(`✅ Batch image analysis completed: ${successful_predictions} successful, ${failed_predictions} failed`);
      console.log(`📝 Python ML service will handle storing these predictions`);
      
      // DO NOT CALL lateFusionService.performBatchFusion - REMOVED
      // Storage is handled by Python's auto-fusion
      
      return {
        success: true,
        successful_predictions,
        failed_predictions,
        results: results,
        failed_results: results.filter(r => !r.success),
        total_images: imageDataList.length,
        batch_timestamp: batch_timestamp,
        batch_id: batch_timestamp,
        stored_by_python: true
      };
      
    } catch (error) {
      console.error('❌ Batch image analysis failed:', error);
      return {
        success: false,
        error: error.message,
        successful_predictions: 0,
        failed_predictions: imageDataList.length,
        results: []
      };
    }
  }

  // ============ UTILITY METHODS ============

  async getImagePublicUrl(filePath) {
    try {
      const supabaseUrl = process.env.SUPABASE_URL;
      if (!supabaseUrl) {
        throw new Error('SUPABASE_URL environment variable not set');
      }

      const cleanFilePath = filePath.replace(/^\//, '');
      const publicUrl = `${supabaseUrl}/storage/v1/object/public/images/${cleanFilePath}`;
      console.log('🔗 Constructed public URL:', publicUrl);
      
      return publicUrl;
    } catch (error) {
      console.error('❌ Error constructing public URL:', error);
      return null;
    }
  }

  async fetchTomatoPredictionThresholds() {
    try {
      console.log('📊 Fetching tomato prediction thresholds from Supabase...');
      
      let supabaseClient;
      if (typeof this.supabase === 'function') {
        supabaseClient = this.supabase();
      } else if (this.supabase?.client) {
        supabaseClient = this.supabase.client;
      } else {
        supabaseClient = this.supabase;
      }
      
      if (!supabaseClient || !supabaseClient.from) {
        throw new Error('Supabase client not available');
      }

      const { data: thresholdsData, error: thresholdsError } = await supabaseClient
        .from('tomato_prediction_thresholds')
        .select('threshold_name, threshold_value, description')
        .eq('is_active', true);
      
      if (thresholdsError) throw thresholdsError;
      
      const { data: recommendationsData, error: recError } = await supabaseClient
        .from('disease_recommendations')
        .select('disease_name, recommendation, severity')
        .eq('is_active', true);
      
      if (recError) console.warn('⚠️ Could not fetch disease recommendations:', recError.message);
      
      const tomatoConfig = {
        confidence_threshold: 0.3,
        health_thresholds: {
          healthy_threshold: 0.7,
          moderate_keywords: ['early', 'mild', 'minor', 'spot'],
          critical_keywords: ['late', 'severe', 'rot', 'blight', 'mosaic', 'virus'],
          disease_severities: {}
        },
        scoring_config: {
          base_scores: {
            healthy: 95,
            moderate: 70,
            critical: 25,
            default: 45
          },
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
            "Healthy": [
              "Continue current care practices.",
              "Monitor plants weekly for early signs."
            ],
            "Moderate": [
              "Address the issue promptly.",
              "Remove affected plant parts.",
              "Apply appropriate treatment."
            ],
            "Critical": [
              "URGENT: Treat the disease immediately.",
              "Remove severely infected plants.",
              "Consult agriculture expert."
            ]
          }
        },
        disease_recommendations: {}
      };
      
      if (thresholdsData?.length > 0) {
        thresholdsData.forEach(threshold => {
          if (threshold.threshold_name === 'confidence_threshold') {
            tomatoConfig.confidence_threshold = parseFloat(threshold.threshold_value);
          }
          if (threshold.threshold_name === 'healthy_threshold') {
            tomatoConfig.health_thresholds.healthy_threshold = parseFloat(threshold.threshold_value);
          }
        });
      }
      
      if (recommendationsData?.length > 0) {
        recommendationsData.forEach(rec => {
          tomatoConfig.disease_recommendations[rec.disease_name] = {
            recommendation: rec.recommendation,
            severity: rec.severity
          };
          if (rec.severity) {
            tomatoConfig.health_thresholds.disease_severities[rec.disease_name.toLowerCase()] = rec.severity;
          }
        });
        console.log(`✅ Loaded ${recommendationsData.length} disease recommendations`);
      }
      
      return tomatoConfig;
      
    } catch (error) {
      console.error('❌ Failed to fetch tomato prediction thresholds:', error.message);
      return this.getDefaultTomatoConfig();
    }
  }

  getDefaultTomatoConfig() {
    return {
      confidence_threshold: 0.3,
      health_thresholds: {
        healthy_threshold: 0.7,
        moderate_keywords: ['early', 'mild', 'minor', 'spot'],
        critical_keywords: ['late', 'severe', 'rot', 'blight', 'mosaic', 'virus'],
        disease_severities: {}
      },
      scoring_config: {
        base_scores: {
          healthy: 95,
          moderate: 70,
          critical: 25,
          default: 45
        },
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
          "Healthy": [
            "Continue current care practices.",
            "Monitor plants weekly for early signs."
          ],
          "Moderate": [
            "Address the issue promptly.",
            "Remove affected plant parts.",
            "Apply appropriate treatment."
          ],
          "Critical": [
            "URGENT: Treat the disease immediately.",
            "Remove severely infected plants.",
            "Consult agriculture expert."
          ]
        }
      },
      disease_recommendations: {}
    };
  }

  /**
   * Integrated analysis - MODIFIED to skip storage (Python handles it)
   */
  async integratedAnalysis(imageAnalysis, soilAnalysis, userId, imageId, soilId, options = {}) {
    try {
      console.log('🔗 Starting integrated analysis...');
      console.log(`⚠️ NOTE: Storage will be handled by Python ML service auto-fusion`);

      if (!imageAnalysis.success) {
        throw new Error('Image analysis failed: ' + imageAnalysis.error);
      }

      const mode = soilId ? 'integrated' : 'image_only';
      const has_soil_data = !!soilId;
      
      const finalSoilAnalysis = soilId ? soilAnalysis : {
        success: true,
        soil_status: null,
        soil_quality_score: null,
        confidence_score: null,
        soil_issues: [],
        soil_recommendations: []
      };
      
      // Calculate fused metrics locally for response
      const combinedConfidence = this.calculateCombinedConfidence(imageAnalysis, finalSoilAnalysis);
      const overallHealth = this.calculateOverallHealth(imageAnalysis, finalSoilAnalysis);
      
      // DO NOT store via JavaScript - Python will handle via auto-fusion
      console.log('✅ Integration complete (JavaScript storage skipped - Python handles it)');
      
      return {
        success: true,
        prediction_id: null,  // Will be assigned by Python
        stored_by_python: true,
        diseaseType: imageAnalysis.disease_type,
        confidence: parseFloat(combinedConfidence) || 0,
        plantType: imageAnalysis.tomato_type,
        soilHealth: finalSoilAnalysis.soil_status,
        healthScore: this.calculateHealthScore(overallHealth),
        overallHealth: overallHealth,
        plantRecommendations: imageAnalysis.plant_recommendations || imageAnalysis.recommendations || [],
        soilRecommendations: soilId ? (soilAnalysis.soil_recommendations || soilAnalysis.recommendations || []) : [],
        allRecommendations: [
          ...(imageAnalysis.plant_recommendations || imageAnalysis.recommendations || []),
          ...(soilId ? (soilAnalysis.soil_recommendations || soilAnalysis.recommendations || []) : [])
        ],
        soilIssues: soilId ? (soilAnalysis.soil_issues || []) : [],
        modelUsed: 'huggingface-ml-service',
        inferenceTime: (imageAnalysis.inference_time || 0) + (soilAnalysis.inference_time || 0),
        timestamp: new Date().toISOString(),
        user_id: userId,
        image_id: imageId,
        soil_id: soilId,
        mode: mode,
        has_soil_data: has_soil_data
      };

    } catch (error) {
      console.error('❌ Integrated analysis failed:', error);
      return this.getIntegratedFallbackAnalysis(imageAnalysis, soilAnalysis, error.message);
    }
  }

  // ============ HELPER METHODS ============

  calculateCombinedConfidence(imageAnalysis, soilAnalysis) {
    if (!imageAnalysis?.confidence_score && !soilAnalysis?.confidence_score) return null;
    if (!imageAnalysis?.confidence_score) return soilAnalysis.confidence_score;
    if (!soilAnalysis?.confidence_score) return imageAnalysis.confidence_score;
    return (imageAnalysis.confidence_score + soilAnalysis.confidence_score) / 2;
  }

  calculateOverallHealth(imageAnalysis, soilAnalysis) {
    if (!imageAnalysis?.health_status && !soilAnalysis?.soil_status) return 'Unknown';
    if (!imageAnalysis?.health_status) return soilAnalysis.soil_status;
    if (!soilAnalysis?.soil_status) return imageAnalysis.health_status;
    
    const healthLevels = {
      'Critical': 0, 'Very Poor': 0, 'Poor': 1, 'Needs Attention': 1, 'Low': 1,
      'Moderate': 2, 'Average': 2, 'Good': 3, 'Healthy': 3, 'Excellent': 4
    };
    
    const imageLevel = healthLevels[imageAnalysis.health_status] ?? 2;
    const soilLevel = healthLevels[soilAnalysis.soil_status] ?? 2;
    
    return imageLevel <= soilLevel ? imageAnalysis.health_status : soilAnalysis.soil_status;
  }

  calculateHealthScore(overallHealth) {
    const scores = {
      'Excellent': 90, 'Good': 75, 'Average': 60, 'Needs Attention': 40,
      'Critical': 20, 'Low': 30, 'Poor': 25, 'Very Poor': 15, 'Unknown': 50
    };
    return scores[overallHealth] || 50;
  }

  getImageFallbackAnalysis(error) {
    return {
      success: false,
      tomato_type: 'Unknown',
      health_status: 'Unknown',
      disease_type: 'Unknown',
      confidence_score: 0,
      plant_health_score: 0,
      plant_recommendations: ['Analysis failed: ' + error],
      soil_recommendations: [],
      soil_issues: [],
      disease: 'Unknown',
      confidence: 0,
      is_tomato: false,
      top_predictions: [],
      features: [],
      model_used: 'fallback',
      inference_time: 0,
      error: error,
      timestamp: new Date().toISOString()
    };
  }

  getSoilFallbackAnalysis(error) {
    return {
      success: false,
      soil_status: 'Unknown',
      soil_health_score: 0,
      confidence_score: 0,
      soil_issues: ['Analysis failed: ' + error],
      soil_recommendations: ['Please try again later.'],
      soil_quality_score: 0,
      parameter_scores: {},
      soil_parameters: {},
      model_used: 'fallback',
      inference_time: 0,
      error: error,
      timestamp: new Date().toISOString()
    };
  }

  getIntegratedFallbackAnalysis(imageAnalysis, soilAnalysis, error) {
    return {
      success: false,
      diseaseType: 'Unknown',
      confidence: 0,
      plantType: 'Unknown',
      soilHealth: 'Unknown',
      healthScore: 0,
      overallHealth: 'Unknown',
      plantRecommendations: imageAnalysis?.plant_recommendations || [],
      soilRecommendations: soilAnalysis?.soil_recommendations || [],
      soilIssues: soilAnalysis?.soil_issues || [],
      modelUsed: 'fallback',
      inferenceTime: 0,
      timestamp: new Date().toISOString(),
      error: error
    };
  }

  cleanupTempFile(filePath) {
    try {
      if (filePath && filePath.startsWith(this.tempDir)) {
        fs.unlink(filePath, (err) => {
          if (!err) console.log('🧹 Cleaned up temp file:', filePath);
        });
      }
    } catch (error) {
      // Ignore cleanup errors
    }
  }

  /**
   * Health check for ML service
   */
  healthCheck() {
    return {
      initialized: this.initialized,
      model_loaded: this.model_loaded,
      runtime: this.runtime,
      ml_api_url: this.mlApiUrl,
      class_count: this.class_count,
      javascript_late_fusion: 'disabled',
      storage_handled_by: 'python_ml_service',
      timestamp: new Date().toISOString()
    };
  }
}

// Create singleton instance
const mlServiceInstance = new MLService();

module.exports = mlServiceInstance;
