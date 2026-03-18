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

  async fuseSinglePair(imageAnalysis, soilAnalysis, userId, imageId, soilId, options = {}) {
    try {
      console.log('🔄 Performing late fusion for single pair...');
      
      const {
        batch_index = null,
        batch_timestamp = null,
        mode = soilId ? 'integrated' : 'image_only',
        has_soil_data = !!soilId
      } = options;

      // Prepare prediction data
      const predictionData = {
        user_id: userId,
        image_id: imageId,
        soil_id: soilId,
        health_status: imageAnalysis?.health_status || null,
        disease_type: imageAnalysis?.disease_type || null,
        soil_status: soilAnalysis?.soil_status || null,
        recommendations: null, // Left blank as requested
        date_predicted: new Date().toISOString(),
        combined_confidence_score: this.calculateCombinedConfidence(imageAnalysis, soilAnalysis),
        tomato_type: imageAnalysis?.tomato_type || null,
        overall_health: this.calculateOverallHealth(imageAnalysis, soilAnalysis),
        soil_issues: soilAnalysis?.soil_issues ? 
          (Array.isArray(soilAnalysis.soil_issues) ? 
            soilAnalysis.soil_issues.join('; ') : 
            soilAnalysis.soil_issues) : 
          null,
        batch_index: batch_index,
        batch_timestamp: batch_timestamp,
        has_soil_data: has_soil_data,
        mode: mode,
        plant_health_score: imageAnalysis?.plant_health_score || null,
        soil_quality_score: soilAnalysis?.soil_quality_score || null,
        plant_recommendations: imageAnalysis?.recommendations ? 
          (Array.isArray(imageAnalysis.recommendations) ? 
            imageAnalysis.recommendations.join('; ') : 
            imageAnalysis.recommendations) : 
          null,
        soil_recommendations: soilAnalysis?.recommendations ? 
          (Array.isArray(soilAnalysis.recommendations) ? 
            soilAnalysis.recommendations.join('; ') : 
            soilAnalysis.recommendations) : 
          null
      };

      console.log('📝 Inserting prediction:', {
        plant_rec_count: predictionData.plant_recommendations ? 
          (Array.isArray(imageAnalysis?.recommendations) ? imageAnalysis.recommendations.length : 1) : 0,
        soil_rec_count: predictionData.soil_recommendations ? 
          (Array.isArray(soilAnalysis?.recommendations) ? soilAnalysis.recommendations.length : 1) : 0,
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

          // Check if already stored in this batch
          const { data: existing } = await supabaseClient
            .from('prediction_results')
            .select('prediction_id')
            .eq('image_id', result.image_id)
            .eq('batch_timestamp', batch_timestamp)
            .maybeSingle();
          
          if (existing) {
            console.log(`⏭️ Image ${result.image_id} already stored in this batch, skipping...`);
            insertedResults.push({
              ...result,
              prediction_id: existing.prediction_id,
              stored_successfully: true,
              skipped: true
            });
            continue;
          }

          // Prepare prediction data
          const predictionData = {
            user_id: userId,
            image_id: result.image_id,
            soil_id: soilAnalysis?.soil_id || null,
            health_status: result.health_status || null,
            disease_type: result.disease_type || null,
            soil_status: soilAnalysis?.soil_status || null,
            recommendations: null,
            date_predicted: new Date().toISOString(),
            combined_confidence_score: result.confidence_score || null,
            tomato_type: result.tomato_type || null,
            overall_health: result.overall_health || result.health_status || 'Unknown',
            soil_issues: soilAnalysis?.soil_issues ? 
              (Array.isArray(soilAnalysis.soil_issues) ? 
                soilAnalysis.soil_issues.join('; ') : 
                soilAnalysis.soil_issues) : 
              null,
            batch_index: i,
            batch_timestamp: batch_timestamp,
            has_soil_data: has_soil_data,
            mode: mode,
            plant_health_score: result.plant_health_score || null,
            soil_quality_score: soilAnalysis?.soil_quality_score || null,
            plant_recommendations: result.plant_recommendations ? 
              (Array.isArray(result.plant_recommendations) ? 
                result.plant_recommendations.join('; ') : 
                result.plant_recommendations) : 
              (result.recommendations ? 
                (Array.isArray(result.recommendations) ? 
                  result.recommendations.join('; ') : 
                  result.recommendations) : 
                null),
            soil_recommendations: soilAnalysis?.recommendations ? 
              (Array.isArray(soilAnalysis.recommendations) ? 
                soilAnalysis.recommendations.join('; ') : 
                soilAnalysis.recommendations) : 
              null
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

  async getRecommendationsByPredictionId(predictionId) {
    try {
      const supabaseClient = this._getClient();

      const { data, error } = await supabaseClient
        .from('prediction_results')
        .select('prediction_id, plant_recommendations, soil_recommendations')
        .eq('prediction_id', predictionId)
        .single();

      if (error) throw error;

      return {
        success: true,
        plant_recommendations: data.plant_recommendations ? 
          data.plant_recommendations.split('; ') : [],
        soil_recommendations: data.soil_recommendations ? 
          data.soil_recommendations.split('; ') : []
      };
    } catch (error) {
      console.error('❌ Failed to get recommendations:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = LateFusionService;