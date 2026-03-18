const supabaseService = require('./supabaseService');

class StorageService {
  constructor() {
    this.ready = false;
    this.initializing = false;
    this.client = supabaseService.client;
    this.initialize();
  }

  async initialize() {
    if (this.initializing) {
      return;
    }

    this.initializing = true;
    
    try {
      console.log('🔧 Initializing Storage Service...');
      
      const supabaseReady = await supabaseService.waitForInitialization(30000);
      
      if (supabaseReady) {
        this.ready = true;
        this.client = supabaseService.client;
        console.log('✅ Storage service initialized (Supabase)');
      } else {
        console.error('❌ Supabase service not ready after waiting');
        throw new Error('Supabase service not ready');
      }
    } catch (error) {
      console.error('❌ Storage service initialization failed:', error.message);
      this.ready = false;
    } finally {
      this.initializing = false;
    }
  }

  async waitForReady(maxWaitTime = 10000) {
    if (this.ready) {
      return true;
    }

    const startTime = Date.now();
    while ((!this.ready && !this.initializing) || (this.initializing && Date.now() - startTime < maxWaitTime)) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    if (!this.ready) {
      console.warn('⚠️ Storage service not ready after waiting', { maxWaitTime });
      await this.initialize();
    }
    
    return this.ready;
  }

  async _executeWithRetry(operation, operationName, maxRetries = 2) {
    if (!this.ready) {
      await this.waitForReady();
      if (!this.ready) {
        throw new Error('Storage service not ready after waiting');
      }
    }

    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        console.warn(`⚠️ ${operationName} attempt ${attempt} failed:`, error.message);
        
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 500 * attempt));
          if (error.message.includes('not ready') || error.message.includes('initialization')) {
            await this.initialize();
          }
        }
      }
    }
    
    console.error(`❌ ${operationName} failed after ${maxRetries} attempts:`, lastError.message);
    throw lastError;
  }

  // ============ BATCH IMAGE METHODS ============

  async storeBatchImages(imageDataArray, userId) {
    return this._executeWithRetry(
      async () => {
        console.log(`🔄 Storing batch of ${imageDataArray.length} images for user ${userId}`);
        
        const results = [];
        const errors = [];
        const batchTimestamp = imageDataArray[0]?.batch_timestamp || new Date().toISOString();
        
        console.log(`📊 Using batch timestamp: ${batchTimestamp}`);

        for (let i = 0; i < imageDataArray.length; i++) {
          try {
            const imageData = imageDataArray[i];
            const { imageBytes, filename, brightness, contrast, saturation } = imageData;
            const batchIndex = imageData.batch_index !== undefined ? imageData.batch_index : i;
            
            console.log(`📤 Processing batch image ${i + 1}/${imageDataArray.length}: ${filename}`);
            
            const result = await supabaseService.uploadBatchImage(
              imageBytes, 
              filename, 
              userId,
              { 
                brightness: parseFloat(brightness || 75), 
                contrast: parseFloat(contrast || 75), 
                saturation: parseFloat(saturation || 75),
                batch_timestamp: batchTimestamp,
                batch_index: batchIndex
              }
            );
            
            console.log(`✅ Batch image ${i + 1} stored successfully: ${result.file_path}`);

            results.push({
              success: true,
              index: i,
              batch_index: batchIndex,
              imageId: result.image_id,
              imageUrl: result.image_path,
              publicUrl: result.publicUrl,
              filePath: result.file_path,
              filename: result.filename,
              brightness: parseFloat(brightness || 75),
              contrast: parseFloat(contrast || 75),
              saturation: parseFloat(saturation || 75),
              batch_timestamp: batchTimestamp, // ⚠️ CRITICAL: Ensure same timestamp
              fileSize: result.file_size,
              uploadedAt: result.date_captured,
              userId: result.user_id
            });

          } catch (error) {
            console.error(`❌ Error storing batch image ${i + 1}:`, error.message);
            errors.push({
              index: i,
              filename: imageDataArray[i]?.filename || `batch_image_${i + 1}`,
              error: error.message
            });
          }
        }

        return {
          total: imageDataArray.length,
          successful: results.length,
          failed: errors.length,
          batchTimestamp: batchTimestamp, // ⚠️ CRITICAL: Return the timestamp
          results: results,
          errors: errors.length > 0 ? errors : undefined
        };
      },
      'storeBatchImages'
    );
  }

  async getImagesByBatch(batchTimestamp, userId, limit = 100) {
    return this._executeWithRetry(
      async () => {
        console.log(`📁 Getting images from batch ${batchTimestamp} for user ${userId}`);
        
        const { data, error } = await this.client
          .from('image_data')
          .select('*')
          .eq('user_id', userId)
          .eq('batch_timestamp', batchTimestamp)
          .order('batch_index', { ascending: true })
          .limit(limit);
        
        if (error) throw error;
        
        console.log(`✅ Found ${data?.length || 0} images in batch`);
        return data || [];
      },
      'getImagesByBatch'
    );
  }

  async getUserBatches(userId, limit = 10) {
    return this._executeWithRetry(
      async () => {
        console.log(`📚 Getting batches for user ${userId}, limit: ${limit}`);
        
        // Get unique batch timestamps with count
        const { data: batchesData, error } = await this.client
          .from('image_data')
          .select('batch_timestamp, date_captured, user_id')
          .eq('user_id', userId)
          .not('batch_timestamp', 'is', null)
          .order('date_captured', { ascending: false });
        
        if (error) throw error;
        
        // Group by batch_timestamp and get latest date
        const batchMap = new Map();
        if (batchesData && batchesData.length > 0) {
          batchesData.forEach(item => {
            if (item.batch_timestamp) {
              if (!batchMap.has(item.batch_timestamp)) {
                batchMap.set(item.batch_timestamp, {
                  batch_timestamp: item.batch_timestamp,
                  date_captured: item.date_captured,
                  image_count: 0
                });
              } else {
                // Keep the latest date
                const existing = batchMap.get(item.batch_timestamp);
                if (new Date(item.date_captured) > new Date(existing.date_captured)) {
                  existing.date_captured = item.date_captured;
                }
              }
            }
          });
        }
        
        // Get count for each batch
        for (const [batchTimestamp, batchInfo] of batchMap.entries()) {
          const { count, error: countError } = await this.client
            .from('image_data')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId)
            .eq('batch_timestamp', batchTimestamp);
            
          if (!countError) {
            batchInfo.image_count = count || 0;
          }
        }
        
        // Convert to array, sort by date, and limit
        const batches = Array.from(batchMap.values())
          .sort((a, b) => new Date(b.date_captured) - new Date(a.date_captured))
          .slice(0, limit);
        
        console.log(`✅ Found ${batches.length} batches for user`);
        return batches;
      },
      'getUserBatches'
    );
  }

  // ============ GET IMAGE BY ID ============

async getImageById(imageId, userId = null) {
  return this._executeWithRetry(
    async () => {
      console.log(`🔍 Getting image by ID: ${imageId}${userId ? ` for user ${userId}` : ''}`);
      
      let query = this.client
        .from('image_data')
        .select('*')
        .eq('image_id', imageId);
      
      if (userId) {
        query = query.eq('user_id', userId);
      }
      
      const { data, error } = await query.single();
      
      if (error) {
        if (error.code === 'PGRST116') {
          console.log(`⚠️ Image not found with ID: ${imageId}`);
          return null;
        }
        throw error;
      }
      
      console.log(`✅ Found image by ID: ${imageId}`);
      return data;
    },
    'getImageById'
  );
}


  async getImagesForAnalysis(userId, limit = 50, includeUnanalyzed = true) {
    return this._executeWithRetry(
      async () => {
        console.log(`📷 Getting images for analysis for user: ${userId}, limit: ${limit}, unanalyzed: ${includeUnanalyzed}`);
        
        let query = this.client
          .from('image_data')
          .select('*')
          .eq('user_id', userId)
          .order('date_captured', { ascending: false })
          .limit(limit);
        
        if (includeUnanalyzed) {
          try {
            const { data: analyzedImages, error: analyzedError } = await this.client
              .from('prediction_results')
              .select('image_id')
              .eq('user_id', userId);
              
            if (analyzedError && analyzedError.code !== 'PGRST116') {
              console.error('Error fetching analyzed images:', analyzedError);
            }
            
            const analyzedImageIds = analyzedImages ? analyzedImages.map(img => img.image_id) : [];
            
            if (analyzedImageIds.length > 0) {
              query = query.not('image_id', 'in', `(${analyzedImageIds.join(',')})`);
            }
          } catch (error) {
            console.warn('⚠️ Could not fetch analyzed images, proceeding with all images:', error.message);
          }
        }
        
        const { data, error } = await query;
        
        if (error) throw error;
        
        console.log(`✅ Found ${data?.length || 0} images for analysis`);
        return data || [];
      },
      'getImagesForAnalysis'
    );
  }

  async getImagePublicUrl(imagePath) {
    return this._executeWithRetry(
      async () => {
        if (!this.client) return null;
        
        const { data } = this.client.storage
          .from('images')
          .getPublicUrl(imagePath);
        
        return data?.publicUrl || null;
      },
      'getImagePublicUrl'
    );
  }

async storeBatchAnalysisResults(results, userId) {
    return this._executeWithRetry(
        async () => {
            console.log(`💾 Storing ${results.length} batch analysis results for user ${userId}`);
            
            // Validate input
            if (!results || !Array.isArray(results) || results.length === 0) {
                throw new Error('No results to store');
            }
            
            // Get batch timestamp from first result
            const batchTimestamp = results[0]?.batch_timestamp;
            if (!batchTimestamp) {
                console.error('❌ Batch timestamp is missing from results');
                throw new Error('Batch timestamp is required for storing batch results');
            }
            
            console.log(`📊 Using batch timestamp: ${batchTimestamp}`);
            
            const insertedResults = [];
            const errors = [];
            
            // Process each result
            for (let i = 0; i < results.length; i++) {
                const result = results[i];
                
                try {
                    // Validate required fields
                    if (!result.image_id) {
                        console.warn(`⚠️ Skipping result ${i}: Missing image_id`);
                        errors.push({
                            index: i,
                            error: 'Missing image_id'
                        });
                        continue;
                    }
                    
                    // Log what we're storing
                    console.log(`📝 Processing result ${i} for image ${result.image_id}:`, {
                        has_overall_health: 'overall_health' in result,
                        overall_health_value: result.overall_health,
                        has_soil_quality_score: 'soil_quality_score' in result,
                        soil_quality_score_value: result.soil_quality_score,
                        mode: result.mode
                    });
                    
                    // Prepare data for database insertion - ensure all fields match database schema
                    const resultToStore = {
                        user_id: userId,
                        image_id: result.image_id,
                        soil_id: result.soil_id || null,
                        health_status: result.health_status || result.overall_health || 'Unknown',
                        disease_type: result.disease_type || 'Unknown',
                        soil_status: result.soil_status || 'Unknown',
                        recommendations: this.formatRecommendationsForStorage(result.recommendations),
                        combined_confidence_score: result.combined_confidence_score || 0.5,
                        tomato_type: result.tomato_type || 'Unknown',
                        overall_health: result.overall_health || 'Unknown',
                        soil_issues: this.formatSoilIssuesForStorage(result.soil_issues),
                        plant_health_score: result.plant_health_score || null,
                        soil_quality_score: result.soil_quality_score || null,
                        has_soil_data: result.has_soil_data !== undefined ? result.has_soil_data : (!!result.soil_id),
                        mode: result.mode || 'batch_image_only',
                        batch_timestamp: batchTimestamp,
                        batch_index: result.batch_index || i,
                        date_predicted: result.date_predicted || new Date().toISOString()
                    };
                    
                    // Validate numeric fields
                    if (resultToStore.soil_quality_score !== null) {
                        resultToStore.soil_quality_score = parseFloat(resultToStore.soil_quality_score) || null;
                    }
                    
                    if (resultToStore.plant_health_score !== null) {
                        resultToStore.plant_health_score = parseFloat(resultToStore.plant_health_score) || null;
                    }
                    
                    // Insert into database
                    console.log(`🔄 Inserting into database for image ${result.image_id}...`);
                    const { data, error } = await this.client
                        .from('prediction_results')
                        .insert(resultToStore)
                        .select()
                        .single();
                    
                    if (error) {
                        console.error(`❌ Database error for image ${result.image_id}:`, {
                            message: error.message,
                            details: error.details,
                            code: error.code
                        });
                        
                        // Try simpler insert as fallback
                        try {
                            console.log(`🔄 Trying fallback insert for image ${result.image_id}...`);
                            const fallbackData = {
                                user_id: userId,
                                image_id: result.image_id,
                                batch_timestamp: batchTimestamp,
                                batch_index: result.batch_index || i,
                                date_predicted: new Date().toISOString(),
                                health_status: 'Error',
                                disease_type: 'Storage Error',
                                overall_health: 'Unknown'
                            };
                            
                            const { data: fallbackResult } = await this.client
                                .from('prediction_results')
                                .insert(fallbackData)
                                .select()
                                .single();
                                
                            console.log(`✅ Stored fallback record for image ${result.image_id}`);
                            insertedResults.push(fallbackResult);
                        } catch (fallbackError) {
                            console.error(`❌ Fallback also failed for image ${result.image_id}:`, fallbackError.message);
                            errors.push({
                                index: i,
                                image_id: result.image_id,
                                error: error.message,
                                fallback_error: fallbackError.message
                            });
                        }
                        continue;
                    }
                    
                    console.log(`✅ Successfully stored analysis for image ${result.image_id}, ID: ${data.prediction_id}`);
                    insertedResults.push(data);
                    
                } catch (error) {
                    console.error(`❌ Exception processing result ${i}:`, error.message);
                    errors.push({
                        index: i,
                        image_id: result?.image_id,
                        error: error.message
                    });
                }
            }
            
            // Return summary
            const summary = {
                stored_count: insertedResults.length,
                failed_count: errors.length,
                batch_timestamp: batchTimestamp,
                results: insertedResults
            };
            
            if (errors.length > 0) {
                summary.errors = errors;
            }
            
            console.log(`📊 Storage summary: ${insertedResults.length} stored, ${errors.length} failed`);
            return summary;
        },
        'storeBatchAnalysisResults'
    );
}

// Add these helper methods to StorageService class:
formatRecommendationsForStorage(recommendations) {
    if (!recommendations) return null;
    
    if (Array.isArray(recommendations)) {
        // Filter out empty recommendations and join with semicolon
        const validRecs = recommendations.filter(rec => {
            if (!rec) return false;
            const strRec = String(rec).trim();
            return strRec.length > 0 && strRec !== 'undefined' && strRec !== 'null';
        });
        
        if (validRecs.length === 0) return null;
        return validRecs.join('; ');
    }
    
    if (typeof recommendations === 'string') {
        const trimmed = recommendations.trim();
        return trimmed.length > 0 ? trimmed : null;
    }
    
    return null;
}

formatSoilIssuesForStorage(soilIssues) {
    if (!soilIssues) return null;
    
    if (Array.isArray(soilIssues)) {
        // Filter out empty issues and join with semicolon
        const validIssues = soilIssues.filter(issue => {
            if (!issue) return false;
            const strIssue = String(issue).trim();
            return strIssue.length > 0 && strIssue !== 'undefined' && strIssue !== 'null';
        });
        
        if (validIssues.length === 0) return null;
        return validIssues.join('; ');
    }
    
    if (typeof soilIssues === 'string') {
        const trimmed = soilIssues.trim();
        return trimmed.length > 0 ? trimmed : null;
    }
    
    return null;
}

// Add these helper methods to StorageService class if they don't exist:

formatRecommendationsForStorage(recommendations) {
    if (!recommendations) return null;
    
    if (Array.isArray(recommendations)) {
        return recommendations.filter(rec => rec && rec.trim()).join('; ');
    }
    
    if (typeof recommendations === 'string') {
        return recommendations.trim();
    }
    
    return null;
}

formatSoilIssuesForStorage(soilIssues) {
    if (!soilIssues) return null;
    
    if (Array.isArray(soilIssues)) {
        return soilIssues.filter(issue => issue && issue.trim()).join('; ');
    }
    
    if (typeof soilIssues === 'string') {
        return soilIssues.trim();
    }
    
    return null;
}

  async getUserImages(userId, limit = 10) {
    return this._executeWithRetry(
      async () => {
        console.log(`📸 Getting user images for: ${userId}, limit: ${limit}`);
        
        const { data, error } = await this.client
          .from('image_data')
          .select('*')
          .eq('user_id', userId)
          .order('date_captured', { ascending: false })
          .limit(limit);

        if (error) throw error;
        return data || [];
      },
      'getUserImages'
    );
  }

  async getLatestImage(userId) {
    return this._executeWithRetry(
      async () => {
        console.log('🔍 Getting latest image for user:', userId);
        
        const { data, error } = await this.client
          .from('image_data')
          .select('*')
          .eq('user_id', userId)
          .order('date_captured', { ascending: false })
          .limit(1)
          .single();

        if (error && error.code !== 'PGRST116') throw error;
        return data;
      },
      'getLatestImage'
    );
  }

  async getImageByFilePath(filePath, userId) {
    return this._executeWithRetry(
      async () => {
        const { data, error } = await this.client
          .from('image_data')
          .select('*')
          .eq('file_path', filePath)
          .eq('user_id', userId)
          .single();

        if (error) throw error;
        return data;
      },
      'getImageByFilePath'
    );
  }

  // ============ IMAGE DELETION METHODS ============

  async deleteImage(filePath, userId) {
    return this._executeWithRetry(
      async () => {
        console.log(`🗑️ Deleting image ${filePath} for user ${userId}`);
        
        // Delete from storage first
        const { error: storageError } = await this.client.storage
          .from('images')
          .remove([filePath]);
        
        if (storageError) throw storageError;
        
        // Delete from database
        const { error: dbError } = await this.client
          .from('image_data')
          .delete()
          .eq('image_path', filePath)
          .eq('user_id', userId);
        
        if (dbError) throw dbError;
        
        return { success: true, message: 'Image deleted successfully' };
      },
      'deleteImage'
    );
  }

  async deleteUserImages(userId) {
    return this._executeWithRetry(
      async () => {
        console.log(`🗑️ Deleting all images for user ${userId}`);
        
        const userImages = await this.getUserImages(userId, 1000);
        
        if (userImages.length === 0) {
          return { success: true, message: 'No images to delete' };
        }

        // Delete from storage
        const filePaths = userImages.map(img => img.image_path);
        const { error: storageError } = await this.client.storage
          .from('images')
          .remove(filePaths);

        if (storageError) throw storageError;

        // Delete from database
        const { error: dbError } = await this.client
          .from('image_data')
          .delete()
          .eq('user_id', userId);

        if (dbError) throw dbError;

        return { 
          success: true, 
          message: `Deleted ${userImages.length} images successfully`,
          deletedCount: userImages.length 
        };
      },
      'deleteUserImages'
    );
  }

  // ============ SOIL DATA METHODS ============

  async storeSoilData(userId, soilData) {
    return this._executeWithRetry(
      async () => {
        console.log('🌱 Storing soil data for user:', userId, soilData);
        
        const { data, error } = await this.client
          .from('soil_data')
          .insert({
            user_id: userId,
            humidity: soilData.humidity,
            ph: soilData.ph,
            nitrogen: soilData.nitrogen,
            phosphorus: soilData.phosphorus,
            potassium: soilData.potassium,
            temperature: soilData.temperature,
            conductivity: soilData.conductivity,
            date_gathered: new Date().toISOString()
          })
          .select()
          .single();

        if (error) throw error;
        return data;
      },
      'storeSoilData'
    );
  }

  async getLatestSoilData(userId) {
    return this._executeWithRetry(
      async () => {
        console.log('🌱 Fetching latest soil data for user:', userId);
        
        const { data, error } = await this.client
          .from('soil_data')
          .select('*')
          .eq('user_id', userId)
          .order('date_gathered', { ascending: false })
          .limit(1)
          .single();

        if (error) {
          if (error.code === 'PGRST116') {
            console.log('⚠️ No soil data found for user:', userId);
            return null;
          }
          throw error;
        }

        console.log('✅ Found soil data for user:', userId);
        return data;
      },
      'getLatestSoilData'
    );
  }

  // ============ ANALYSIS RESULTS METHODS ============

  async storeAnalysisResult(userId, analysisData) {
    return this._executeWithRetry(
      async () => {
        console.log('📊 Storing analysis result for user:', userId);
        
        const { data, error } = await this.client
          .from('prediction_results')
          .insert({
            user_id: userId,
            image_id: analysisData.imageId,
            soil_id: analysisData.soilId,
            health_status: analysisData.healthStatus || analysisData.overallHealth,
            disease_type: analysisData.diseaseDetected || analysisData.diseaseType,
            soil_status: analysisData.soilHealth,
            recommendations: Array.isArray(analysisData.recommendations) ? 
              analysisData.recommendations.join('; ') : analysisData.recommendations,
            date_predicted: new Date().toISOString()
          })
          .select()
          .single();

        if (error) throw error;
        return data;
      },
      'storeAnalysisResult'
    );
  }

  async getAnalysisHistory(userId, limit = 10) {
    return this._executeWithRetry(
      async () => {
        console.log(`📚 Getting analysis history for user: ${userId}, limit: ${limit}`);
        
        const { data, error } = await this.client
          .from('prediction_results')
          .select(`
            *,
            soil_data (*),
            image_data (*)
          `)
          .eq('user_id', userId)
          .order('date_predicted', { ascending: false })
          .limit(limit);

        if (error) throw error;
        return data || [];
      },
      'getAnalysisHistory'
    );
  }

  async getLatestAnalysis(userId) {
    return this._executeWithRetry(
      async () => {
        console.log(`🔍 Getting latest analysis for user: ${userId}`);
        
        const { data, error } = await this.client
          .from('prediction_results')
          .select(`
            *,
            soil_data (*),
            image_data (*)
          `)
          .eq('user_id', userId)
          .order('date_predicted', { ascending: false })
          .limit(1)
          .single();

        if (error) {
          if (error.code === 'PGRST116') {
            console.log('⚠️ No analysis found for user:', userId);
            return null;
          }
          throw error;
        }

        console.log('✅ Found latest analysis for user:', userId);
        return data;
      },
      'getLatestAnalysis'
    );
  }

  // ============ USAGE STATISTICS ============

  async getUsageStatistics(userId = null) {
    return this._executeWithRetry(
      async () => {
        let imageQuery = this.client
          .from('image_data')
          .select('image_id', { count: 'exact' });

        if (userId) {
          imageQuery = imageQuery.eq('user_id', userId);
        }

        const { count, error } = await imageQuery;

        if (error) throw error;

        const imageCount = count || 0;

        return {
          imageCount,
          totalScans: imageCount,
          userCount: 1,
          timestamp: new Date().toISOString()
        };
      },
      'getUsageStatistics'
    );
  }

  async getUserStorageStats(userId) {
    return this._executeWithRetry(
      async () => {
        const usageStats = await this.getUsageStatistics(userId);
        const userImages = await this.getUserImages(userId, 1000);
        
        return {
          userId: userId,
          imageCount: usageStats.imageCount || 0,
          totalStorageBytes: usageStats.totalStorageBytes || 0,
          totalStorageMB: usageStats.totalStorageMB || 0,
          lastImageDate: userImages.length > 0 ? userImages[0].date_captured : null
        };
      },
      'getUserStorageStats'
    );
  }

  // ============ HEALTH CHECK ============

  async healthCheck() {
    try {
      const { data: dbTest, error: dbError } = await this.client
        .from('image_data')
        .select('count')
        .limit(1);

      const { error: storageError } = await this.client.storage
        .from('images')
        .list('', { limit: 1 });

      return {
        database: dbError ? 'error' : 'connected',
        storage: storageError ? 'error' : 'connected',
        overall: this.ready ? 'ready' : 'not_ready',
        errors: {
          database: dbError?.message,
          storage: storageError?.message
        },
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        database: 'error',
        storage: 'error',
        overall: 'error',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  getStatus() {
    return {
      ready: this.ready,
      initializing: this.initializing,
      supabaseReady: supabaseService.initialized
    };
  }

  async reinitialize() {
    console.log('🔄 Force reinitializing Storage Service...');
    this.ready = false;
    await this.initialize();
    return this.ready;
  }

  // ============ DEBUG/ADMIN METHODS ============

  async getAllImages(limit = 50) {
    return this._executeWithRetry(
      async () => {
        const { data, error } = await this.client
          .from('image_data')
          .select('*')
          .order('date_captured', { ascending: false })
          .limit(limit);

        if (error) throw error;
        return data || [];
      },
      'getAllImages'
    );
  }

  // ============ NEW METHODS FOR BATCH TIMESTAMP FIX ============

  async getBatchAnalyses(batchTimestamp, userId) {
    return this._executeWithRetry(
      async () => {
        console.log(`🔍 Getting analyses for batch ${batchTimestamp}, user ${userId}`);
        
        const { data, error } = await this.client
          .from('prediction_results')
          .select('*')
          .eq('user_id', userId)
          .eq('batch_timestamp', batchTimestamp)
          .order('batch_index', { ascending: true });
        
        if (error) throw error;
        
        console.log(`✅ Found ${data?.length || 0} analyses for batch`);
        return data || [];
      },
      'getBatchAnalyses'
    );
  }

  async getBatchWithTimestampCorrection(batchTimestamp, userId) {
    return this._executeWithRetry(
      async () => {
        console.log(`🔍 Getting batch with timestamp correction: ${batchTimestamp}`);
        
        // Try exact match first
        let data = await this.getBatchAnalyses(batchTimestamp, userId);
        
        if (data.length === 0) {
          console.log('🔄 Trying partial timestamp match...');
          
          // If no exact match, try to find similar timestamps
          const { data: allAnalyses, error } = await this.client
            .from('prediction_results')
            .select('*')
            .eq('user_id', userId)
            .order('date_predicted', { ascending: false })
            .limit(50);
          
          if (error) throw error;
          
          // Find analyses with similar timestamp (within 1 second)
          const normalizedRequest = batchTimestamp.replace('Z', '+00:00');
          data = allAnalyses.filter(analysis => {
            if (!analysis.batch_timestamp) return false;
            
            const normalizedAnalysis = analysis.batch_timestamp;
            
            // Check if timestamps are within 1 second
            const requestTime = new Date(normalizedRequest).getTime();
            const analysisTime = new Date(normalizedAnalysis).getTime();
            const timeDiff = Math.abs(requestTime - analysisTime);
            
            return timeDiff < 1000; // Within 1 second
          });
          
          console.log(`🔄 Found ${data.length} analyses with similar timestamp`);
        }
        
        return data;
      },
      'getBatchWithTimestampCorrection'
    );
  }
  

  
}

module.exports = new StorageService();