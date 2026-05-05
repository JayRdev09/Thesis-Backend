// lateFusionService.js - MODIFIED TO DISABLE STORAGE (Python handles it)
const supabaseService = require('./supabaseService');

class LateFusionService {
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

  // Helper method to extract and format recommendations
  _extractRecommendations(result, type = 'plant') {
    if (!result) return null;
    
    console.log(`🔍 Extracting ${type} recommendations from:`, {
      has_recommendations: 'recommendations' in result,
      recommendations_type: typeof result.recommendations,
      is_array: Array.isArray(result.recommendations),
      recommendations_value: result.recommendations
    });
    
    let recommendations = null;
    
    if (type === 'plant' && result.plant_recommendations) {
      recommendations = result.plant_recommendations;
    }
    else if (type === 'soil' && result.soil_recommendations) {
      recommendations = result.soil_recommendations;
    }
    else if (result.recommendations) {
      recommendations = result.recommendations;
    }
    
    if (!recommendations && result.data?.recommendations) {
      recommendations = result.data.recommendations;
    }
    
    if (!recommendations) return null;
    
    if (typeof recommendations === 'string') {
      return recommendations.trim() || null;
    }
    
    if (Array.isArray(recommendations)) {
      const validRecs = recommendations.filter(rec => 
        rec && typeof rec === 'string' && rec.trim().length > 0
      );
      return validRecs.length > 0 ? validRecs.join('; ') : null;
    }
    
    if (recommendations.recommendation) {
      return recommendations.recommendation;
    }
    
    return null;
  }

  // Helper method to extract soil issues
  _extractSoilIssues(soilAnalysis) {
    if (!soilAnalysis) return null;
    
    console.log('🔍 Extracting soil issues from:', {
      has_soil_issues: 'soil_issues' in soilAnalysis,
      issues_value: soilAnalysis.soil_issues
    });
    
    let issues = soilAnalysis.soil_issues || 
                 soilAnalysis.data?.soil_issues || 
                 soilAnalysis.issues;
    
    if (!issues) return null;
    
    if (typeof issues === 'string') {
      return issues.trim() || null;
    }
    
    if (Array.isArray(issues)) {
      const validIssues = issues.filter(issue => 
        issue && typeof issue === 'string' && issue.trim().length > 0
      );
      return validIssues.length > 0 ? validIssues.join('; ') : null;
    }
    
    return null;
  }

  async fuseSinglePair(imageAnalysis, soilAnalysis, userId, imageId, soilId, options = {}) {
    try {
      console.log('🔄 Performing late fusion for single pair...');
      
      const {
        batch_index = null,
        batch_timestamp = null,
        mode = soilId ? 'integrated' : 'image_only',
        has_soil_data = !!soilId
      } = options;

      // Extract recommendations with proper formatting
      const plantRecommendations = this._extractRecommendations(imageAnalysis, 'plant');
      const soilRecommendations = soilAnalysis ? this._extractRecommendations(soilAnalysis, 'soil') : null;
      const soilIssues = soilAnalysis ? this._extractSoilIssues(soilAnalysis) : null;

      // Extract plant health score
      let plantHealthScore = imageAnalysis?.plant_health_score;
      if (plantHealthScore === null || plantHealthScore === undefined) {
        if (imageAnalysis?.health_status === 'Healthy') {
          plantHealthScore = 95;
        } else if (imageAnalysis?.health_status === 'Unhealthy') {
          plantHealthScore = 45;
        } else {
          plantHealthScore = 60;
        }
        console.log(`⚠️ Plant health score missing, using default: ${plantHealthScore}`);
      }

      // Extract soil quality score
      let soilQualityScore = soilAnalysis?.soil_quality_score;
      if (soilQualityScore === null || soilQualityScore === undefined) {
        soilQualityScore = 50;
        console.log(`⚠️ Soil quality score missing, using default: ${soilQualityScore}`);
      }

      // Calculate combined confidence
      const combinedConfidence = this.calculateCombinedConfidence(imageAnalysis, soilAnalysis);
      const overallHealth = this.calculateOverallHealth(imageAnalysis, soilAnalysis);

      console.log('📝 FUSION RESULTS (Python service will handle storage):', {
        plant_rec_count: plantRecommendations ? (plantRecommendations.split('; ').length) : 0,
        soil_rec_count: soilRecommendations ? (soilRecommendations.split('; ').length) : 0,
        plant_health_score: plantHealthScore,
        soil_quality_score: soilQualityScore,
        combined_confidence: combinedConfidence,
        overall_health: overallHealth
      });

      // ⚠️ IMPORTANT: DO NOT STORE IN DATABASE HERE
      // The Python ML service handles storage via auto-fusion
      // This prevents duplicate records
      
      console.log('✅ Late fusion complete - storage handled by Python ML service');
      console.log('   💡 To enable storage here, set STORAGE_MODE=python in environment');
      
      // Return the fused data without storing to database
      return {
        success: true,
        stored_by: 'python_service',
        fusion_results: {
          plant_health_score: plantHealthScore,
          soil_quality_score: soilQualityScore,
          combined_confidence_score: combinedConfidence,
          overall_health: overallHealth,
          plant_recommendations: plantRecommendations,
          soil_recommendations: soilRecommendations,
          soil_issues: soilIssues
        },
        prediction_id: null // No storage here
      };

    } catch (error) {
      console.error('❌ Late fusion failed:', error);
      throw error;
    }
  }

  async performBatchFusion(results, userId, soilAnalysis, options = {}) {
    try {
      console.log(`🔄 Performing batch fusion for ${results.length} results...`);
      console.log('⚠️ Batch storage is disabled - only Python service stores results');
      
      const fusedResults = [];
      
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        
        if (!result.success) {
          console.log(`⏭️ Skipping failed result for image ${result.image_id}`);
          continue;
        }

        // Just perform fusion without storage
        const fused = await this.fuseSinglePair(
          result,
          soilAnalysis,
          userId,
          result.image_id,
          soilAnalysis?.soil_id,
          {
            batch_index: i,
            batch_timestamp: options.batch_timestamp,
            mode: 'batch_fusion_only',
            has_soil_data: !!soilAnalysis
          }
        );
        
        fusedResults.push(fused);
      }

      console.log(`✅ Batch fusion completed for ${fusedResults.length} images (no storage)`);
      
      return {
        success: true,
        fused_results: fusedResults,
        total_processed: fusedResults.length,
        stored_by: 'python_service'
      };

    } catch (error) {
      console.error('❌ Batch fusion failed:', error);
      return {
        success: false,
        error: error.message,
        fused_results: []
      };
    }
  }

  // Alias for backward compatibility
  async performLateFusion(imageAnalysis, soilAnalysis, userId, imageId, soilId, options = {}) {
    return this.fuseSinglePair(imageAnalysis, soilAnalysis, userId, imageId, soilId, options);
  }

  calculateCombinedConfidence(imageAnalysis, soilAnalysis) {
    // Get confidences
    let plantConf = imageAnalysis?.confidence_score || imageAnalysis?.model_confidence || 0.5;
    let soilConf = soilAnalysis?.confidence_score || 0.5;
    
    // Convert percentages to decimals if needed
    if (plantConf > 1) plantConf = plantConf / 100;
    if (soilConf > 1) soilConf = soilConf / 100;
    
    // Quadratic weighted fusion (same as Python service)
    const totalConf = plantConf + soilConf;
    if (totalConf === 0) return 0.5;
    
    const combined = (plantConf * plantConf + soilConf * soilConf) / totalConf;
    
    console.log(`📊 Combined confidence calculation:`, {
      plant_conf: plantConf,
      soil_conf: soilConf,
      combined: combined
    });
    
    return combined;
  }

  calculateOverallHealth(imageAnalysis, soilAnalysis) {
    if (!imageAnalysis?.health_status && !soilAnalysis?.soil_status) return 'Unknown';
    if (!imageAnalysis?.health_status) return soilAnalysis.soil_status;
    if (!soilAnalysis?.soil_status) return imageAnalysis.health_status;
    
    const healthLevels = {
      'Critical': 0, 'Very Poor': 0, 'Poor': 1, 'Needs Attention': 1, 'Low': 1,
      'Moderate': 2, 'Average': 2, 'Good': 3, 'Healthy': 3, 'Excellent': 4,
      'Unhealthy': 1
    };
    
    const imageLevel = healthLevels[imageAnalysis.health_status] ?? 2;
    const soilLevel = healthLevels[soilAnalysis.soil_status] ?? 2;
    
    // Return the worse condition (lower level)
    return imageLevel <= soilLevel ? imageAnalysis.health_status : soilAnalysis.soil_status;
  }

  async getRecommendationsByPredictionId(predictionId) {
    try {
      const supabaseClient = this._getClient();

      const { data, error } = await supabaseClient
        .from('prediction_results')
        .select('prediction_id, plant_recommendations, soil_recommendations, plant_health_score, soil_quality_score')
        .eq('prediction_id', predictionId)
        .single();

      if (error) throw error;

      return {
        success: true,
        plant_recommendations: data.plant_recommendations ? 
          data.plant_recommendations.split('; ') : [],
        soil_recommendations: data.soil_recommendations ? 
          data.soil_recommendations.split('; ') : [],
        plant_health_score: data.plant_health_score,
        soil_quality_score: data.soil_quality_score
      };
    } catch (error) {
      console.error('❌ Failed to get recommendations:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = LateFusionService;