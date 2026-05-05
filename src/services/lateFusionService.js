// lateFusionService.js - MODIFIED TO NOT STORE RESULTS (Python handles storage)
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

      // Extract recommendations
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

      console.log('📝 Extracted data:', {
        plant_rec_count: plantRecommendations ? (plantRecommendations.split('; ').length) : 0,
        soil_rec_count: soilRecommendations ? (soilRecommendations.split('; ').length) : 0,
        soil_issues_count: soilIssues ? (soilIssues.split('; ').length) : 0,
        plant_health_score: plantHealthScore,
        soil_quality_score: soilQualityScore
      });

      // Calculate combined metrics
      const combinedConfidence = this.calculateCombinedConfidence(imageAnalysis, soilAnalysis) || 0.5;
      const overallHealth = this.calculateOverallHealth(imageAnalysis, soilAnalysis) || 'Unknown';

      // ============================================================
      // DISABLED STORAGE - Python backend handles this via auto-fusion
      // ============================================================
      console.log('⏭️ Storage disabled - Python auto-fusion will handle database storage');
      console.log('📊 Fusion Results (not stored):', {
        user_id: userId,
        image_id: imageId,
        soil_id: soilId,
        health_status: imageAnalysis?.health_status || 'Unknown',
        disease_type: imageAnalysis?.disease_type || imageAnalysis?.predicted_class || 'Unknown',
        soil_status: soilAnalysis?.soil_status || 'Unknown',
        combined_confidence_score: combinedConfidence,
        plant_health_score: plantHealthScore,
        soil_quality_score: soilQualityScore,
        overall_health: overallHealth,
        plant_recommendations_count: plantRecommendations ? plantRecommendations.split('; ').length : 0,
        soil_recommendations_count: soilRecommendations ? soilRecommendations.split('; ').length : 0
      });

      // Return the fused data without storing
      return {
        success: true,
        stored: false,
        stored_by_python: true,
        fusion_data: {
          user_id: userId,
          image_id: imageId,
          soil_id: soilId,
          health_status: imageAnalysis?.health_status || 'Unknown',
          disease_type: imageAnalysis?.disease_type || imageAnalysis?.predicted_class || 'Unknown',
          soil_status: soilAnalysis?.soil_status || 'Unknown',
          combined_confidence_score: combinedConfidence,
          plant_health_score: plantHealthScore,
          soil_quality_score: soilQualityScore,
          overall_health: overallHealth,
          plant_recommendations: plantRecommendations,
          soil_recommendations: soilRecommendations,
          soil_issues: soilIssues
        }
      };

    } catch (error) {
      console.error('❌ Late fusion failed:', error);
      throw error;
    }
  }

  async performBatchFusion(results, userId, soilAnalysis, options = {}) {
    try {
      console.log(`🔄 Performing batch fusion for ${results.length} results...`);
      console.log('⏭️ Storage disabled - Python backend handles storage');
      
      const {
        batch_timestamp = new Date().toISOString(),
        mode = 'batch_integrated',
        has_soil_data = !!soilAnalysis
      } = options;

      const fusedResults = [];

      for (let i = 0; i < results.length; i++) {
        try {
          const result = results[i];
          
          if (!result.success) {
            console.log(`⏭️ Skipping failed result for image ${result.image_id}`);
            continue;
          }

          // Extract data
          const plantRecommendations = this._extractRecommendations(result, 'plant');
          const soilRecommendations = soilAnalysis ? this._extractRecommendations(soilAnalysis, 'soil') : null;
          const soilIssues = soilAnalysis ? this._extractSoilIssues(soilAnalysis) : null;

          let plantHealthScore = result.plant_health_score;
          if (plantHealthScore === null || plantHealthScore === undefined) {
            if (result.health_status === 'Healthy') {
              plantHealthScore = 95;
            } else if (result.health_status === 'Unhealthy') {
              plantHealthScore = 45;
            } else {
              plantHealthScore = 60;
            }
          }

          let soilQualityScore = soilAnalysis?.soil_quality_score;
          if (soilQualityScore === null || soilQualityScore === undefined) {
            soilQualityScore = 50;
          }

          const combinedConfidence = this.calculateCombinedConfidence(result, soilAnalysis) || 0.5;
          const overallHealth = this.calculateOverallHealth(result, soilAnalysis) || 'Unknown';

          fusedResults.push({
            success: true,
            stored: false,
            image_id: result.image_id,
            fusion_data: {
              health_status: result.health_status || 'Unknown',
              disease_type: result.disease_type || result.predicted_class || 'Unknown',
              soil_status: soilAnalysis?.soil_status || 'Unknown',
              combined_confidence_score: combinedConfidence,
              plant_health_score: plantHealthScore,
              soil_quality_score: soilQualityScore,
              overall_health: overallHealth,
              plant_recommendations: plantRecommendations,
              soil_recommendations: soilRecommendations,
              soil_issues: soilIssues
            }
          });

          console.log(`✅ Fusion completed for image ${result.image_id} (not stored)`);

        } catch (error) {
          console.error(`❌ Error processing result ${i}:`, error.message);
        }
      }

      console.log(`📊 Batch fusion summary: ${fusedResults.length} results fused (none stored)`);

      return {
        success: true,
        fused_results: fusedResults,
        total_fused: fusedResults.length,
        stored: false,
        message: 'Fusion completed - storage handled by Python backend'
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
    if (!imageAnalysis?.confidence_score && !soilAnalysis?.confidence_score) return 0.5;
    if (!imageAnalysis?.confidence_score) return soilAnalysis.confidence_score;
    if (!soilAnalysis?.confidence_score) return imageAnalysis.confidence_score;
    
    // Use the same quadratic weighting as Python for consistency
    const plantConf = parseFloat(imageAnalysis.confidence_score);
    const soilConf = parseFloat(soilAnalysis.confidence_score);
    const totalConf = plantConf + soilConf;
    
    if (totalConf === 0) return 0.5;
    
    // Quadratic weighting: (conf1² + conf2²) / (conf1 + conf2)
    const combined = (plantConf * plantConf + soilConf * soilConf) / totalConf;
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
