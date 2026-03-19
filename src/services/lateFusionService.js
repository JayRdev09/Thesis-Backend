// lateFusionService.js - COMPLETE FIXED VERSION
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
    
    // Try different possible locations for recommendations
    let recommendations = null;
    
    // Check plant_recommendations if type is plant
    if (type === 'plant' && result.plant_recommendations) {
      recommendations = result.plant_recommendations;
    }
    // Check soil_recommendations if type is soil
    else if (type === 'soil' && result.soil_recommendations) {
      recommendations = result.soil_recommendations;
    }
    // Check generic recommendations
    else if (result.recommendations) {
      recommendations = result.recommendations;
    }
    
    // If still null, check if recommendations came in a different format
    if (!recommendations && result.data?.recommendations) {
      recommendations = result.data.recommendations;
    }
    
    // Format the recommendations
    if (!recommendations) return null;
    
    // If it's already a string, return it
    if (typeof recommendations === 'string') {
      return recommendations.trim() || null;
    }
    
    // If it's an array, join with semicolons
    if (Array.isArray(recommendations)) {
      const validRecs = recommendations.filter(rec => 
        rec && typeof rec === 'string' && rec.trim().length > 0
      );
      return validRecs.length > 0 ? validRecs.join('; ') : null;
    }
    
    // If it's an object with a recommendation property
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

      // Extract plant health score (ensure it's never null)
      let plantHealthScore = imageAnalysis?.plant_health_score;
      if (plantHealthScore === null || plantHealthScore === undefined) {
        // Calculate a default based on health status
        if (imageAnalysis?.health_status === 'Healthy') {
          plantHealthScore = 95;
        } else if (imageAnalysis?.health_status === 'Unhealthy') {
          plantHealthScore = 45;
        } else {
          plantHealthScore = 60; // Default moderate score
        }
        console.log(`⚠️ Plant health score missing, using default: ${plantHealthScore}`);
      }

      // Extract soil quality score (ensure it's never null)
      let soilQualityScore = soilAnalysis?.soil_quality_score;
      if (soilQualityScore === null || soilQualityScore === undefined) {
        soilQualityScore = 50; // Default moderate score
        console.log(`⚠️ Soil quality score missing, using default: ${soilQualityScore}`);
      }

      console.log('📝 Extracted data:', {
        plant_rec_count: plantRecommendations ? 
          (plantRecommendations.split('; ').length) : 0,
        soil_rec_count: soilRecommendations ? 
          (soilRecommendations.split('; ').length) : 0,
        soil_issues_count: soilIssues ? 
          (soilIssues.split('; ').length) : 0,
        plant_health_score: plantHealthScore,
        soil_quality_score: soilQualityScore
      });

      // Prepare prediction data with proper recommendation fields - ALL FIELDS POPULATED
      const predictionData = {
        user_id: userId,
        image_id: imageId,
        soil_id: soilId,
        health_status: imageAnalysis?.health_status || 'Unknown',
        disease_type: imageAnalysis?.disease_type || imageAnalysis?.predicted_class || 'Unknown',
        soil_status: soilAnalysis?.soil_status || 'Unknown',
        recommendations: null, // Keep this null as we're using new columns
        date_predicted: new Date().toISOString(),
        combined_confidence_score: this.calculateCombinedConfidence(imageAnalysis, soilAnalysis) || 0.5,
        tomato_type: imageAnalysis?.tomato_type || 'Unknown',
        overall_health: this.calculateOverallHealth(imageAnalysis, soilAnalysis) || 'Unknown',
        soil_issues: soilIssues,
        batch_index: batch_index,
        batch_timestamp: batch_timestamp,
        has_soil_data: has_soil_data,
        mode: mode,
        plant_health_score: plantHealthScore,  // ✅ NEVER NULL
        soil_quality_score: soilQualityScore,  // ✅ NEVER NULL
        plant_recommendations: plantRecommendations,
        soil_recommendations: soilRecommendations
      };

      console.log('📝 Inserting prediction with ALL fields:', {
        plant_records: plantRecommendations ? '✅' : '❌',
        soil_records: soilRecommendations ? '✅' : '❌',
        soil_issues: soilIssues ? '✅' : '❌',
        plant_health_score: plantHealthScore,
        soil_quality_score: soilQualityScore,
        mode: mode
      });

      const supabaseClient = this._getClient();

      const { data, error } = await supabaseClient
        .from('prediction_results')
        .insert([predictionData])
        .select();

      if (error) {
        console.error('❌ Failed to store prediction:', error);
        throw error;
      }

      console.log('✅ Stored prediction with ID:', data[0]?.prediction_id);
      console.log('✅ Plant health score stored:', data[0]?.plant_health_score);
      console.log('✅ Soil quality score stored:', data[0]?.soil_quality_score);
      console.log('✅ Plant recommendations stored:', !!data[0]?.plant_recommendations);
      console.log('✅ Soil recommendations stored:', !!data[0]?.soil_recommendations);
      
      return {
        ...data[0],
        prediction_id: data[0]?.prediction_id
      };

    } catch (error) {
      console.error('❌ Late fusion failed:', error);
      throw error;
    }
  }

  async performBatchFusion(results, userId, soilAnalysis, options = {}) {
    try {
      console.log(`🔄 Performing batch fusion for ${results.length} results...`);
      
      const {
        batch_timestamp = new Date().toISOString(),
        mode = 'batch_integrated',
        has_soil_data = !!soilAnalysis
      } = options;

      const insertedResults = [];
      const failedResults = [];
      const supabaseClient = this._getClient();

      for (let i = 0; i < results.length; i++) {
        try {
          const result = results[i];
          
          if (!result.success) {
            console.log(`⏭️ Skipping failed result for image ${result.image_id}`);
            failedResults.push(result);
            continue;
          }

          // Check if already stored
          const { data: existing } = await supabaseClient
            .from('prediction_results')
            .select('prediction_id')
            .eq('image_id', result.image_id)
            .eq('batch_timestamp', batch_timestamp)
            .maybeSingle();
          
          if (existing) {
            console.log(`⏭️ Image ${result.image_id} already stored, skipping...`);
            insertedResults.push({
              ...result,
              prediction_id: existing.prediction_id,
              stored_successfully: true,
              skipped: true
            });
            continue;
          }

          // Extract recommendations for this result
          const plantRecommendations = this._extractRecommendations(result, 'plant');
          const soilRecommendations = soilAnalysis ? this._extractRecommendations(soilAnalysis, 'soil') : null;
          const soilIssues = soilAnalysis ? this._extractSoilIssues(soilAnalysis) : null;

          // Extract plant health score (ensure it's never null)
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

          // Extract soil quality score (ensure it's never null)
          let soilQualityScore = soilAnalysis?.soil_quality_score;
          if (soilQualityScore === null || soilQualityScore === undefined) {
            soilQualityScore = 50;
          }

          // Prepare prediction data with ALL fields populated
          const predictionData = {
            user_id: userId,
            image_id: result.image_id,
            soil_id: soilAnalysis?.soil_id || null,
            health_status: result.health_status || 'Unknown',
            disease_type: result.disease_type || result.predicted_class || 'Unknown',
            soil_status: soilAnalysis?.soil_status || 'Unknown',
            recommendations: null,
            date_predicted: new Date().toISOString(),
            combined_confidence_score: result.confidence_score || result.confidence || 0.5,
            tomato_type: result.tomato_type || 'Unknown',
            overall_health: result.overall_health || result.health_status || 'Unknown',
            soil_issues: soilIssues,
            batch_index: i,
            batch_timestamp: batch_timestamp,
            has_soil_data: has_soil_data,
            mode: mode,
            plant_health_score: plantHealthScore,  // ✅ NEVER NULL
            soil_quality_score: soilQualityScore,  // ✅ NEVER NULL
            plant_recommendations: plantRecommendations,
            soil_recommendations: soilRecommendations
          };

          const { data, error } = await supabaseClient
            .from('prediction_results')
            .insert([predictionData])
            .select();

          if (error) {
            console.error(`❌ Failed to store for image ${result.image_id}:`, error);
            failedResults.push({ ...result, storage_error: error.message });
          } else {
            console.log(`✅ Stored analysis for image ${result.image_id}, ID: ${data[0]?.prediction_id}`);
            console.log(`✅ Plant health score: ${data[0]?.plant_health_score}`);
            console.log(`✅ Soil quality score: ${data[0]?.soil_quality_score}`);
            console.log(`✅ Plant recs: ${data[0]?.plant_recommendations ? '✓' : '✗'}, Soil recs: ${data[0]?.soil_recommendations ? '✓' : '✗'}`);
            insertedResults.push({
              ...result,
              prediction_id: data[0]?.prediction_id,
              stored_successfully: true
            });
          }
        } catch (error) {
          console.error(`❌ Error processing result ${i}:`, error.message);
          failedResults.push({ ...results[i], storage_error: error.message });
        }
      }

      console.log(`📊 Storage summary: ${insertedResults.length} stored, ${failedResults.length} failed`);
      console.log(`📊 Plant health scores stored: ${insertedResults.filter(r => r.plant_health_score).length} records`);
      console.log(`📊 Soil quality scores stored: ${insertedResults.filter(r => r.soil_quality_score).length} records`);

      return {
        success: true,
        inserted: insertedResults,
        failed: failedResults,
        batch_timestamp: batch_timestamp,
        total_stored: insertedResults.length,
        total_failed: failedResults.length
      };

    } catch (error) {
      console.error('❌ Batch fusion failed:', error);
      return {
        success: false,
        error: error.message,
        inserted: [],
        failed: results
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
