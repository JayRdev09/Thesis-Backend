const express = require('express');
const router = express.Router();
const storageService = require('../services/storageService');
const supabaseService = require('../services/supabaseService');
const mlService = require('../services/mlService');
const LateFusionService = require('../services/lateFusionService');
const loggingService = require('../services/loggingService');

// Helper functions to fetch images directly from database when storageService methods are missing
async function getImagesForAnalysisFallback(userId, limit = 50, unanalyzedOnly = true) {
  try {
    if (!supabaseService.client) {
      console.warn('⚠️ Supabase client not available');
      return [];
    }
    
    let query = supabaseService.client
      .from('image_data')
      .select('*')
      .eq('user_id', userId)
      .order('date_captured', { ascending: false });
    
    // Note: 'analyzed' column doesn't exist in database, so we get all images
    // The unanalyzedOnly parameter is ignored for now
    
    const { data, error } = await query.limit(limit);
    
    if (error) {
      console.warn('⚠️ Error fetching images from database:', error.message);
      return [];
    }
    
    console.log(`✅ Fetched ${data?.length || 0} images from database (fallback)`);
    return data || [];
  } catch (error) {
    console.warn('⚠️ Error in getImagesForAnalysisFallback:', error.message);
    return [];
  }
}

async function getImagesByBatchFallback(batchTimestamp, userId) {
  try {
    if (!supabaseService.client) {
      console.warn('⚠️ Supabase client not available');
      return [];
    }
    
    const { data, error } = await supabaseService.client
      .from('image_data')
      .select('*')
      .eq('user_id', userId)
      .eq('batch_timestamp', batchTimestamp)
      .order('batch_index', { ascending: true });
    
    if (error) {
      console.warn('⚠️ Error fetching batch images from database:', error.message);
      return [];
    }
    
    console.log(`✅ Fetched ${data?.length || 0} images for batch ${batchTimestamp} (fallback)`);
    return data || [];
  } catch (error) {
    console.warn('⚠️ Error in getImagesByBatchFallback:', error.message);
    return [];
  }
}

// Initialize ML model on startup
console.log('✅ ML Service ready for analysis routes');
// ML service status endpoint
router.get('/ml-status', async (req, res) => {
  try {
    const mlHealth = mlService.healthCheck();
    
    res.json({
      success: true,
      ml_service: {
        initialized: mlHealth.initialized,
        model_loaded: mlHealth.model_loaded,
        using_tflite: mlHealth.initialized,
        fallback_mode: !mlHealth.initialized,
        class_count: mlHealth.class_count,
        runtime: mlHealth.runtime,
        supports_tflite: mlHealth.supports_tflite,
        supports_batch: true,
        batch_max_size: 50
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ ML status check failed:', error);
    res.status(500).json({
      success: false,
      message: 'ML status check failed: ' + error.message
    });
  }
});

// Check data status for batch analysis
router.get('/data-status', async (req, res) => {
  try {
    const userId = req.query.userId;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }
    
    console.log(`📊 Checking data status for user ${userId}...`);
    
    // Check for latest soil data with defensive fallback
    let latestSoil = null;
    try {
      if (typeof storageService.getLatestSoilData === 'function') {
        latestSoil = await storageService.getLatestSoilData(userId);
      }
    } catch (error) {
      console.warn('⚠️ Error getting latest soil data:', error.message);
    }
    console.log('Soil data status:', latestSoil ? 'found' : 'not found');
    
    // Check for batch images with defensive fallback
    let recentImages = [];
    if (typeof storageService.getImagesForAnalysis === 'function') {
      try {
        recentImages = await storageService.getImagesForAnalysis(userId, 50, true);
      } catch (error) {
        console.warn('⚠️ Error getting images for analysis:', error.message);
        console.log('🔄 Using fallback method to fetch images...');
        recentImages = await getImagesForAnalysisFallback(userId, 50, true);
      }
    } else {
      console.warn('⚠️ getImagesForAnalysis method not available on storageService');
      console.log('🔄 Using fallback method to fetch images...');
      recentImages = await getImagesForAnalysisFallback(userId, 50, true);
    }
    console.log('Images available for batch analysis:', recentImages.length);
    
    // Group images by batch
    const batchGroups = {};
    recentImages.forEach(img => {
      const batchKey = img.batch_timestamp || 'unbatched';
      if (!batchGroups[batchKey]) {
        batchGroups[batchKey] = {
          batch_timestamp: batchKey !== 'unbatched' ? batchKey : null,
          count: 0,
          images: []
        };
      }
      batchGroups[batchKey].count++;
      batchGroups[batchKey].images.push({
        image_id: img.image_id,
        date_captured: img.date_captured
      });
    });
    
    const batchList = Object.values(batchGroups);
    
    const now = new Date();
    let soilAgeHours = null;
    
    if (latestSoil && latestSoil.date_gathered) {
      const soilTime = new Date(latestSoil.date_gathered);
      soilAgeHours = (now - soilTime) / (1000 * 60 * 60);
    }
    
    const MAX_DATA_AGE_HOURS = 72;
    const soilIsFresh = soilAgeHours !== null && soilAgeHours < MAX_DATA_AGE_HOURS;
    
    const soilStatus = !latestSoil ? 'missing' : 
                      !soilIsFresh ? 'stale' : 'fresh';
    
    // Batch analysis availability
    const canAnalyzeBatch = recentImages.length > 0;
    const batchSize = recentImages.length;
    
    const response = {
      success: true,
      can_analyze_batch: canAnalyzeBatch,
      batch_analysis: {
        available: canAnalyzeBatch,
        total_images: batchSize,
        batch_groups: batchList.length,
        max_batch_size: 50,
        supports_single_soil: true,
        supports_individual_soil: false
      },
      soil_data: {
        exists: !!latestSoil,
        status: soilStatus,
        age_hours: soilAgeHours ? Math.round(soilAgeHours * 10) / 10 : null,
        is_fresh: soilIsFresh,
        last_reading: latestSoil?.date_gathered || null,
        soil_id: latestSoil?.soil_id || null
      },
      batch_groups: batchList,
      available_images: {
        count: recentImages.length,
        images: recentImages.slice(0, 5).map(img => ({
          image_id: img.image_id,
          date_captured: img.date_captured,
          batch_timestamp: img.batch_timestamp || null,
          batch_index: img.batch_index || null
        }))
      },
      requirements: {
        max_data_age_hours: MAX_DATA_AGE_HOURS,
        needed: ['plant_images'],
        optional: ['soil_measurements'],
        message: canAnalyzeBatch ? 
          '✅ Batch analysis available with ' + batchSize + ' images' :
          '❌ Need plant images for batch analysis'
      },
      user_id: userId,
      timestamp: now.toISOString()
    };
    
    console.log('✅ Data status check completed:', {
      canAnalyzeBatch: response.can_analyze_batch,
      batchSize: batchSize,
      batchGroups: batchList.length,
      soilStatus
    });
    
    // Log data status check (only if there are images available for analysis)
    if (canAnalyzeBatch) {
      await loggingService.logMLActivity(
        userId,
        'DATA_STATUS_CHECK',
        `Checked data status: ${batchSize} images available, soil ${soilStatus}`
      );
    }
    
    res.json(response);
    
  } catch (error) {
    console.error('❌ Data status check failed:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check data status: ' + error.message,
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Main batch analysis endpoint - FIXED WITH NEW COLUMNS
router.post('/analyze-batch', async (req, res) => {
  try {
    const { 
      userId, 
      batchTimestamp, 
      imageIds, 
      useLatestSoil = true,
      batchSize = 20,
      analysisMode = 'both'
    } = req.body;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }
    
    console.log(`🔍 Starting batch analysis for user ${userId}...`);
    console.log('📋 Analysis mode:', analysisMode);
    
    let imagesForAnalysis = [];
    let actualBatchTimestamp = batchTimestamp;
    
    // Get images based on selection method with defensive checks
    if (batchTimestamp) {
      console.log(`📁 Getting images from batch ${batchTimestamp}...`);
      if (typeof storageService.getImagesByBatch === 'function') {
        try {
          imagesForAnalysis = await storageService.getImagesByBatch(batchTimestamp, userId);
        } catch (error) {
          console.warn('⚠️ Error getting images by batch:', error.message);
          console.log('🔄 Using fallback method to fetch batch images...');
          imagesForAnalysis = await getImagesByBatchFallback(batchTimestamp, userId);
        }
      } else {
        console.warn('⚠️ getImagesByBatch method not available, using fallback');
        imagesForAnalysis = await getImagesByBatchFallback(batchTimestamp, userId);
      }
    } 
    else if (imageIds && Array.isArray(imageIds) && imageIds.length > 0) {
      console.log(`📁 Getting specified ${imageIds.length} images...`);
      if (typeof storageService.getImagesForAnalysis === 'function') {
        try {
          const recentImages = await storageService.getImagesForAnalysis(userId, 100, true);
          imagesForAnalysis = recentImages.filter(img => imageIds.includes(img.image_id));
        } catch (error) {
          console.warn('⚠️ Error getting images for analysis:', error.message);
          console.log('🔄 Using fallback method to fetch images...');
          const allImages = await getImagesForAnalysisFallback(userId, 100, true);
          imagesForAnalysis = allImages.filter(img => imageIds.includes(img.image_id));
        }
      } else {
        console.warn('⚠️ getImagesForAnalysis method not available, using fallback');
        const allImages = await getImagesForAnalysisFallback(userId, 100, true);
        imagesForAnalysis = allImages.filter(img => imageIds.includes(img.image_id));
      }
    }
    else {
      console.log(`📁 Getting recent unanalyzed images (limit: ${batchSize})...`);
      if (typeof storageService.getImagesForAnalysis === 'function') {
        try {
          imagesForAnalysis = await storageService.getImagesForAnalysis(userId, batchSize, true);
        } catch (error) {
          console.warn('⚠️ Error getting images for analysis:', error.message);
          console.log('🔄 Using fallback method to fetch images...');
          imagesForAnalysis = await getImagesForAnalysisFallback(userId, batchSize, true);
        }
      } else {
        console.warn('⚠️ getImagesForAnalysis method not available, using fallback');
        imagesForAnalysis = await getImagesForAnalysisFallback(userId, batchSize, true);
      }
      
      if (imagesForAnalysis.length > 0 && imagesForAnalysis[0].batch_timestamp) {
        actualBatchTimestamp = imagesForAnalysis[0].batch_timestamp;
        console.log(`🔄 Using existing batch timestamp from images: ${actualBatchTimestamp}`);
      } else {
        actualBatchTimestamp = new Date().toISOString();
        console.log(`📝 Creating new batch timestamp: ${actualBatchTimestamp}`);
      }
    }
    
    if (imagesForAnalysis.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No images found for batch analysis'
      });
    }
    
    console.log(`📊 Found ${imagesForAnalysis.length} images for batch analysis`);
    console.log(`📅 Using batch timestamp: ${actualBatchTimestamp}`);
    
    // Get soil data if needed
    let soilData = null;
    let soilId = null;
    let soilAnalysis = null;
    
    if (useLatestSoil && analysisMode !== 'image_only') {
      if (typeof storageService.getLatestSoilData === 'function') {
        try {
          soilData = await storageService.getLatestSoilData(userId);
        } catch (error) {
          console.warn('⚠️ Error getting latest soil data:', error.message);
          soilData = null;
        }
      } else {
        console.warn('⚠️ getLatestSoilData method not available');
      }
      
      if (soilData) {
        soilId = soilData.soil_id;
        console.log(`🌱 Using latest soil data: ${soilId}`);
        
        // Perform soil analysis
        console.log('🌱 Performing soil analysis...');
        soilAnalysis = await mlService.analyzeSoil(soilData, userId, soilId);
        console.log('✅ Soil analysis completed');
      } else {
        console.log('⚠️ No soil data available');
      }
    }
    
    // Prepare image data for ML service
    const imageDataList = [];
    for (const img of imagesForAnalysis) {
      let publicUrl = null;
      if (typeof storageService.getImagePublicUrl === 'function') {
        try {
          publicUrl = await storageService.getImagePublicUrl(img.image_path);
        } catch (error) {
          console.warn(`⚠️ Could not get public URL for ${img.image_id}:`, error.message);
        }
      } else {
        console.warn('⚠️ getImagePublicUrl method not available');
      }
      imageDataList.push({
        image_path: img.image_path,
        publicUrl: publicUrl,
        image_id: img.image_id,
        metadata: {
          brightness: img.brightness,
          contrast: img.contrast,
          saturation: img.saturation,
          batch_timestamp: img.batch_timestamp,
          batch_index: img.batch_index
        }
      });
    }
    
    // Perform image analysis
    let imageAnalysis = { success: false };
    if (analysisMode !== 'soil_only') {
      console.log(`🤖 Performing batch image analysis on ${imageDataList.length} images...`);
      imageAnalysis = await mlService.analyzeBatchImages(imageDataList, userId, soilAnalysis);
      
      if (!imageAnalysis.success) {
        throw new Error(`Batch image analysis failed: ${imageAnalysis.error}`);
      }
      
      console.log(`✅ Batch image analysis completed: ${imageAnalysis.successful_predictions} successful, ${imageAnalysis.failed_predictions} failed`);
    }
    
    // FIXED: Prepare results for response WITH the new recommendation columns
    let resultsToShow = [];
    
    if (imageAnalysis.success && imageAnalysis.results) {
      resultsToShow = imageAnalysis.results.map(result => ({
        id: result.prediction_id,
        image_id: result.image_id,
        disease_type: result.disease_type,
        health_status: result.health_status,
        overall_health: result.overall_health,
        confidence: result.confidence_score,
        plant_health_score: result.plant_health_score,
        soil_quality_score: result.soil_quality_score,
        mode: result.mode,
        batch_timestamp: result.batch_timestamp,
        batch_index: result.batch_index,
        // ✅ ADDED: New recommendation columns
        plant_recommendations: result.plant_recommendations || [],
        soil_recommendations: result.soil_recommendations || [],
        soil_issues: result.soil_issues || []
      }));
    }
    
    // Prepare response
    const response = {
      success: true,
      mode: analysisMode === 'both' && soilData ? 'batch_integrated' : 
            analysisMode === 'soil_only' ? 'batch_soil_only' : 'batch_image_only',
      batch_info: {
        total_images: imagesForAnalysis.length,
        analyzed_images: imageAnalysis.successful_predictions || 0,
        failed_images: imageAnalysis.failed_predictions || 0,
        batch_timestamp: actualBatchTimestamp,
        soil_used: !!soilData,
        soil_id: soilId,
        analysis_mode: analysisMode
      },
      image_analysis: imageAnalysis.success ? {
        ...imageAnalysis,
        results: resultsToShow
      } : null,
      soil_analysis: soilAnalysis,
      summary: {
        total_analyses: resultsToShow.length,
        healthy_count: resultsToShow.filter(r => 
          r.overall_health === 'Healthy' || 
          r.health_status === 'Healthy'
        ).length,
        unhealthy_count: resultsToShow.filter(r => 
          r.overall_health !== 'Healthy' && 
          r.health_status !== 'Healthy'
        ).length,
        top_diseases: calculateTopDiseases(resultsToShow),
        average_confidence: resultsToShow.length > 0 ? 
          resultsToShow.reduce((sum, r) => sum + (r.confidence || 0), 0) / resultsToShow.length : 0
      },
      user_id: userId,
      timestamp: new Date().toISOString()
    };
    
    console.log('✅ Batch analysis completed successfully!');
    console.log(`📊 Batch ID for frontend: ${actualBatchTimestamp}`);
    
    // Log successful batch analysis
    await loggingService.logMLActivity(
      userId,
      'BATCH_ANALYSIS_COMPLETED',
      `Analyzed ${imagesForAnalysis.length} images, ${resultsToShow.length} results, mode: ${analysisMode}`
    );
    
    res.json(response);
    
  } catch (error) {
    console.error('❌ Batch analysis failed:', error);
    res.status(500).json({
      success: false,
      message: 'Batch analysis failed: ' + error.message,
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Get batch analysis history
router.get('/batch-history', async (req, res) => {
  try {
    const userId = req.query.userId;
    const limit = parseInt(req.query.limit) || 10;
    const mode = req.query.mode || 'all';
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }
    
    console.log(`📚 Fetching batch analysis history for user ${userId}...`);
    
    // Get all analyses with defensive fallback
    let allHistory = [];
    if (typeof storageService.getAnalysisHistory === 'function') {
      try {
        allHistory = await storageService.getAnalysisHistory(userId, 200);
      } catch (error) {
        console.warn('⚠️ Error fetching analysis history:', error.message);
        allHistory = [];
      }
    } else {
      console.warn('⚠️ getAnalysisHistory method not available');
      allHistory = [];
    }
    
    // Filter batch analyses
    let batchHistory = allHistory.filter(item => 
      item.mode === 'batch_image_only' || 
      item.mode === 'batch_integrated' ||
      item.mode === 'batch_soil_only' ||
      (item.batch_timestamp && item.batch_timestamp !== '')
    );
    
    // Filter by mode if specified
    if (mode !== 'all') {
      batchHistory = batchHistory.filter(item => {
        if (mode === 'integrated') return item.mode === 'batch_integrated';
        if (mode === 'image_only') return item.mode === 'batch_image_only';
        if (mode === 'soil_only') return item.mode === 'batch_soil_only';
        return true;
      });
    }
    
    // Group by batch
    const groupedBatches = {};
    
    batchHistory.forEach(item => {
      const batchId = item.batch_timestamp || 
                     new Date(item.date_predicted).toISOString().split('T')[0] + '_batch';
      
      if (!groupedBatches[batchId]) {
        groupedBatches[batchId] = {
          batch_id: batchId,
          analyses: [],
          total: 0,
          healthy_count: 0,
          unhealthy_count: 0,
          mode: item.mode || 'batch_image_only',
          date: item.date_predicted,
          soil_used: item.has_soil_data || false,
          soil_id: item.soil_id || null
        };
      }
      
      groupedBatches[batchId].analyses.push({
        id: item.prediction_id || item.id,
        image_id: item.image_id,
        disease_type: item.disease_type,
        health_status: item.health_status,
        overall_health: item.overall_health,
        confidence: item.combined_confidence_score,
        plant_health_score: item.plant_health_score,
        soil_quality_score: item.soil_quality_score,
        // ✅ ADDED: Include recommendation data in history
        plant_recommendations: item.plant_recommendations || [],
        soil_recommendations: item.soil_recommendations || [],
        soil_issues: item.soil_issues || [],
        date: item.date_predicted
      });
      
      groupedBatches[batchId].total++;
      
      if (item.overall_health === 'Healthy' || item.health_status === 'Healthy') {
        groupedBatches[batchId].healthy_count++;
      } else {
        groupedBatches[batchId].unhealthy_count++;
      }
    });
    
    // Convert to array and sort
    const batches = Object.values(groupedBatches)
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, limit);
    
    // Calculate overall statistics
    const overallStats = {
      total_batches: batches.length,
      total_analyses: batches.reduce((sum, batch) => sum + batch.total, 0),
      average_batch_size: batches.length > 0 ? 
        Math.round(batches.reduce((sum, batch) => sum + batch.total, 0) / batches.length) : 0,
      overall_health_rate: batches.length > 0 ? 
        Math.round((batches.reduce((sum, batch) => sum + batch.healthy_count, 0) / 
                   batches.reduce((sum, batch) => sum + batch.total, 0)) * 100) : 0
    };
    
    res.json({
      success: true,
      batches: batches,
      overall_stats: overallStats,
      filter: {
        mode: mode,
        limit: limit
      },
      user_id: userId,
      timestamp: new Date().toISOString()
    });
    
    // Log batch history access
    await loggingService.logMLActivity(
      userId,
      'VIEW_BATCH_HISTORY',
      `Viewed ${batches.length} batches with ${overallStats.total_analyses} total analyses`
    );
    
  } catch (error) {
    console.error('❌ Error fetching batch history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch batch history: ' + error.message
    });
  }
});

// Get specific batch analysis details - FIXED WITH NEW COLUMNS
router.get('/batch/:batchId', async (req, res) => {
  try {
    const userId = req.query.userId;
    let { batchId } = req.params;
    
    console.log(`📄 [BACKEND] Fetching batch details for batch ${batchId}, user ${userId}`);
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }
    
    if (!batchId) {
      return res.status(400).json({
        success: false,
        message: 'Batch ID is required'
      });
    }
    
    console.log(`📄 [BACKEND] Fetching batch analysis details for batch ${batchId}...`);
    
    let history = [];
    if (typeof storageService.getAnalysisHistory === 'function') {
      try {
        history = await storageService.getAnalysisHistory(userId, 200);
      } catch (error) {
        console.warn('⚠️ Error fetching batch analysis details:', error.message);
        history = [];
      }
    } else {
      console.warn('⚠️ getAnalysisHistory method not available');
      history = [];
    }
    
    console.log(`📄 [BACKEND] Total history entries: ${history.length}`);
    
    // Handle both timestamp formats (Z and +00:00)
    const normalizeTimestamp = (timestamp) => {
      if (!timestamp) return null;
      // Convert Z to +00:00 for consistent comparison
      return timestamp.replace('Z', '+00:00');
    };
    
    const normalizedRequestId = normalizeTimestamp(batchId);
    console.log(`🔄 [BACKEND] Normalized request ID: ${normalizedRequestId}`);
    
    // Filter analyses for this batch - try multiple matching strategies
    const batchAnalyses = history.filter(item => {
      if (!item || !item.batch_timestamp) return false;
      
      const itemTimestamp = normalizeTimestamp(item.batch_timestamp);
      
      // Strategy 1: Exact match after normalization
      if (itemTimestamp === normalizedRequestId) {
        return true;
      }
      
      // Strategy 2: Contains match (handles minor differences)
      if (itemTimestamp && normalizedRequestId && 
          itemTimestamp.includes(normalizedRequestId.replace(/\.\d+/g, ''))) {
        return true;
      }
      
      // Strategy 3: Match by date only (fallback)
      const requestDate = normalizedRequestId ? normalizedRequestId.split('T')[0] : null;
      const itemDate = itemTimestamp ? itemTimestamp.split('T')[0] : null;
      if (requestDate && itemDate && requestDate === itemDate) {
        return true;
      }
      
      return false;
    });
    
    console.log(`📄 [BACKEND] Found ${batchAnalyses.length} analyses for batch ${batchId}`);
    
    if (batchAnalyses.length === 0) {
      // Log all available batch timestamps for debugging
      const availableTimestamps = history
        .filter(item => item && item.batch_timestamp)
        .map(item => ({
          original: item.batch_timestamp,
          normalized: normalizeTimestamp(item.batch_timestamp)
        }));
      
      console.log(`❌ [BACKEND] Available batch timestamps:`, availableTimestamps.slice(0, 5));
      
      return res.status(404).json({
        success: false,
        message: `Batch analysis not found for ID: ${batchId}`,
        available_batches: availableTimestamps.map(t => t.original).slice(0, 5),
        debug: {
          request_id: batchId,
          normalized_request_id: normalizedRequestId,
          total_history: history.length
        }
      });
    }
    
    // Get original images for each analysis to get image URLs
    const analysesWithImages = await Promise.all(
      batchAnalyses.map(async (item) => {
        try {
          let imageUrl = null;
          
          // Try to get the original image from storage with defensive checks
          if (item.image_id && typeof storageService.getImageById === 'function') {
            try {
              const originalImage = await storageService.getImageById(item.image_id, userId);
              if (originalImage && originalImage.image_path) {
                // Get public URL for the image
                if (typeof storageService.getImagePublicUrl === 'function') {
                  try {
                    imageUrl = await storageService.getImagePublicUrl(originalImage.image_path);
                  } catch (urlError) {
                    console.warn(`⚠️ Could not get public URL for image ${item.image_id}:`, urlError.message);
                    imageUrl = originalImage.image_path.startsWith('http') ? originalImage.image_path : null;
                  }
                } else if (originalImage.image_path.startsWith('http')) {
                  imageUrl = originalImage.image_path;
                } else {
                  // Create local URL for development
                  imageUrl = `http://localhost:8000/uploads/${originalImage.image_path}`;
                }
              }
            } catch (fetchError) {
              console.warn(`⚠️ Could not fetch image details for ${item.image_id}:`, fetchError.message);
            }
          } else if (item.image_id) {
            console.warn(`⚠️ getImageById method not available for image ${item.image_id}`);
          }
          
          return {
            ...item,
            image_url: imageUrl
          };
        } catch (imgError) {
          console.error(`❌ Error processing image for analysis ${item.image_id}:`, imgError.message);
          return {
            ...item,
            image_url: null
          };
        }
      })
    );
    
    // Get batch metadata
    const firstAnalysis = analysesWithImages[0];
    const batchDetails = {
      batch_id: batchId,
      original_batch_timestamp: firstAnalysis.batch_timestamp,
      total_images: analysesWithImages.length,
      mode: firstAnalysis.mode || 'batch_image_only',
      date: firstAnalysis.date_predicted,
      soil_used: firstAnalysis.has_soil_data || false,
      soil_id: firstAnalysis.soil_id || null,
      healthy_count: analysesWithImages.filter(item => 
        item.overall_health === 'Healthy' || item.health_status === 'Healthy'
      ).length,
      unhealthy_count: analysesWithImages.filter(item => 
        item.overall_health !== 'Healthy' && item.health_status !== 'Healthy'
      ).length
    };
    
    // FIXED: Prepare response WITH new recommendation columns (NO OLD recommendations field)
    const response = {
      success: true,
      batch: batchDetails,
      analyses: analysesWithImages.map(item => ({
        id: item.prediction_id || item.id,
        image_id: item.image_id,
        image_url: item.image_url,
        disease_type: item.disease_type,
        health_status: item.health_status,
        overall_health: item.overall_health,
        confidence: item.combined_confidence_score,
        plant_health_score: item.plant_health_score,
        soil_quality_score: item.soil_quality_score,
        // ✅ REPLACED: Using new columns instead of old recommendations
        plant_recommendations: item.plant_recommendations || [],
        soil_recommendations: item.soil_recommendations || [],
        soil_issues: item.soil_issues || [],
        date: item.date_predicted,
        batch_timestamp: item.batch_timestamp,
        batch_index: item.batch_index,
        mode: item.mode,
        tomato_type: item.tomato_type || 'Unknown'
      })),
      statistics: {
        total_analyses: analysesWithImages.length,
        average_health_score: analysesWithImages.filter(item => item.plant_health_score)
          .reduce((sum, item) => sum + (item.plant_health_score || 0), 0) / analysesWithImages.length || 0,
        health_rate: Math.round((batchDetails.healthy_count / analysesWithImages.length) * 100),
        images_with_urls: analysesWithImages.filter(item => item.image_url).length
      },
      debug: {
        batch_id_requested: batchId,
        batch_timestamp_found: firstAnalysis.batch_timestamp,
        match_type: normalizeTimestamp(firstAnalysis.batch_timestamp) === normalizedRequestId ? 'exact' : 'partial'
      }
    };
    
    console.log(`✅ [BACKEND] Successfully retrieved batch ${batchId} with ${analysesWithImages.length} analyses`);
    console.log(`📷 [BACKEND] Images with URLs: ${response.statistics.images_with_urls}/${analysesWithImages.length}`);
    
    // Log batch details access
    await loggingService.logMLActivity(
      userId,
      'VIEW_BATCH_DETAILS',
      `Viewed batch ${batchId} with ${analysesWithImages.length} analyses`
    );
    
    res.json(response);
    
  } catch (error) {
    console.error('❌ [BACKEND] Error fetching batch details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch batch details: ' + error.message,
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Get all analysis history (batch only) - FIXED WITH NEW COLUMNS
router.get('/history', async (req, res) => {
  try {
    const userId = req.query.userId;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }
    
    const limit = parseInt(req.query.limit) || 20;
    console.log(`📚 Fetching batch analysis history for user ${userId}, limit: ${limit}`);
    
    const history = await storageService.getAnalysisHistory(userId, limit * 2);
    
    // Filter for batch analyses only
    const batchHistory = history.filter(item => 
      item.mode === 'batch_image_only' || 
      item.mode === 'batch_integrated' ||
      item.mode === 'batch_soil_only' ||
      (item.batch_timestamp && item.batch_timestamp !== '')
    );
    
    // Get image URLs for each analysis with defensive checks
    const historyWithImages = await Promise.all(
      batchHistory.slice(0, limit).map(async (item) => {
        try {
          let imageUrl = null;
          
          if (item.image_id && typeof storageService.getImageById === 'function') {
            try {
              const originalImage = await storageService.getImageById(item.image_id, userId);
              if (originalImage && originalImage.image_path) {
                if (typeof storageService.getImagePublicUrl === 'function') {
                  try {
                    imageUrl = await storageService.getImagePublicUrl(originalImage.image_path);
                  } catch (urlError) {
                    console.warn(`⚠️ Could not get public URL for image ${item.image_id}:`, urlError.message);
                    imageUrl = originalImage.image_path.startsWith('http') ? originalImage.image_path : null;
                  }
                } else if (originalImage.image_path.startsWith('http')) {
                  imageUrl = originalImage.image_path;
                } else {
                  imageUrl = `http://localhost:8000/uploads/${originalImage.image_path}`;
                }
              }
            } catch (fetchError) {
              console.warn(`⚠️ Could not fetch image details for ${item.image_id}:`, fetchError.message);
            }
          } else if (item.image_id) {
            console.warn(`⚠️ getImageById method not available for image ${item.image_id}`);
          }
          
          return {
            ...item,
            image_url: imageUrl
          };
        } catch (imgError) {
          console.error(`❌ Error processing history image ${item.image_id}:`, imgError.message);
          return {
            ...item,
            image_url: null
          };
        }
      })
    );
    
    // FIXED: Format history with new recommendation columns (NO OLD recommendations field)
    const formattedHistory = historyWithImages.map(item => ({
      id: item.prediction_id || item.id,
      user_id: item.user_id,
      image_id: item.image_id,
      image_url: item.image_url,
      soil_id: item.soil_id,
      health_status: item.health_status,
      disease_type: item.disease_type,
      soil_status: item.soil_status,
      // ✅ REPLACED: Using new columns instead of old recommendations
      plant_recommendations: item.plant_recommendations || [],
      soil_recommendations: item.soil_recommendations || [],
      soil_issues: item.soil_issues || [],
      date_predicted: item.date_predicted,
      combined_confidence_score: item.combined_confidence_score,
      tomato_type: item.tomato_type,
      overall_health: item.overall_health,
      mode: item.mode || 'batch_image_only',
      batch_timestamp: item.batch_timestamp,
      batch_index: item.batch_index,
      plant_health_score: item.plant_health_score,
      soil_quality_score: item.soil_quality_score,
      has_soil_data: item.has_soil_data || false,
      timestamp: item.date_predicted
    }));

    res.json({
      success: true,
      history: formattedHistory,
      count: formattedHistory.length,
      batch_count: formattedHistory.length,
      images_with_urls: formattedHistory.filter(item => item.image_url).length,
      user_id: userId,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Error fetching batch history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch batch history: ' + error.message
    });
  }
});

// Get latest batch analysis result - FIXED WITH NEW COLUMNS
router.get('/results/latest', async (req, res) => {
  try {
    const userId = req.query.userId;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }
    
    console.log(`📊 Fetching latest batch analysis result for user ${userId}...`);
    
    let history = [];
    if (typeof storageService.getAnalysisHistory === 'function') {
      try {
        history = await storageService.getAnalysisHistory(userId, 20);
      } catch (error) {
        console.warn('⚠️ Error fetching latest analysis history:', error.message);
        history = [];
      }
    } else {
      console.warn('⚠️ getAnalysisHistory method not available');
      history = [];
    }
    
    // Find latest batch analysis
    const batchHistory = history.filter(item => 
      item.mode === 'batch_image_only' || 
      item.mode === 'batch_integrated' ||
      item.mode === 'batch_soil_only' ||
      (item.batch_timestamp && item.batch_timestamp !== '')
    );
    
    if (batchHistory.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No batch analysis results found'
      });
    }
    
    const latestAnalysis = batchHistory[0];
    
    // Get all analyses from the same batch
    const batchAnalyses = history.filter(item => 
      item.batch_timestamp === latestAnalysis.batch_timestamp
    );
    
    // FIXED: Format analysis with new recommendation columns
    const formattedAnalysis = {
      id: latestAnalysis.prediction_id || latestAnalysis.id,
      user_id: latestAnalysis.user_id,
      batch_id: latestAnalysis.batch_timestamp,
      batch_size: batchAnalyses.length,
      mode: latestAnalysis.mode || 'batch_image_only',
      health_status: latestAnalysis.health_status,
      disease_type: latestAnalysis.disease_type,
      soil_status: latestAnalysis.soil_status,
      // ✅ REPLACED: Using new columns instead of old recommendations
      plant_recommendations: latestAnalysis.plant_recommendations || [],
      soil_recommendations: latestAnalysis.soil_recommendations || [],
      soil_issues: latestAnalysis.soil_issues || [],
      date_predicted: latestAnalysis.date_predicted,
      combined_confidence_score: latestAnalysis.combined_confidence_score,
      tomato_type: latestAnalysis.tomato_type,
      overall_health: latestAnalysis.overall_health,
      plant_health_score: latestAnalysis.plant_health_score,
      soil_quality_score: latestAnalysis.soil_quality_score,
      has_soil_data: latestAnalysis.has_soil_data || false,
      batch_summary: {
        total: batchAnalyses.length,
        healthy: batchAnalyses.filter(item => 
          item.overall_health === 'Healthy' || item.health_status === 'Healthy'
        ).length,
        unhealthy: batchAnalyses.filter(item => 
          item.overall_health !== 'Healthy' && item.health_status !== 'Healthy'
        ).length,
        top_disease: calculateTopDisease(batchAnalyses)
      },
      timestamp: latestAnalysis.date_predicted
    };

    res.json({
      success: true,
      analysis: formattedAnalysis,
      user_id: userId,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Error fetching latest batch analysis:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch latest batch analysis: ' + error.message
    });
  }
});

// Get batch analysis statistics
router.get('/stats/summary', async (req, res) => {
  try {
    const userId = req.query.userId;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }
    
    console.log(`📈 Fetching batch analysis statistics for user ${userId}`);
    
    let history = [];
    if (typeof storageService.getAnalysisHistory === 'function') {
      try {
        history = await storageService.getAnalysisHistory(userId, 500);
      } catch (error) {
        console.warn('⚠️ Error fetching analysis history:', error.message);
        history = [];
      }
    } else {
      console.warn('⚠️ getAnalysisHistory method not available');
      history = [];
    }
    
    // Filter for batch analyses
    const batchHistory = history.filter(item => 
      item.mode === 'batch_image_only' || 
      item.mode === 'batch_integrated' ||
      item.mode === 'batch_soil_only' ||
      (item.batch_timestamp && item.batch_timestamp !== '')
    );
    
    // Group by batch
    const batchGroups = {};
    batchHistory.forEach(item => {
      const batchId = item.batch_timestamp || 
                     new Date(item.date_predicted).toISOString().split('T')[0];
      if (!batchGroups[batchId]) {
        batchGroups[batchId] = {
          batch_id: batchId,
          analyses: [],
          date: item.date_predicted
        };
      }
      batchGroups[batchId].analyses.push(item);
    });
    
    const batches = Object.values(batchGroups);
    
    const stats = {
      total_batches: batches.length,
      total_batch_analyses: batchHistory.length,
      average_batch_size: batches.length > 0 ? 
        Math.round(batchHistory.length / batches.length) : 0,
      batch_health_distribution: {
        excellent: batches.filter(batch => 
          batch.analyses.filter(a => a.overall_health === 'Healthy').length / batch.analyses.length > 0.8
        ).length,
        good: batches.filter(batch => {
          const healthyRatio = batch.analyses.filter(a => a.overall_health === 'Healthy').length / batch.analyses.length;
          return healthyRatio > 0.5 && healthyRatio <= 0.8;
        }).length,
        fair: batches.filter(batch => {
          const healthyRatio = batch.analyses.filter(a => a.overall_health === 'Healthy').length / batch.analyses.length;
          return healthyRatio > 0.2 && healthyRatio <= 0.5;
        }).length,
        poor: batches.filter(batch => 
          batch.analyses.filter(a => a.overall_health === 'Healthy').length / batch.analyses.length <= 0.2
        ).length
      },
      most_common_diseases: calculateMostCommonDiseases(batchHistory),
      analysis_mode_distribution: {
        image_only: batchHistory.filter(item => item.mode === 'batch_image_only').length,
        integrated: batchHistory.filter(item => item.mode === 'batch_integrated').length,
        soil_only: batchHistory.filter(item => item.mode === 'batch_soil_only').length
      },
      recent_trend: calculateBatchTrend(batches.slice(0, 5))
    };

    res.json({
      success: true,
      statistics: stats,
      user_id: userId,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Error fetching batch statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch batch statistics: ' + error.message
    });
  }
});

// Health check for batch analysis service
router.get('/health/status', async (req, res) => {
  try {
    const userId = req.query.userId;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }
    
    const storageHealth = typeof storageService.healthCheck === 'function' 
      ? await storageService.healthCheck()
      : { status: 'unavailable', message: 'healthCheck method not available' };
    const mlHealth = mlService.healthCheck();
    
    // Check batch capabilities with defensive fallbacks
    let recentImages = [];
    if (typeof storageService.getImagesForAnalysis === 'function') {
      try {
        recentImages = await storageService.getImagesForAnalysis(userId, 10, true);
      } catch (error) {
        console.warn('⚠️ Error getting images for health check:', error.message);
      }
    } else {
      console.warn('⚠️ getImagesForAnalysis method not available');
    }
    
    let batchHistory = [];
    if (typeof storageService.getAnalysisHistory === 'function') {
      try {
        const allHistory = await storageService.getAnalysisHistory(userId, 20);
        batchHistory = allHistory.filter(item => item.mode && item.mode.includes('batch'));
      } catch (error) {
        console.warn('⚠️ Error getting batch history for health check:', error.message);
      }
    } else {
      console.warn('⚠️ getAnalysisHistory method not available');
    }
    
    res.json({
      success: true,
      health: {
        storage: storageHealth,
        ml_service: {
          status: mlHealth.initialized ? 'tflite_ready' : 'fallback_mode',
          model_loaded: mlHealth.model_loaded,
          using_tflite: mlHealth.initialized,
          runtime: mlHealth.runtime,
          supports_batch: true,
          batch_max_size: 50,
          batch_concurrent: 10
        },
        batch_status: {
          unanalyzed_images: recentImages.length,
          recent_batches: batchHistory.length,
          last_batch: batchHistory.length > 0 ? batchHistory[0].date_predicted : 'No batch analyses yet'
        }
      },
      user_id: userId,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Error in batch analysis health check:', error);
    res.status(500).json({
      success: false,
      message: 'Batch analysis health check failed: ' + error.message
    });
  }
});

// Helper function to calculate top diseases
function calculateTopDiseases(analyses) {
  const diseaseCounts = {};
  analyses.forEach(analysis => {
    const disease = analysis.disease_type || 'Unknown';
    diseaseCounts[disease] = (diseaseCounts[disease] || 0) + 1;
  });
  
  return Object.entries(diseaseCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([disease, count]) => ({ disease, count }));
}

// Helper function to calculate top disease for a batch
function calculateTopDisease(analyses) {
  const diseaseCounts = {};
  analyses.forEach(analysis => {
    const disease = analysis.disease_type || 'Unknown';
    if (disease !== 'Healthy' && disease !== 'Unknown') {
      diseaseCounts[disease] = (diseaseCounts[disease] || 0) + 1;
    }
  });
  
  if (Object.keys(diseaseCounts).length === 0) {
    return { disease: 'Healthy', count: analyses.length };
  }
  
  const topDisease = Object.entries(diseaseCounts)
    .sort((a, b) => b[1] - a[1])[0];
  
  return { disease: topDisease[0], count: topDisease[1] };
}

// Helper function to calculate most common diseases
function calculateMostCommonDiseases(analyses) {
  const diseaseCounts = {};
  analyses.forEach(analysis => {
    const disease = analysis.disease_type || 'Unknown';
    diseaseCounts[disease] = (diseaseCounts[disease] || 0) + 1;
  });
  
  return Object.entries(diseaseCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([disease, count]) => ({ 
      disease, 
      count,
      percentage: Math.round((count / analyses.length) * 100)
    }));
}

// Helper function to calculate batch trend
function calculateBatchTrend(batches) {
  if (batches.length < 2) return 'insufficient_data';
  
  const recentHealthRates = batches.map(batch => {
    const healthyCount = batch.analyses.filter(a => a.overall_health === 'Healthy').length;
    return healthyCount / batch.analyses.length;
  });
  
  const first = recentHealthRates[0];
  const last = recentHealthRates[recentHealthRates.length - 1];
  
  if (last > first + 0.1) return 'improving';
  if (last < first - 0.1) return 'declining';
  return 'stable';
}

// Helper function to format recommendations - KEPT for backward compatibility but not used in new code
function formatRecommendations(recommendations) {
  if (!recommendations) return [];
  
  if (typeof recommendations === 'string') {
    if (recommendations.includes(';')) {
      return recommendations.split(';').map(rec => rec.trim()).filter(rec => rec.length > 0);
    } else if (recommendations.includes('\n')) {
      return recommendations.split('\n').map(rec => rec.trim()).filter(rec => rec.length > 0);
    } else {
      return [recommendations.trim()];
    }
  }
  
  if (Array.isArray(recommendations)) {
    return recommendations.map(rec => rec?.toString() || '').filter(rec => rec.length > 0);
  }
  
  return [];
}

module.exports = router;
