// src/services/mlService.js
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const supabaseService = require('./supabaseService');
const LateFusionService = require('./lateFusionService');
const https = require('https');

class MLService {
  constructor() {
    this.initialized = false;
    this.model_loaded = false;
    this.runtime = 'nodejs';
    this.supports_tflite = false;
    this.class_count = 0;
    
    // Handle paths correctly in production
    this.pythonScriptsPath = path.join(__dirname, '..', '..', 'python_scripts');
    
    // Use /tmp for temp files in production (Render has writable /tmp)
    this.tempDir = process.env.NODE_ENV === 'production' 
      ? '/tmp/tomato-ai-temp'
      : path.join(__dirname, '..', '..', 'temp');
    
    this.lateFusionService = new LateFusionService();
    
    this.supabase = supabaseService;
    
    // Create temp directory if it doesn't exist
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
    
    console.log(`📁 MLService temp directory: ${this.tempDir}`);
  }

  async initialize() {
    try {
      console.log('🤖 Initializing ML Service...');
      
      if (this.initialized) {
        console.log('✅ ML Service already initialized');
        return {
          initialized: true,
          model_loaded: this.model_loaded,
          runtime: this.runtime
        };
      }
      
      const pythonCheck = await this.checkPythonEnvironment();
      if (!pythonCheck.available) {
        console.warn('⚠️ Python environment not available, using fallback mode');
        this.initialized = true;
        this.model_loaded = false;
        return {
          initialized: true,
          model_loaded: false,
          runtime: 'fallback',
          warning: 'Python environment not available'
        };
      }

      console.log('✅ Python environment ready');
      
      const tomatoScriptPath = path.join(this.pythonScriptsPath, 'tomato_prediction.py');
      if (!fs.existsSync(tomatoScriptPath)) {
        console.error('❌ Tomato prediction script not found:', tomatoScriptPath);
        this.initialized = true;
        this.model_loaded = false;
        return {
          initialized: true,
          model_loaded: false,
          runtime: 'fallback',
          error: 'Tomato prediction script not found'
        };
      }
      
      console.log('✅ Tomato prediction script found');
      
      // Check if model files exist
      const modelPath = path.join(this.pythonScriptsPath, 'models', 'plant_disease_mobilenetv2.h5');
      if (fs.existsSync(modelPath)) {
        console.log('✅ Plant disease model found');
        this.model_loaded = true;
      } else {
        console.warn('⚠️ Plant disease model not found, using fallback');
        this.model_loaded = false;
      }
      
      this.initialized = true;
      this.class_count = 6;
      
      console.log('✅ ML Service initialized successfully');
      
      return {
        initialized: true,
        model_loaded: this.model_loaded,
        runtime: this.runtime,
        class_count: this.class_count,
        scripts_available: {
          tomato_predictor: true,
          soil_analyzer: fs.existsSync(path.join(this.pythonScriptsPath, 'soil_prediction.py'))
        },
        models_available: {
          plant_disease: this.model_loaded,
          soil_regressor: fs.existsSync(path.join(this.pythonScriptsPath, 'models', 'soil_regressor_rf.pkl'))
        }
      };
    } catch (error) {
      console.error('❌ ML Service initialization failed:', error);
      this.initialized = true;
      this.model_loaded = false;
      return {
        initialized: true,
        model_loaded: false,
        runtime: 'fallback',
        error: error.message
      };
    }
  }

  async ensureInitialized() {
    if (!this.initialized) {
      console.log('🔄 ML Service not initialized, auto-initializing...');
      await this.initialize();
    }
    
    if (!this.model_loaded) {
      console.warn('⚠️ ML Service in fallback mode - no model loaded');
    }
    
    return this.initialized;
  }

  async checkPythonEnvironment() {
    return new Promise((resolve) => {
      const python = spawn('python', ['-c', `
import sys
try:
    import tensorflow as tf
    import numpy as np
    import joblib
    import pandas as pd
    from PIL import Image
    print("SUCCESS:All dependencies available")
except ImportError as e:
    print(f"ERROR:{e}")
      `]);

      let output = '';
      python.stdout.on('data', (data) => {
        output += data.toString();
      });

      python.stderr.on('data', (data) => {
        output += data.toString();
      });

      python.on('close', (code) => {
        if (code === 0 && output.includes('SUCCESS')) {
          resolve({ available: true });
        } else {
          resolve({ available: false, error: output });
        }
      });

      python.on('error', (error) => {
        resolve({ available: false, error: error.message });
      });
    });
  }

  async analyzeImage(imageData, userId, imageId) {
    try {
      console.log('🤖 Starting image analysis for disease identification...');
      
      if (!this.initialized) {
        console.log('🔄 ML Service not initialized, initializing now...');
        await this.initialize();
      }
      
      if (!this.model_loaded) {
        console.warn('⚠️ No ML model loaded, using fallback analysis');
        return this.getImageFallbackAnalysis('No ML model loaded');
      }

      let imagePath = await this.getImageLocalPath(imageData);
      
      if (!imagePath || !fs.existsSync(imagePath)) {
        throw new Error(`Image file not found: ${imagePath}`);
      }

      console.log('📁 Processing image:', imagePath);

      const classificationResult = await this.executeTomatoClassifier(imagePath, userId, imageId);
      
      if (imagePath.includes(this.tempDir)) {
        this.cleanupTempFile(imagePath);
      }

      if (!classificationResult.success) {
        throw new Error(classificationResult.error || 'Image classification failed');
      }

      console.log('✅ Image analysis completed:', {
        disease: classificationResult.disease_type,
        confidence: classificationResult.confidence_score,
        health_status: classificationResult.health_status
      });

      return {
        success: true,
        tomato_type: classificationResult.tomato_type,
        health_status: classificationResult.health_status,
        disease_type: classificationResult.disease_type,
        confidence_score: classificationResult.confidence_score,
        plant_health_score: classificationResult.plant_health_score,
        recommendations: classificationResult.recommendations || [],
        disease: classificationResult.disease_type,
        confidence: classificationResult.confidence_score,
        is_tomato: classificationResult.is_tomato,
        top_predictions: classificationResult.top_predictions,
        features: classificationResult.features,
        model_used: classificationResult.model_used,
        inference_time: classificationResult.inference_time,
        timestamp: new Date().toISOString(),
        user_id: userId,
        image_id: imageId
      };

    } catch (error) {
      console.error('❌ Image analysis failed:', error);
      return this.getImageFallbackAnalysis(error.message);
    }
  }

  async analyzeBatchImages(imageDataList, userId, soilAnalysis = null, options = {}) {
    try {
        console.log(`🤖 Processing batch of ${imageDataList.length} images for user ${userId}`);
        
        if (!this.initialized) {
            console.log('🔄 ML Service not initialized, initializing now...');
            await this.initialize();
        }
        
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
                    
                    // Structure the result with all necessary fields
                    const structuredResult = {
                        success: true,
                        image_id: imageData.image_id,
                        tomato_type: imageResult.tomato_type || 'Unknown',
                        health_status: imageResult.health_status || 'Unknown',
                        disease_type: imageResult.disease_type || 'Unknown',
                        confidence_score: imageResult.confidence_score || 0.5,
                        plant_health_score: imageResult.plant_health_score,
                        recommendations: imageResult.recommendations || [],
                        plant_recommendations: imageResult.recommendations || [], // For separate storage
                        overall_health: imageResult.overall_health || imageResult.health_status || 'Unknown',
                        batch_index: i
                    };
                    
                    results.push(structuredResult);
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
        
        // Store all results in a single batch operation (NO individual storage)
        console.log('💾 Storing all batch results in one operation...');
        
        const batchFusionResult = await this.lateFusionService.performBatchFusion(
            results.filter(r => r.success), // Only successful results
            userId,
            soilAnalysis,
            {
                batch_timestamp: batch_timestamp,
                mode: soilAnalysis ? 'batch_integrated' : 'batch_image_only',
                has_soil_data: !!soilAnalysis
            }
        );
        
        console.log(`✅ Stored ${batchFusionResult.total_stored} batch analysis results with timestamp: ${batch_timestamp}`);
        
        return {
            success: true,
            successful_predictions,
            failed_predictions,
            results: batchFusionResult.inserted,
            failed_results: batchFusionResult.failed,
            total_images: imageDataList.length,
            batch_timestamp: batch_timestamp,
            batch_id: batch_timestamp
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

  async getImageLocalPath(imageData) {
    try {
      if (typeof imageData === 'string' && fs.existsSync(imageData)) {
        return imageData;
      }

      if (imageData.publicUrl) {
        return await this.downloadImageFromUrl(imageData.publicUrl);
      }

      if (imageData.image_path) {
        const publicUrl = await this.getImagePublicUrl(imageData.image_path);
        if (publicUrl) {
          return await this.downloadImageFromUrl(publicUrl);
        }
      }

      throw new Error('Cannot resolve image to local path');
    } catch (error) {
      console.error('❌ Error getting image local path:', error);
      throw error;
    }
  }

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

  async downloadImageFromUrl(imageUrl) {
    return new Promise((resolve, reject) => {
      const filename = `temp_image_${Date.now()}.jpg`;
      const filePath = path.join(this.tempDir, filename);
      
      console.log('📥 Downloading image to:', filePath);
      
      const file = fs.createWriteStream(filePath);
      
      const agent = new https.Agent({ rejectUnauthorized: false }); // For self-signed certs if any
      
      https.get(imageUrl, { agent }, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download image: HTTP ${response.statusCode}`));
          return;
        }

        response.pipe(file);
        
        file.on('finish', () => {
          file.close();
          console.log('✅ Image downloaded successfully');
          resolve(filePath);
        });
      }).on('error', (err) => {
        fs.unlink(filePath, () => {});
        reject(new Error(`Failed to download image: ${err.message}`));
      });
    });
  }

  async executeTomatoClassifier(imagePath, userId, imageId) {
    return new Promise(async (resolve) => {
      const pythonScript = path.join(this.pythonScriptsPath, 'tomato_prediction.py');
      
      if (!fs.existsSync(pythonScript)) {
        console.error('❌ Tomato prediction script not found:', pythonScript);
        resolve({
          success: false,
          error: 'Tomato prediction script not found'
        });
        return;
      }
      
      console.log('🔍 Running tomato classifier for disease identification...');
      
      let tomatoConfig;
      try {
        tomatoConfig = await this.fetchTomatoPredictionThresholds();
        console.log('✅ Using tomato configuration from database');
      } catch (error) {
        console.error('❌ Failed to fetch tomato config, using defaults:', error);
        tomatoConfig = this.getDefaultTomatoConfig();
      }
      
      const inputData = {
        image_path: imagePath,
        user_id: userId,
        image_id: imageId,
        tomato_config: tomatoConfig
      };

      console.log('📤 Sending tomato config to Python:', {
        confidence_threshold: tomatoConfig.confidence_threshold,
        has_disease_recommendations: Object.keys(tomatoConfig.disease_recommendations).length > 0
      });

      const env = { 
        ...process.env, 
        TF_ENABLE_ONEDNN_OPTS: '0',
        PYTHONIOENCODING: 'utf-8',
        PYTHONPATH: this.pythonScriptsPath // Add Python path for imports
      };
      
      const python = spawn('python', [pythonScript], { env });
      
      let output = '';
      let errorOutput = '';

      python.stdin.write(JSON.stringify(inputData));
      python.stdin.end();

      python.stdout.on('data', (data) => {
        output += data.toString('utf8');
      });

      python.stderr.on('data', (data) => {
        const errorData = data.toString('utf8');
        errorOutput += errorData;
        console.error('🐍 Python stderr:', errorData.trim());
      });

      python.on('close', (code) => {
        console.log(`🐍 Tomato classifier exited with code ${code}`);
        
        if (code === 0) {
          try {
            let result;
            try {
              result = JSON.parse(output);
            } catch (parseError) {
              const jsonMatch = output.match(/\{.*\}/s);
              if (jsonMatch) {
                result = JSON.parse(jsonMatch[0]);
              } else {
                throw new Error('No valid JSON found in output');
              }
            }
            
            resolve(result);
          } catch (parseError) {
            console.error('❌ Failed to parse Python output:', parseError);
            console.error('Raw output:', output);
            resolve({
              success: false,
              error: `Failed to parse Python output: ${parseError.message}`
            });
          }
        } else {
          console.error('❌ Python script failed with error:', errorOutput);
          resolve({
            success: false,
            error: `Python script failed with code ${code}: ${errorOutput}`
          });
        }
      });

      python.on('error', (error) => {
        console.error('❌ Failed to start Python process:', error);
        resolve({
          success: false,
          error: `Failed to start Python process: ${error.message}`
        });
      });

      // Set timeout to prevent hanging
      setTimeout(() => {
        if (!python.killed) {
          python.kill();
          resolve({
            success: false,
            error: 'Image analysis timeout'
          });
        }
      }, 60000); // 60 second timeout
    });
  }

  async analyzeSoil(soilData, userId, soilId) {
    try {
      console.log('🌱 Starting soil analysis...');
      
      if (!this.initialized) {
        console.log('🔄 ML Service not initialized, initializing now...');
        await this.initialize();
      }

      console.log('📊 Soil data to analyze:', soilData);

      let optimalRanges;
      try {
        optimalRanges = await this.fetchOptimalRanges();
        console.log('📊 Optimal ranges fetched from database:', Object.keys(optimalRanges));
      } catch (dbError) {
        console.error('❌ Database fetch failed, using fallback ranges:', dbError.message);
        optimalRanges = this.getDefaultOptimalRanges();
      }

      const soilResult = await this.executeSoilPrediction(soilData, optimalRanges, userId, soilId);
      
      if (!soilResult.success) {
        throw new Error(soilResult.error || 'Soil analysis failed');  
      }

      console.log('✅ Soil analysis completed:', {
        soil_status: soilResult.soil_status,
        health_score: soilResult.soil_quality_score,
        soil_issues_count: soilResult.soil_issues?.length || 0
      });

      return {
        success: true,
        soil_status: soilResult.soil_status,
        confidence_score: soilResult.confidence_score,
        soil_issues: soilResult.soil_issues || [],
        recommendations: soilResult.recommendations || [],
        soil_quality_score: soilResult.soil_quality_score,
        parameter_scores: soilResult.parameter_scores,
        soil_parameters: soilResult.soil_parameters,
        model_used: soilResult.model_used,
        inference_time: soilResult.inference_time,
        timestamp: new Date().toISOString(),
        user_id: userId,
        soil_id: soilId
      };

    } catch (error) {
      console.error('❌ Soil analysis failed:', error);
      return this.getSoilFallbackAnalysis(error.message);
    }
  }

  async executeSoilPrediction(soilData, optimalRanges, userId, soilId) {
    return new Promise((resolve) => {
      const pythonScript = path.join(this.pythonScriptsPath, 'soil_prediction.py');
      
      if (!fs.existsSync(pythonScript)) {
        console.error('❌ Soil prediction script not found:', pythonScript);
        resolve({
          success: false,
          error: 'Soil prediction script not found'
        });
        return;
      }
      
      console.log('🔍 Running soil prediction...');
      
      const requiredSoilFields = ['ph_level', 'temperature', 'moisture', 'nitrogen', 'phosphorus', 'potassium'];
      const filteredSoilData = {};
      
      for (const field of requiredSoilFields) {
        if (field in soilData) {
          filteredSoilData[field] = soilData[field];
        } else {
          console.error(`❌ Missing required soil field: ${field}`);
          resolve({
            success: false,
            error: `Missing required soil field: ${field}`
          });
          return;
        }
      }
      
      const inputData = {
        soil_data: filteredSoilData,
        optimal_ranges: optimalRanges,
        user_id: userId,
        soil_id: soilId
      };

      const env = { 
        ...process.env, 
        PYTHONIOENCODING: 'utf-8',
        PYTHONPATH: this.pythonScriptsPath
      };

      const python = spawn('python', [pythonScript], { env });
      
      let output = '';
      let errorOutput = '';

      python.stdin.write(JSON.stringify(inputData));
      python.stdin.end();

      python.stdout.on('data', (data) => {
        output += data.toString('utf8');
      });

      python.stderr.on('data', (data) => {
        const errorData = data.toString('utf8');
        errorOutput += errorData;
        console.error('🐍 Python stderr:', errorData.trim());
      });

      python.on('close', (code) => {
        console.log(`🐍 Soil prediction exited with code ${code}`);
        
        if (code === 0) {
          try {
            let result;
            try {
              result = JSON.parse(output);
            } catch (parseError) {
              const jsonMatch = output.match(/\{.*\}/s);
              if (jsonMatch) {
                result = JSON.parse(jsonMatch[0]);
              } else {
                throw new Error('No valid JSON found in output');
              }
            }
            
            resolve(result);
          } catch (parseError) {
            console.error('❌ Failed to parse soil analysis output:', parseError);
            resolve({
              success: false,
              error: `Failed to parse soil analysis output: ${parseError.message}`
            });
          }
        } else {
          console.error('❌ Python error output:', errorOutput);
          resolve({
            success: false,
            error: `Soil analysis failed: ${errorOutput}`
          });
        }
      });

      python.on('error', (error) => {
        console.error('❌ Failed to start Python process:', error);
        resolve({
          success: false,
          error: `Failed to start Python process: ${error.message}`
        });
      });

      setTimeout(() => {
        if (!python.killed) {
          python.kill();
          resolve({
            success: false,
            error: 'Soil analysis timeout'
          });
        }
      }, 60000);
    });
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
            "Ensure the image is well-lit and focused on the plant part.",
            "Try taking the photo from a closer distance.",
            "Make sure the background is not too cluttered."
          ],
          non_tomato_recommendations: [
            "This does not appear to be a tomato plant.",
            "Please upload clear images of tomato leaves or fruits.",
            "Ensure proper identification of the plant."
          ],
          health_status_recommendations: {
            "Healthy": [
              "Continue current care practices.",
              "Monitor plants weekly for early signs.",
              "Maintain optimal growing conditions."
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
          "Ensure the image is well-lit and focused on the plant part.",
          "Try taking the photo from a closer distance.",
          "Make sure the background is not too cluttered."
        ],
        non_tomato_recommendations: [
          "This does not appear to be a tomato plant.",
          "Please upload clear images of tomato leaves or fruits.",
          "Ensure proper identification of the plant."
        ],
        health_status_recommendations: {
          "Healthy": [
            "Continue current care practices.",
            "Monitor plants weekly for early signs.",
            "Maintain optimal growing conditions."
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

  async fetchOptimalRanges() {
    try {
        console.log('📊 Fetching optimal ranges from Supabase...');
        
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

        const { data: rangesData, error: rangesError } = await supabaseClient
            .from('optimal_ranges')
            .select('parameter, optimal_min, optimal_max, unit')
            .eq('crop_type', 'tomato');
        
        if (rangesError) throw rangesError;
        
        const { data: qualityData, error: qualityError } = await supabaseClient
            .from('soil_quality_thresholds')
            .select('thresholds, labels')
            .eq('crop_type', 'tomato')
            .limit(1);
        
        if (qualityError) throw qualityError;
        
        const { data: recommendationsData, error: recError } = await supabaseClient
            .from('soil_recommendations')
            .select('parameter, condition_type, recommendation, severity')
            .eq('crop_type', 'tomato')
            .eq('is_active', true);
        
        if (recError) console.warn('⚠️ Could not fetch soil recommendations:', recError.message);
        
        const optimalRanges = {};
        
        rangesData.forEach(row => {
            optimalRanges[row.parameter] = {
                optimal: [parseFloat(row.optimal_min), parseFloat(row.optimal_max)],
                unit: row.unit || ''
            };
        });
        
        optimalRanges.moisture_threshold = {
            optimal: [20, 0],
            unit: '%'
        };
        
        optimalRanges.quality_thresholds = {
            thresholds: qualityData[0].thresholds,
            labels: qualityData[0].labels
        };
        
        if (recommendationsData?.length > 0) {
            optimalRanges.soil_recommendations = {};
            
            recommendationsData.forEach(rec => {
                if (!optimalRanges.soil_recommendations[rec.parameter]) {
                    optimalRanges.soil_recommendations[rec.parameter] = {};
                }
                optimalRanges.soil_recommendations[rec.parameter][rec.condition_type] = {
                    recommendation: rec.recommendation,
                    severity: rec.severity || 'Warning'
                };
            });
        } else {
            optimalRanges.soil_recommendations = this.getFallbackSoilRecommendations();
        }
        
        optimalRanges.metadata = {
            fetched_at: new Date().toISOString(),
            ranges_count: rangesData.length,
            recommendations_count: recommendationsData?.length || 0,
            has_quality_thresholds: true,
            source: 'database'
        };
        
        return optimalRanges;
        
    } catch (error) {
        console.error('❌ Failed to fetch optimal ranges:', error.message);
        return this.getFallbackOptimalRanges();
    }
  }

  getFallbackOptimalRanges() {
    return {
        'ph_level': { optimal: [6.0, 7.0], unit: 'pH' },
        'temperature': { optimal: [20, 30], unit: '°C' },
        'moisture': { optimal: [60, 80], unit: '%' },
        'nitrogen': { optimal: [40, 60], unit: 'mg/kg' },
        'phosphorus': { optimal: [30, 50], unit: 'mg/kg' },
        'potassium': { optimal: [40, 60], unit: 'mg/kg' },
        'moisture_threshold': { optimal: [20, 0], unit: '%' },
        'quality_thresholds': {
            thresholds: [80.0, 60.0, 40.0, 20.0],
            labels: ['Excellent', 'Good', 'Average', 'Needs Attention', 'Critical']
        },
        'soil_recommendations': this.getFallbackSoilRecommendations(),
        'metadata': {
            fetched_at: new Date().toISOString(),
            ranges_count: 7,
            recommendations_count: Object.keys(this.getFallbackSoilRecommendations()).length,
            has_quality_thresholds: true,
            source: 'fallback'
        }
    };
  }

  getFallbackSoilRecommendations() {
    return {
        'moisture': {
            'dry_soil': {
                recommendation: 'URGENT: Soil too dry for NPK measurement - Moisturize soil to at least {threshold}{unit} and retake readings.',
                severity: 'Critical'
            },
            'low': {
                recommendation: 'Increase watering frequency to raise moisture to optimal range',
                severity: 'Warning'
            },
            'high': {
                recommendation: 'Improve drainage to reduce moisture to optimal range',
                severity: 'Warning'
            }
        },
        'ph_level': {
            'low': {
                recommendation: 'Apply agricultural lime to raise soil pH. Low pH locks out nutrients.',
                severity: 'Moderate'
            },
            'high': {
                recommendation: 'Apply elemental sulfur to lower soil pH. High pH locks out nutrients.',
                severity: 'Moderate'
            },
            'nutrient_lockout': {
                recommendation: 'Fix pH before fertilizing - Current pH makes nutrients unavailable.',
                severity: 'Critical'
            }
        },
        'temperature': {
            'low': {
                recommendation: 'Use row covers or black plastic mulch to increase soil temperature',
                severity: 'Moderate'
            },
            'high': {
                recommendation: 'Provide shade or use reflective mulch to reduce soil temperature',
                severity: 'Moderate'
            }
        },
        'nitrogen': {
            'low': {
                recommendation: 'Apply nitrogen-rich fertilizer (urea) - Estimated deficit: {deficit}{unit}',
                severity: 'Moderate'
            },
            'high': {
                recommendation: 'Reduce nitrogen - Current level may cause excessive growth',
                severity: 'Warning'
            }
        },
        'phosphorus': {
            'low': {
                recommendation: 'Apply phosphorus fertilizer (superphosphate) - Estimated deficit: {deficit}{unit}',
                severity: 'Moderate'
            },
            'high': {
                recommendation: 'Avoid additional phosphorus this season',
                severity: 'Warning'
            }
        },
        'potassium': {
            'low': {
                recommendation: 'Apply potassium fertilizer (potassium sulfate) - Estimated deficit: {deficit}{unit}',
                severity: 'Moderate'
            },
            'high': {
                recommendation: 'Reduce potassium application',
                severity: 'Warning'
            }
        }
    };
  }

  getDefaultOptimalRanges() {
    return {
      ph_level: { optimal: [6.0, 7.0], unit: 'pH' },
      temperature: { optimal: [20, 30], unit: '°C' },
      moisture: { optimal: [60, 80], unit: '%' },
      nitrogen: { optimal: [40, 60], unit: 'mg/kg' },
      phosphorus: { optimal: [30, 50], unit: 'mg/kg' },
      potassium: { optimal: [40, 60], unit: 'mg/kg' }
    };
  }

  async integratedAnalysis(imageAnalysis, soilAnalysis, userId, imageId, soilId, options = {}) {
    try {
      console.log('🔗 Starting integrated analysis...');

      if (!imageAnalysis.success) {
        throw new Error('Image analysis failed: ' + imageAnalysis.error);
      }

      if (soilId && !soilAnalysis.success) {
        throw new Error('Soil analysis failed: ' + soilAnalysis.error);
      }

      const mode = soilId ? 'integrated' : 'image_only';
      const has_soil_data = !!soilId;
      const skipStorage = options.skipStorage || false; // Flag to skip storage (for batch)
      
      const finalSoilAnalysis = soilId ? soilAnalysis : {
        success: true,
        soil_status: null,
        soil_quality_score: null,
        confidence_score: null,
        soil_issues: [],
        recommendations: []
      };
      
      let fusedResult;
      
      if (skipStorage) {
        // Just prepare the result without storing (will be stored in batch later)
        console.log('⏭️ Skipping individual storage (will be stored in batch)');
        fusedResult = {
          prediction_id: null,
          disease_type: imageAnalysis.disease_type,
          tomato_type: imageAnalysis.tomato_type,
          soil_status: finalSoilAnalysis.soil_status,
          combined_confidence_score: this.calculateCombinedConfidence(imageAnalysis, finalSoilAnalysis),
          overall_health: this.calculateOverallHealth(imageAnalysis, finalSoilAnalysis),
          date_predicted: new Date().toISOString()
        };
      } else {
        // Store immediately (for single analysis)
        fusedResult = await this.lateFusionService.fuseSinglePair(
          imageAnalysis, 
          finalSoilAnalysis, 
          userId, 
          imageId, 
          soilId,
          {
            mode: mode,
            has_soil_data: has_soil_data,
            batch_index: options.batch_index,
            batch_timestamp: options.batch_timestamp
          }
        );
      }

      return {
        success: true,
        prediction_id: fusedResult.prediction_id,
        diseaseType: fusedResult.disease_type,
        confidence: parseFloat(fusedResult.combined_confidence_score) || 0,
        plantType: fusedResult.tomato_type,
        soilHealth: fusedResult.soil_status,
        healthScore: this.calculateHealthScore(fusedResult.overall_health),
        overallHealth: fusedResult.overall_health,
        plantRecommendations: imageAnalysis.recommendations || [],
        soilRecommendations: soilId ? (soilAnalysis.recommendations || []) : [],
        allRecommendations: [
          ...(imageAnalysis.recommendations || []),
          ...(soilId ? (soilAnalysis.recommendations || []) : [])
        ],
        soilIssues: soilId ? (soilAnalysis.soil_issues || []) : [],
        modelUsed: 'late_fusion',
        inferenceTime: (imageAnalysis.inference_time || 0) + (soilAnalysis.inference_time || 0),
        timestamp: fusedResult.date_predicted,
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

  getIntegratedFallbackAnalysis(imageAnalysis, soilAnalysis, error) {
    return {
      success: false,
      diseaseType: 'Unknown',
      confidence: 0,
      plantType: 'Unknown',
      soilHealth: 'Unknown',
      healthScore: 0,
      overallHealth: 'Unknown',
      recommendations: ['Analysis failed: ' + error],
      soilIssues: ['Analysis failed'],
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
          if (!err) console.log('🧹 Cleaned up temp file');
        });
      }
    } catch (error) {
      // Ignore cleanup errors
    }
  }

  getImageFallbackAnalysis(error) {
    return {
      success: false,
      tomato_type: 'Unknown',
      health_status: 'Unknown',
      disease_type: 'Unknown',
      confidence_score: 0,
      plant_health_score: 0,
      recommendations: ['Fallback: ' + error],
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
      recommendations: ['Check system configuration'],
      soil_quality_score: 0,
      parameter_scores: {},
      soil_parameters: {},
      model_used: 'fallback',
      inference_time: 0,
      error: error,
      timestamp: new Date().toISOString()
    };
  }

  healthCheck() {
    return {
      initialized: this.initialized,
      model_loaded: this.model_loaded,
      runtime: this.runtime,
      supports_tflite: this.supports_tflite,
      class_count: this.class_count,
      temp_dir: this.tempDir,
      python_scripts_path: this.pythonScriptsPath,
      timestamp: new Date().toISOString()
    };
  }
}

const mlServiceInstance = new MLService();

// Auto-initialize when imported
mlServiceInstance.initialize().then(result => {
  console.log('🤖 ML Service auto-initialized:', result);
}).catch(error => {
  console.error('❌ ML Service auto-initialization failed:', error);
});

module.exports = mlServiceInstance;