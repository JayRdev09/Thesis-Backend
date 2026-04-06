const { createClient } = require('@supabase/supabase-js');

class SupabaseService {
  constructor() {
    this.initialized = false;
    this.client = null;
    this.initializeSupabase();
  }

  initializeSupabase() {
    try {
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
      
      console.log('🔧 Initializing Supabase...');
      console.log('📋 Supabase URL:', supabaseUrl ? 'Provided' : 'Missing');
      console.log('🔑 Supabase Key:', supabaseKey ? 'Provided' : 'Missing');
      
      if (!supabaseUrl || !supabaseKey) {
        throw new Error('Supabase URL and Service Key are required in environment variables');
      }

      if (!supabaseUrl.startsWith('https://')) {
        throw new Error('Supabase URL must start with https://');
      }

      this.client = createClient(supabaseUrl, supabaseKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: true,
          flowType: 'pkce' 
        },
        global: {
          headers: {
            'x-application-name': 'tomato-farming-backend'
          }
        }
      });

      this.testConnection().then(success => {
        if (success) {
          this.initialized = true;
          console.log('✅ Supabase initialized successfully');
        } else {
          console.error('❌ Supabase connection test failed');
          this.initialized = false;
        }
      }).catch(error => {
        console.error('❌ Supabase connection test error:', error.message);
        this.initialized = false;
      });

    } catch (error) {
      console.error('❌ Supabase initialization failed:', error.message);
      this.initialized = false;
    }
  }

  async testConnection() {
    try {
      console.log('🔍 Testing Supabase connection...');
      
      // Test database connection
      const { error: dbError } = await this.client
        .from('image_data')
        .select('count')
        .limit(1);

      if (dbError) {
        console.log(`⚠️ Database test warning:`, dbError.message);
      } else {
        console.log(`✅ Database accessible`);
      }

      // Test storage connection
      const { error: storageError } = await this.client.storage
        .from('images')
        .list('', { limit: 1 });

      if (storageError) {
        console.log('⚠️ Storage test warning:', storageError.message);
      } else {
        console.log('✅ Storage bucket accessible');
      }

      console.log('✅ Supabase connection tests completed');
      return true;

    } catch (error) {
      console.error('❌ Supabase connection test failed:', error.message);
      return false;
    }
  }

  async waitForInitialization(maxWaitTime = 5000) {
    const startTime = Date.now();
    while (!this.initialized && Date.now() - startTime < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return this.initialized;
  }

  // ========== USER MANAGEMENT METHODS ==========

  async validateUser(userId) {
    if (!userId) {
      throw new Error('User ID is required');
    }

    try {
      const { data: user, error } = await this.client
        .from('users_registered')
        .select('user_id')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) {
        console.error('Error validating user:', error);
        throw new Error(`Database error while validating user: ${error.message}`);
      }

      if (!user) {
        throw new Error(`User not found: ${userId}`);
      }

      return user;
    } catch (error) {
      console.error('User validation failed:', error);
      throw error;
    }
  }

  async createUser(userData) {
    if (!this.initialized) {
      await this.waitForInitialization();
      if (!this.initialized) throw new Error('Supabase not initialized');
    }
    
    if (!userData.email) {
      throw new Error('Email is required for user creation');
    }
    
    const { data, error } = await this.client
      .from('users_registered')
      .insert({
        first_name: userData.firstName,
        last_name: userData.lastName,
        address: userData.address,
        phone_number: userData.phoneNumber,
        email: userData.email,
        password: userData.password,
        date_registered: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async getUserByEmail(email) {
    if (!this.initialized) {
      await this.waitForInitialization();
      if (!this.initialized) throw new Error('Supabase not initialized');
    }
    
    if (!email) {
      throw new Error('Email is required');
    }
    
    const { data, error } = await this.client
      .from('users_registered')
      .select('*')
      .eq('email', email)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data;
  }

  async getUserById(userId) {
    if (!this.initialized) {
      await this.waitForInitialization();
      if (!this.initialized) throw new Error('Supabase not initialized');
    }
    
    if (!userId) {
      throw new Error('User ID is required');
    }
    
    const { data, error } = await this.client
      .from('users_registered')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error) throw error;
    return data;
  }

  async insertSystemLog({ userId = null, actionType, moduleSource = null, statusMessage = null }) {
    if (!actionType) {
      throw new Error('actionType is required for system log entry');
    }

    if (!this.initialized) {
      await this.waitForInitialization();
      if (!this.initialized) {
        throw new Error('Supabase not initialized');
      }
    }

    const { error } = await this.client
      .from('system_logs')
      .insert({
        user_id: userId || null,
        action_type: actionType,
        module_source: moduleSource || null,
        status_message: statusMessage || null,
        date_done: new Date().toISOString()
      });

    if (error) {
      console.error('❌ Failed to write system log:', error);
      throw error;
    }

    return true;
  }

  // ========== BATCH IMAGE UPLOAD METHOD ==========

  async uploadBatchImage(imageBuffer, filename, userId, metadata = {}) {
    if (!this.initialized) {
      await this.waitForInitialization();
      if (!this.initialized) throw new Error('Supabase not initialized');
    }
    
    if (!userId) {
      throw new Error('User ID is required to upload image');
    }
    
    try {
      console.log('🔄 Starting batch image upload process...');
      
      // Validate user first
      await this.validateUser(userId);
      
      // Extract metadata with defaults
      const brightness = parseFloat(metadata.brightness) || 75;
      const contrast = parseFloat(metadata.contrast) || 75;
      const saturation = parseFloat(metadata.saturation) || 75;
      const batchTimestamp = metadata.batch_timestamp || new Date().toISOString();
      const batchIndex = metadata.batch_index !== undefined ? metadata.batch_index : null;
      const folder = 'tomato-ai';
      
      // Use the images bucket
      const bucketName = 'images';
      
      // Clean and prepare filename
      let safeFilename = filename || `batch_image_${Date.now()}.jpg`;
      safeFilename = safeFilename.replace(/[^a-zA-Z0-9._-]/g, '_');
      
      // Ensure file has an extension
      if (!safeFilename.includes('.')) {
        safeFilename = `${safeFilename}.jpg`;
      }
      
      // Construct file path
      const timestamp = Date.now();
      const filePath = `${folder}/${userId}/${timestamp}_${safeFilename}`;
      
      console.log('📤 Uploading batch image to bucket:', bucketName);
      console.log('   - File path:', filePath);
      console.log('   - User ID:', userId);
      console.log('   - Batch timestamp:', batchTimestamp);
      console.log('   - Batch index:', batchIndex);
      console.log('   - File size:', imageBuffer.length, 'bytes');
      
      // Get content type
      const contentType = this.getContentType(safeFilename);
      console.log('   - Content Type:', contentType);
      
      // Upload to storage
      const { data: uploadData, error: uploadError } = await this.client.storage
        .from(bucketName)
        .upload(filePath, imageBuffer, {
          contentType: contentType,
          upsert: false,
          cacheControl: '3600'
        });
      
      if (uploadError) {
        console.error('❌ Storage upload failed:', {
          message: uploadError.message,
          status: uploadError.status,
          statusCode: uploadError.statusCode,
          name: uploadError.name
        });
        throw uploadError;
      }
      
      console.log('✅ Image uploaded to storage:', uploadData.path);
      
      // Get public URL
      const { data: { publicUrl } } = this.client.storage
        .from(bucketName)
        .getPublicUrl(filePath);
      
      console.log('🔗 Public URL:', publicUrl);
      
      // Prepare insert data matching batch table schema
      const insertData = {
        user_id: userId,
        image_path: filePath,
        brightness: brightness,
        contrast: contrast,
        saturation: saturation,
        batch_timestamp: batchTimestamp,
        batch_index: batchIndex,
        date_captured: new Date().toISOString()
      };
      
      console.log('💾 Storing batch image metadata in database...');
      
      // Store image metadata in database
      const { data: imageData, error: dbError } = await this.client
        .from('image_data')
        .insert(insertData)
        .select()
        .single();
      
      if (dbError) {
        console.error('❌ Database insert failed:', dbError);
        
        // Try to delete the uploaded file if database insert fails
        try {
          await this.client.storage
            .from(bucketName)
            .remove([filePath]);
          console.log('🗑️ Cleaned up uploaded file due to database error');
        } catch (cleanupError) {
          console.error('❌ Failed to cleanup uploaded file:', cleanupError);
        }
        
        throw dbError;
      }
      
      console.log('✅ Batch image metadata stored in database, ID:', imageData.image_id);
      
      return {
        ...imageData,
        publicUrl: publicUrl,
        filename: safeFilename,
        file_size: imageBuffer.length,
        file_path: filePath,
        batch_timestamp: batchTimestamp,
        batch_index: batchIndex,
        uploaded_at: imageData.date_captured
      };
      
    } catch (error) {
      console.error('❌ Batch image upload process failed:', error);
      throw error;
    }
  }

  // ========== SOIL DATA METHODS ==========

  async storeSoilData(soilData, userId) {
    if (!this.initialized) {
      await this.waitForInitialization();
      if (!this.initialized) throw new Error('Supabase not initialized');
    }
    
    if (!userId) {
      throw new Error('User ID is required to store soil data');
    }
    
    try {
      // Validate user exists
      await this.validateUser(userId);
      
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
    } catch (error) {
      console.error('❌ Error storing soil data:', error);
      throw error;
    }
  }

  async getLatestSoilData(userId) {
    if (!this.initialized) {
      await this.waitForInitialization();
      if (!this.initialized) throw new Error('Supabase not initialized');
    }
    
    if (!userId) {
      throw new Error('User ID is required to fetch soil data');
    }
    
    console.log('🔍 Fetching latest soil data for user:', userId);
    
    try {
      // Validate user exists
      await this.validateUser(userId);
      
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
    } catch (error) {
      console.error('❌ Error in getLatestSoilData:', error.message);
      return null;
    }
  }

  // ========== IMAGE MANAGEMENT METHODS ==========

  async getUserImages(userId, limit = 10) {
    if (!this.initialized) {
      await this.waitForInitialization();
      if (!this.initialized) throw new Error('Supabase not initialized');
    }
    
    if (!userId) {
      throw new Error('User ID is required to fetch user images');
    }
    
    try {
      // Validate user exists
      await this.validateUser(userId);
      
      const { data, error } = await this.client
        .from('image_data')
        .select('*')
        .eq('user_id', userId)
        .order('date_captured', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data || [];

    } catch (error) {
      console.error('❌ Error in getUserImages:', error.message);
      throw error;
    }
  }

  async getLatestImage(userId) {
    if (!this.initialized) {
      await this.waitForInitialization();
      if (!this.initialized) throw new Error('Supabase not initialized');
    }
    
    if (!userId) {
      throw new Error('User ID is required to fetch latest image');
    }
    
    try {
      // Validate user exists
      await this.validateUser(userId);
      
      const { data, error } = await this.client
        .from('image_data')
        .select('*')
        .eq('user_id', userId)
        .order('date_captured', { ascending: false })
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      return data;

    } catch (error) {
      console.error('❌ Error in getLatestImage:', error.message);
      throw error;
    }
  }

  // ========== ANALYSIS RESULTS METHODS ==========

  async storeAnalysisResult(analysisData, userId) {
    if (!this.initialized) {
      await this.waitForInitialization();
      if (!this.initialized) throw new Error('Supabase not initialized');
    }
    
    if (!userId) {
      throw new Error('User ID is required to store analysis result');
    }
    
    try {
      // Validate user exists
      await this.validateUser(userId);
      
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
    } catch (error) {
      console.error('❌ Error storing analysis result:', error);
      throw error;
    }
  }

  async getAnalysisHistory(userId, limit = 10) {
    if (!this.initialized) {
      await this.waitForInitialization();
      if (!this.initialized) throw new Error('Supabase not initialized');
    }
    
    if (!userId) {
      throw new Error('User ID is required to fetch analysis history');
    }
    
    console.log(`📚 Getting analysis history for user: ${userId}, limit: ${limit}`);
    
    try {
      // Validate user exists
      await this.validateUser(userId);
      
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

      if (error) {
        console.error('❌ Database error fetching analysis history:', error);
        throw error;
      }

      console.log(`✅ Found ${data?.length || 0} analysis records for user: ${userId}`);
      return data || [];

    } catch (error) {
      console.error('❌ Error in getAnalysisHistory:', error.message);
      return [];
    }
  }

  // ========== HELPER METHODS ==========

  getContentType(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const types = {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'webp': 'image/webp',
      'bmp': 'image/bmp',
      'tiff': 'image/tiff',
      'tif': 'image/tiff',
      'svg': 'image/svg+xml',
      'svgz': 'image/svg+xml'
    };
    return types[ext] || 'image/jpeg';
  }

  async healthCheck() {
    if (!this.initialized) {
      await this.waitForInitialization();
      if (!this.initialized) {
        return { 
          status: 'disconnected', 
          error: 'Supabase not initialized',
          details: {
            url_provided: !!process.env.SUPABASE_URL,
            key_provided: !!process.env.SUPABASE_SERVICE_KEY
          }
        };
      }
    }

    try {
      // Test database connection
      const { error: dbError } = await this.client
        .from('image_data')
        .select('count')
        .limit(1);

      // Test storage connection
      const { error: storageError } = await this.client.storage
        .from('images')
        .list('', { limit: 1 });

      const status = (!dbError && !storageError) ? 'connected' : 'degraded';
      
      return {
        status,
        database: dbError ? 'error' : 'connected',
        storage: storageError ? 'error' : 'connected',
        errors: {
          database: dbError?.message,
          storage: storageError?.message
        },
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        status: 'error',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  async getUsageStatistics(userId = null) {
    if (!this.initialized) {
      await this.waitForInitialization();
      if (!this.initialized) throw new Error('Supabase not initialized');
    }
    
    try {
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
    } catch (error) {
      console.error('❌ Error getting usage statistics:', error);
      throw error;
    }
  }

  // ========== IMAGE DELETION METHODS ==========

  async deleteImage(filePath, userId) {
    if (!this.initialized) {
      await this.waitForInitialization();
      if (!this.initialized) throw new Error('Supabase not initialized');
    }
    
    if (!userId) {
      throw new Error('User ID is required to delete image');
    }
    
    try {
      // Validate user exists
      await this.validateUser(userId);
      
      // Check if image exists
      const { data: image, error: imageError } = await this.client
        .from('image_data')
        .select('*')
        .eq('image_path', filePath)
        .eq('user_id', userId)
        .single();

      if (imageError) {
        throw new Error('Image not found or access denied');
      }

      // Delete from storage
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
    } catch (error) {
      console.error('❌ Error deleting image:', error);
      throw error;
    }
  }

  async deleteUserImages(userId) {
    if (!this.initialized) {
      await this.waitForInitialization();
      if (!this.initialized) throw new Error('Supabase not initialized');
    }
    
    if (!userId) {
      throw new Error('User ID is required to delete user images');
    }
    
    try {
      // Validate user exists
      await this.validateUser(userId);
      
      // Get user images first
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
    } catch (error) {
      console.error('❌ Error deleting user images:', error);
      throw error;
    }
  }

  // ========== DEBUG/ADMIN METHODS ==========

  async debugStorageSetup() {
    try {
      console.log('🔍 Debugging Storage Setup...');
      
      // Check environment variables
      console.log('📋 Environment Check:');
      console.log('   - SUPABASE_URL:', process.env.SUPABASE_URL ? '✓ Set' : '✗ Missing');
      console.log('   - SUPABASE_SERVICE_KEY:', process.env.SUPABASE_SERVICE_KEY ? '✓ Set' : '✗ Missing');
      
      if (process.env.SUPABASE_SERVICE_KEY) {
        const keyStart = process.env.SUPABASE_SERVICE_KEY.substring(0, 20);
        console.log('   - Key starts with:', keyStart + '...');
      }
      
      // Test client connection
      console.log('🔗 Testing Supabase Client:');
      console.log('   - Client initialized:', this.initialized);
      
      if (!this.initialized) {
        console.log('❌ Client not initialized');
        return { success: false, error: 'Client not initialized' };
      }
      
      // Test storage bucket access
      console.log('📦 Testing Storage Bucket Access:');
      
      const { data: buckets, error: bucketsError } = await this.client.storage.listBuckets();
      
      if (bucketsError) {
        console.log('❌ Cannot list buckets:', bucketsError.message);
        return { success: false, error: bucketsError };
      }
      
      console.log('✅ Available buckets:', buckets.map(b => b.name));
      
      const imagesBucket = buckets.find(b => b.name === 'images');
      if (!imagesBucket) {
        console.log('❌ "images" bucket not found');
        return { success: false, error: 'Images bucket not found' };
      }
      
      console.log('✅ Images bucket found:', {
        id: imagesBucket.id,
        name: imagesBucket.name,
        public: imagesBucket.public,
        createdAt: imagesBucket.created_at
      });
      
      return { success: true, message: 'Storage is working correctly' };
      
    } catch (error) {
      console.error('❌ Debug failed:', error);
      return { success: false, error: error.message };
    }
  }

}

module.exports = new SupabaseService();