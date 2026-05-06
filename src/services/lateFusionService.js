// lateFusionService.js - ENHANCED VERSION with Python-like fusion logic
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

  // ============ EXTRACTION METHODS ============

  extractRecommendations(result, type = 'plant') {
    if (!result) return null;
    
    console.log(`🔍 Extracting ${type} recommendations...`);
    
    let recommendations = null;
    
    if (type === 'plant') {
      recommendations = result.plant_recommendations || result.recommendations;
    } else {
      recommendations = result.soil_recommendations || result.recommendations;
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

  extractSoilIssues(soilAnalysis) {
    if (!soilAnalysis) return null;
    
    console.log('🔍 Extracting soil issues...');
    
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

  // ============ CONFIDENCE EXTRACTION (Matching Python) ============

  getPlantConfidence(plantAnalysis) {
    // Try different field names (matching Python version)
    const confidenceFields = [
      'confidence',           // Direct confidence
      'confidence_score',     // Alternative field
      'model_confidence',     // ML model confidence
      'confidence_percent'    // Percentage format
    ];
    
    for (const field of confidenceFields) {
      if (plantAnalysis[field] !== undefined && plantAnalysis[field] !== null) {
        let conf = parseFloat(plantAnalysis[field]);
        if (!isNaN(conf)) {
          // If confidence > 1 (like 99.9%), convert to 0-1 scale
          if (conf > 1) {
            conf = conf / 100.0;
          }
          console.log(`      Plant confidence from '${field}': ${conf.toFixed(4)} (${(conf*100).toFixed(2)}%)`);
          return conf;
        }
      }
    }
    
    // Try top_3_predictions
    if (plantAnalysis.top_3_predictions && plantAnalysis.top_3_predictions.length > 0) {
      const firstPred = plantAnalysis.top_3_predictions[0];
      if (firstPred.confidence !== undefined) {
        let conf = parseFloat(firstPred.confidence);
        if (!isNaN(conf)) {
          if (conf > 1) conf = conf / 100.0;
          console.log(`      Plant confidence from top_3_predictions: ${conf.toFixed(4)} (${(conf*100).toFixed(2)}%)`);
          return conf;
        }
      }
    }
    
    console.log(`      No plant confidence found, using default 0.5`);
    return 0.5;
  }

  getSoilConfidence(soilAnalysis) {
    if (!soilAnalysis) return 0.5;
    
    const confidenceFields = ['confidence_score', 'confidence', 'model_confidence'];
    
    for (const field of confidenceFields) {
      if (soilAnalysis[field] !== undefined && soilAnalysis[field] !== null) {
        let conf = parseFloat(soilAnalysis[field]);
        if (!isNaN(conf)) {
          console.log(`      Soil confidence from '${field}': ${conf.toFixed(4)} (${(conf*100).toFixed(2)}%)`);
          return conf;
        }
      }
    }
    
    console.log(`      No soil confidence found, using default 0.5`);
    return 0.5;
  }

  getSoilQualityScore(soilAnalysis) {
    if (!soilAnalysis) return 50;
    
    // Try different field names
    const scoreFields = ['soil_quality_score', 'quality_score', 'score', 'soil_health_score'];
    
    for (const field of scoreFields) {
      if (soilAnalysis[field] !== undefined && soilAnalysis[field] !== null) {
        let score = parseFloat(soilAnalysis[field]);
        if (!isNaN(score)) {
          console.log(`      Soil quality score from '${field}': ${score}`);
          return score;
        }
      }
    }
    
    console.log(`      No soil quality score found, using default 50`);
    return 50;
  }

  getPlantHealthScore(plantAnalysis) {
    if (!plantAnalysis) return 60;
    
    // Try different field names
    const scoreFields = ['plant_health_score', 'health_score', 'health'];
    
    for (const field of scoreFields) {
      if (plantAnalysis[field] !== undefined && plantAnalysis[field] !== null) {
        let score = parseFloat(plantAnalysis[field]);
        if (!isNaN(score)) {
          console.log(`      Plant health score from '${field}': ${score}`);
          return score;
        }
      }
    }
    
    // Calculate based on health status
    const healthStatus = plantAnalysis.health_status || 'Unknown';
    if (healthStatus === 'Healthy') return 95;
    if (healthStatus === 'Unhealthy') return 45;
    
    console.log(`      No plant health score found, using default 60`);
    return 60;
  }

  // ============ FUSION METHODS (Matching Python) ============

  calculateCombinedConfidence(plantAnalysis, soilAnalysis) {
    console.log("   📊 FUSION STEP 1: Calculating Combined Confidence");
    console.log("   " + "-".repeat(50));
    
    const plantConfidence = this.getPlantConfidence(plantAnalysis);
    const soilConfidence = this.getSoilConfidence(soilAnalysis);
    
    console.log(`      📥 Input Plant Confidence: ${plantConfidence.toFixed(4)} (${(plantConfidence*100).toFixed(2)}%)`);
    console.log(`      📥 Input Soil Confidence: ${soilConfidence.toFixed(4)} (${(soilConfidence*100).toFixed(2)}%)`);
    
    // Method 1: Simple Average
    const simpleAvg = (plantConfidence + soilConfidence) / 2;
    
    // Method 2: Weighted (quadratic) - gives more weight to higher confidence
    const totalConf = plantConfidence + soilConfidence;
    let weighted = 0.5;
    if (totalConf > 0) {
      weighted = (plantConfidence * plantConfidence + soilConfidence * soilConfidence) / totalConf;
    }
    
    // Method 3: Conservative (minimum)
    const conservative = Math.min(plantConfidence, soilConfidence);
    
    // Method 4: Geometric Mean
    const geometric = (plantConfidence * soilConfidence) ** 0.5;
    
    console.log(``);
    console.log(`      🔄 Fusion Methods:`);
    console.log(`         • Simple Average: ${(simpleAvg*100).toFixed(1)}%`);
    console.log(`         • Weighted (quadratic): ${(weighted*100).toFixed(1)}%`);
    console.log(`         • Conservative (min): ${(conservative*100).toFixed(1)}%`);
    console.log(`         • Geometric Mean: ${(geometric*100).toFixed(1)}%`);
    
    console.log(``);
    console.log(`      ✅ FINAL Combined Confidence: ${weighted.toFixed(4)} (${(weighted*100).toFixed(1)}%)`);
    
    return {
      combined: weighted,
      details: {
        plant_confidence: plantConfidence,
        soil_confidence: soilConfidence,
        simple_average: simpleAvg,
        weighted: weighted,
        conservative: conservative,
        geometric: geometric
      }
    };
  }

  calculateOverallHealth(plantAnalysis, soilAnalysis) {
    console.log(``);
    console.log("   🩺 FUSION STEP 2: Calculating Overall Health");
    console.log("   " + "-".repeat(50));
    
    const healthLevels = {
      'Excellent': 5, 'Good': 4, 'Healthy': 4,
      'Average': 3, 'Moderate': 3,
      'Needs Attention': 2, 'Poor': 1, 'Low': 1, 'Very Poor': 1, 'Critical': 0,
      'Unhealthy': 1, 'Unknown': 2
    };
    
    const plantHealth = plantAnalysis?.health_status || 'Unknown';
    const soilHealth = soilAnalysis?.soil_status || 'Unknown';
    
    const plantLevel = healthLevels[plantHealth] ?? 2;
    const soilLevel = healthLevels[soilHealth] ?? 2;
    
    console.log(`      📥 Input Plant Health: ${plantHealth} (Level ${plantLevel})`);
    console.log(`      📥 Input Soil Health: ${soilHealth} (Level ${soilLevel})`);
    
    let overallHealth;
    if (plantLevel <= soilLevel) {
      overallHealth = plantHealth;
      console.log(`      ✅ Taking WORSE: PLANT health -> ${overallHealth}`);
    } else {
      overallHealth = soilHealth;
      console.log(`      ✅ Taking WORSE: SOIL health -> ${overallHealth}`);
    }
    
    return {
      overall: overallHealth,
      details: {
        plant_health: plantHealth,
        soil_health: soilHealth,
        plant_level: plantLevel,
        soil_level: soilLevel,
        worse_source: plantLevel <= soilLevel ? 'plant' : 'soil'
      }
    };
  }

  fuseParameterScores(plantAnalysis, soilAnalysis) {
    console.log(``);
    console.log("   📊 FUSION STEP 3: Fusing Parameter Scores");
    console.log("   " + "-".repeat(50));
    
    const plantHealthScore = this.getPlantHealthScore(plantAnalysis);
    const soilQualityScore = this.getSoilQualityScore(soilAnalysis);
    
    console.log(`      📥 Plant Health Score: ${plantHealthScore.toFixed(1)}/100`);
    console.log(`      📥 Soil Quality Score: ${soilQualityScore.toFixed(1)}/100`);
    
    let overallScore;
    if (plantHealthScore <= soilQualityScore) {
      overallScore = (plantHealthScore * 0.7) + (soilQualityScore * 0.3);
      console.log(`      🔄 Plant is worse, giving it 70% weight`);
    } else {
      overallScore = (plantHealthScore * 0.3) + (soilQualityScore * 0.7);
      console.log(`      🔄 Soil is worse, giving it 70% weight`);
    }
    
    console.log(`      ✅ Overall Fused Score: ${overallScore.toFixed(1)}/100`);
    
    return {
      plant_health_score: plantHealthScore,
      soil_quality_score: soilQualityScore,
      overall_fused_score: overallScore
    };
  }

  // ============ STORAGE METHODS ============

  async checkExistingRecord(userId, imageId, soilId) {
    try {
      const supabaseClient = this._getClient();
      if (!supabaseClient) return false;
      
      const { data, error } = await supabaseClient
        .from('prediction_results')
        .select('prediction_id')
        .eq('user_id', userId)
        .eq('image_id', imageId)
        .eq('soil_id', soilId)
        .maybeSingle();
      
      if (error) {
        console.error('Error checking existing record:', error);
        return false;
      }
      
      if (data) {
        console.log(`      ⚠️ Existing record found for user ${userId}, image ${imageId}, soil ${soilId}`);
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('Error in checkExistingRecord:', error);
      return false;
    }
  }

  async storePredictionResult(predictionData) {
    const supabaseClient = this._getClient();
    if (!supabaseClient) {
      console.warn("   ⚠️ No Supabase client - storage skipped");
      return null;
    }
    
    try {
      // Check for existing record to prevent duplicates
      const exists = await this.checkExistingRecord(
        predictionData.user_id,
        predictionData.image_id,
        predictionData.soil_id
      );
      
      if (exists) {
        console.log(`      ⏭️ Skipping duplicate storage (record already exists)`);
        return { prediction_id: 'already_exists', skipped: true };
      }
      
      // Generate batch timestamp if not provided
      if (!predictionData.batch_timestamp) {
        predictionData.batch_timestamp = new Date().toISOString();
      }
      
      console.log(`      💾 Storing to Supabase...`);
      console.log(`         User: ${predictionData.user_id}`);
      console.log(`         Plant Health Score: ${predictionData.plant_health_score}`);
      console.log(`         Soil Quality Score: ${predictionData.soil_quality_score}`);
      console.log(`         🎯 Combined Confidence (FUSED): ${predictionData.combined_confidence_score} (${(predictionData.combined_confidence_score * 100).toFixed(1)}%)`);
      console.log(`         Overall Health: ${predictionData.overall_health}`);
      
      const { data, error } = await supabaseClient
        .from('prediction_results')
        .insert([predictionData])
        .select();
      
      if (error) {
        console.error('❌ Failed to store prediction:', error);
        throw error;
      }
      
      console.log(`      ✅ Stored with ID: ${data[0]?.prediction_id}`);
      return data[0];
      
    } catch (error) {
      console.error('❌ Storage failed:', error);
      return null;
    }
  }

  // ============ MAIN FUSION METHOD ============

  async fuseSinglePair(imageAnalysis, soilAnalysis, userId, imageId, soilId, options = {}) {
    try {
      console.log("");
      console.log("=".repeat(70));
      console.log("🔗 LATE FUSION SERVICE - FUSING PLANT & SOIL DATA");
      console.log("=".repeat(70));
      console.log(`👤 User: ${userId}`);
      console.log(`🖼️ Image: ${imageId}`);
      console.log(`🌱 Soil: ${soilId}`);
      console.log("=".repeat(70));
      
      const {
        batch_index = null,
        batch_timestamp = null,
        mode = soilId ? 'integrated' : 'image_only',
        has_soil_data = !!soilId
      } = options;
      
      // STEP 1: Extract all data
      console.log("");
      console.log("📥 STEP 1: Extracting Raw Data");
      console.log("-".repeat(50));
      
      const plantRecommendations = this.extractRecommendations(imageAnalysis, 'plant');
      const soilRecommendations = soilAnalysis ? this.extractRecommendations(soilAnalysis, 'soil') : null;
      const soilIssues = soilAnalysis ? this.extractSoilIssues(soilAnalysis) : null;
      
      // Get scores and confidences
      const plantHealthScore = this.getPlantHealthScore(imageAnalysis);
      const soilQualityScore = soilAnalysis ? this.getSoilQualityScore(soilAnalysis) : 50;
      const plantConfidence = this.getPlantConfidence(imageAnalysis);
      const soilConfidence = soilAnalysis ? this.getSoilConfidence(soilAnalysis) : 0.5;
      
      console.log("");
      console.log(`   🌿 PLANT DATA:`);
      console.log(`      • Health Status: ${imageAnalysis?.health_status || 'Unknown'}`);
      console.log(`      • Disease: ${imageAnalysis?.disease_type || imageAnalysis?.predicted_class || 'Unknown'}`);
      console.log(`      • Confidence: ${plantConfidence.toFixed(4)} (${(plantConfidence*100).toFixed(2)}%)`);
      console.log(`      • Health Score: ${plantHealthScore}`);
      console.log(`      • Recommendations: ${plantRecommendations ? (plantRecommendations.split('; ').length) : 0} found`);
      
      console.log(``);
      console.log(`   🌱 SOIL DATA:`);
      console.log(`      • Soil Status: ${soilAnalysis?.soil_status || 'Unknown'}`);
      console.log(`      • Quality Score: ${soilQualityScore}`);
      console.log(`      • Confidence: ${soilConfidence.toFixed(4)} (${(soilConfidence*100).toFixed(2)}%)`);
      console.log(`      • Recommendations: ${soilRecommendations ? (soilRecommendations.split('; ').length) : 0} found`);
      console.log(`      • Issues: ${soilIssues ? (soilIssues.split('; ').length) : 0} found`);
      
      // STEP 2: Calculate fused metrics
      const confidenceResult = this.calculateCombinedConfidence(imageAnalysis, soilAnalysis || {});
      const healthResult = this.calculateOverallHealth(imageAnalysis, soilAnalysis || {});
      const scoreResult = this.fuseParameterScores(imageAnalysis, soilAnalysis || {});
      
      const combinedConfidence = confidenceResult.combined;
      const overallHealth = healthResult.overall;
      
      // STEP 3: Prepare final data
      console.log("");
      console.log("📦 STEP 4: Preparing Final Fused Data");
      console.log("-".repeat(50));
      
      // Convert recommendations to strings for storage
      const plantRecStr = plantRecommendations || '';
      const soilRecStr = soilRecommendations || '';
      const soilIssuesStr = soilIssues || '';
      
      const predictionData = {
        user_id: userId,
        image_id: imageId,
        soil_id: soilId,
        health_status: imageAnalysis?.health_status || 'Unknown',
        disease_type: imageAnalysis?.disease_type || imageAnalysis?.predicted_class || 'Unknown',
        soil_status: soilAnalysis?.soil_status || 'Unknown',
        recommendations: null,
        date_predicted: new Date().toISOString(),
        combined_confidence_score: combinedConfidence,  // FUSED confidence
        tomato_type: imageAnalysis?.tomato_type || 'Unknown',
        overall_health: overallHealth,
        soil_issues: soilIssuesStr,
        batch_index: batch_index,
        batch_timestamp: batch_timestamp || new Date().toISOString(),
        has_soil_data: has_soil_data,
        mode: mode,
        plant_health_score: scoreResult.plant_health_score,
        soil_quality_score: scoreResult.soil_quality_score,
        plant_recommendations: plantRecStr,
        soil_recommendations: soilRecStr
      };
      
      console.log(`   ✅ Fused Data Ready:`);
      console.log(`      • 🎯 Combined Confidence (FUSED): ${combinedConfidence.toFixed(4)} (${(combinedConfidence*100).toFixed(1)}%)`);
      console.log(`      • Overall Health: ${overallHealth}`);
      console.log(`      • Plant Health Score: ${scoreResult.plant_health_score.toFixed(1)}`);
      console.log(`      • Soil Quality Score: ${scoreResult.soil_quality_score.toFixed(1)}`);
      console.log(`      • Plant Recs: ${plantRecommendations ? (plantRecommendations.split('; ').length) : 0}`);
      console.log(`      • Soil Recs: ${soilRecommendations ? (soilRecommendations.split('; ').length) : 0}`);
      
      console.log(``);
      console.log(`   📝 NOTE: The value stored in 'combined_confidence_score' is ${combinedConfidence.toFixed(4)} (${(combinedConfidence*100).toFixed(1)}%)`);
      console.log(`      This is the FUSED confidence from both plant AND soil models, not just plant confidence.`);
      
      // STEP 4: Store in database
      console.log("");
      console.log("💾 STEP 5: Storing in Database");
      console.log("-".repeat(50));
      
      const storedRecord = await this.storePredictionResult(predictionData);
      
      console.log("");
      console.log("✅ FUSION COMPLETE!");
      console.log("=".repeat(70));
      console.log("");
      
      return {
        success: true,
        stored: storedRecord !== null,
        prediction_id: storedRecord?.prediction_id || null,
        fusion_details: {
          combined_confidence: combinedConfidence,
          combined_confidence_percent: combinedConfidence * 100,
          overall_health: overallHealth,
          plant_health_score: scoreResult.plant_health_score,
          soil_quality_score: scoreResult.soil_quality_score,
          confidence_breakdown: confidenceResult.details,
          health_breakdown: healthResult.details,
          score_breakdown: scoreResult
        },
        plant_recommendations: plantRecommendations ? plantRecommendations.split('; ') : [],
        soil_recommendations: soilRecommendations ? soilRecommendations.split('; ') : [],
        soil_issues: soilIssues ? soilIssues.split('; ') : []
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
      
      // Get soil quality score once for batch (if available)
      const soilQualityScore = soilAnalysis ? this.getSoilQualityScore(soilAnalysis) : null;
      
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
          
          // Extract recommendations
          const plantRecommendations = this.extractRecommendations(result, 'plant');
          const soilRecommendations = soilAnalysis ? this.extractRecommendations(soilAnalysis, 'soil') : null;
          const soilIssues = soilAnalysis ? this.extractSoilIssues(soilAnalysis) : null;
          
          // Extract scores
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
          
          // Get combined confidence using the fusion method
          const confidenceResult = this.calculateCombinedConfidence(result, soilAnalysis || {});
          const combinedConfidence = confidenceResult.combined;
          
          // Get overall health
          const healthResult = this.calculateOverallHealth(result, soilAnalysis || {});
          const overallHealth = healthResult.overall;
          
          // Prepare prediction data
          const predictionData = {
            user_id: userId,
            image_id: result.image_id,
            soil_id: soilAnalysis?.soil_id || null,
            health_status: result.health_status || 'Unknown',
            disease_type: result.disease_type || result.predicted_class || 'Unknown',
            soil_status: soilAnalysis?.soil_status || 'Unknown',
            recommendations: null,
            date_predicted: new Date().toISOString(),
            combined_confidence_score: combinedConfidence,  // FUSED confidence
            tomato_type: result.tomato_type || 'Unknown',
            overall_health: overallHealth,
            soil_issues: soilIssues,
            batch_index: i,
            batch_timestamp: batch_timestamp,
            has_soil_data: has_soil_data,
            mode: mode,
            plant_health_score: plantHealthScore,
            soil_quality_score: soilQualityScore || 50,
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
            console.log(`   🎯 Combined Confidence (FUSED): ${(combinedConfidence * 100).toFixed(1)}%`);
            console.log(`   🌿 Plant health: ${plantHealthScore}, 🌱 Soil quality: ${soilQualityScore || 50}`);
            insertedResults.push({
              ...result,
              prediction_id: data[0]?.prediction_id,
              stored_successfully: true,
              fused_confidence: combinedConfidence
            });
          }
        } catch (error) {
          console.error(`❌ Error processing result ${i}:`, error.message);
          failedResults.push({ ...results[i], storage_error: error.message });
        }
      }
      
      console.log(`📊 Storage summary: ${insertedResults.length} stored, ${failedResults.length} failed`);
      console.log(`📊 Combined confidence stored for ${insertedResults.filter(r => r.fused_confidence).length} records`);
      
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

  async getRecommendationsByPredictionId(predictionId) {
    try {
      const supabaseClient = this._getClient();
      
      const { data, error } = await supabaseClient
        .from('prediction_results')
        .select('prediction_id, plant_recommendations, soil_recommendations, plant_health_score, soil_quality_score, combined_confidence_score')
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
        soil_quality_score: data.soil_quality_score,
        combined_confidence_score: data.combined_confidence_score
      };
    } catch (error) {
      console.error('❌ Failed to get recommendations:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = LateFusionService;