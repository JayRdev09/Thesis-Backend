const express = require('express');
const multer = require('multer');
const router = express.Router();
const storageService = require('../services/storageService');
const supabaseService = require('../services/supabaseService');
const loggingService = require('../services/loggingService');

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 50 // Maximum 50 files for batch
  },
  fileFilter: (req, file, cb) => {
    // Accept all files for debugging - you can restrict later
    console.log(`File received: ${file.originalname}, MIME: ${file.mimetype}`);
    cb(null, true);
  }
});

// Middleware to validate userId
const validateUserId = (req, res, next) => {
  let userId = req.body.userId || 
               req.query.userId || 
               req.headers['x-user-id'] ||
               req.body.user_id;
  
  if (!userId) {
    console.error('❌ User ID validation failed - no userId found');
    return res.status(400).json({
      success: false,
      message: 'User ID is required. Please provide userId parameter.'
    });
  }
  
  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(userId)) {
    console.error('❌ Invalid User ID format:', userId);
    return res.status(400).json({
      success: false,
      message: 'Invalid User ID format. Must be a valid UUID.'
    });
  }
  
  req.userId = userId;
  console.log('✅ User ID validated:', userId);
  next();
};

// BATCH IMAGE UPLOAD - ONLY ENDPOINT FOR IMAGE STORAGE
router.post('/upload-batch', upload.array('images', 50), async (req, res) => {
  try {
    console.log('📤 Batch image upload request received');
    
    // Debug: Log available methods on storageService
    const storageMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(storageService));
    console.log('🔧 Available storage service methods:', storageMethods.length, 'methods');
    if (!storageMethods.includes('storeBatchImages')) {
      console.warn('⚠️ WARNING: storeBatchImages method not found on storageService');
      console.warn('📋 Available methods:', storageMethods.filter(m => m.includes('store') || m.includes('upload')));
    }
    
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No images provided'
      });
    }

    console.log('📊 Received', req.files.length, 'files for batch upload');
    
    // Debug: Log file info for first 5 files
    req.files.slice(0, Math.min(5, req.files.length)).forEach((file, index) => {
      console.log(`File ${index + 1}:`, {
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        fieldname: file.fieldname
      });
    });
    
    // Get userId from body or headers
    let userId = req.body.userId || 
                 req.body.user_id || 
                 req.headers['x-user-id'];
    
    if (!userId) {
      console.error('❌ No userId found in batch upload');
      console.log('Request body keys:', Object.keys(req.body));
      console.log('Request headers:', req.headers);
      
      return res.status(400).json({
        success: false,
        message: 'User ID is required. Please provide userId parameter.',
        debug: {
          received_body_keys: Object.keys(req.body),
          files_count: req.files.length
        }
      });
    }
    
    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(userId)) {
      console.error('❌ Invalid User ID format in batch upload:', userId);
      return res.status(400).json({
        success: false,
        message: 'Invalid User ID format. Must be a valid UUID.',
        received_userId: userId
      });
    }
    
    console.log('✅ Batch upload - User ID validated:', userId);
    
    // Get batch timestamp (use provided or generate new)
    const batchTimestamp = req.body.batch_timestamp || new Date().toISOString();
    
    console.log('📦 Processing batch with timestamp:', batchTimestamp);
    console.log('🔍 Request body keys for adjustments:', 
      Object.keys(req.body).filter(key => key.includes('brightness') || key.includes('contrast') || key.includes('saturation'))
    );
    
    // Prepare image data array with batch information
    const imageDataArray = req.files.map((file, index) => {
      // Extract adjustment parameters for this image
      const brightness = parseFloat(req.body[`brightness_${index}`]) || 
                        parseFloat(req.body.brightness) || 
                        75;
      const contrast = parseFloat(req.body[`contrast_${index}`]) || 
                      parseFloat(req.body.contrast) || 
                      75;
      const saturation = parseFloat(req.body[`saturation_${index}`]) || 
                        parseFloat(req.body.saturation) || 
                        75;
      const batchIndex = parseInt(req.body[`batch_index_${index}`]) || index;
      
      // Ensure filename has proper extension
      let filename = file.originalname || `batch_image_${Date.now()}_${index}`;
      if (!filename.includes('.')) {
        // Add extension based on MIME type
        const ext = file.mimetype.split('/')[1] || 'jpg';
        filename = `${filename}.${ext}`;
      }
      
      // Clean filename
      filename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
      
      console.log(`📸 Image ${index + 1}: ${filename}, adjustments:`, {
        brightness,
        contrast,
        saturation,
        batchIndex
      });
      
      return {
        imageBytes: file.buffer,
        filename: filename,
        brightness: brightness,
        contrast: contrast,
        saturation: saturation,
        batch_timestamp: batchTimestamp,
        batch_index: batchIndex
      };
    });
    
    // Store batch images
    let result;
    
    // Check if storeBatchImages method exists
    if (typeof storageService.storeBatchImages === 'function') {
      result = await storageService.storeBatchImages(imageDataArray, userId);
    } else {
      // Fallback: process images individually if storeBatchImages doesn't exist
      console.warn('⚠️ storageService.storeBatchImages not available, using fallback process');
      const results = [];
      const errors = [];
      
      for (let i = 0; i < imageDataArray.length; i++) {
        try {
          const imageData = imageDataArray[i];
          const uploadResult = await supabaseService.uploadBatchImage(
            imageData.imageBytes,
            imageData.filename,
            userId,
            {
              brightness: imageData.brightness,
              contrast: imageData.contrast,
              saturation: imageData.saturation,
              batch_timestamp: imageData.batch_timestamp,
              batch_index: imageData.batch_index
            }
          );
          
          results.push({
            success: true,
            index: i,
            batch_index: imageData.batch_index,
            imageId: uploadResult.image_id,
            imageUrl: uploadResult.image_path,
            publicUrl: uploadResult.publicUrl,
            filePath: uploadResult.file_path,
            filename: uploadResult.filename
          });
        } catch (error) {
          console.error(`❌ Error uploading image ${i + 1}:`, error.message);
          errors.push({
            index: i,
            filename: imageDataArray[i].filename,
            error: error.message
          });
        }
      }
      
      result = {
        total: imageDataArray.length,
        successful: results.length,
        failed: errors.length,
        results: results,
        errors: errors
      };
    }
    
    if (result.successful === 0 && result.failed > 0) {
      console.error('❌ All batch images failed:', result.errors);
      return res.status(500).json({
        success: false,
        message: 'All images failed to upload',
        total_images: result.total,
        successful: result.successful,
        failed: result.failed,
        errors: result.errors
      });
    }
    
    console.log(`📊 Batch upload completed: ${result.successful} successful, ${result.failed} failed`);
    
    // Log successful batch upload
    if (result.successful > 0) {
      await loggingService.logImageActivity(
        userId,
        'BATCH_IMAGE_UPLOAD',
        `Uploaded ${result.successful} images${result.failed > 0 ? `, ${result.failed} failed` : ''}`
      );
    }
    
    res.json({
      success: true,
      message: result.failed === 0 ? 
        `All ${result.successful} images uploaded successfully` : 
        `${result.successful} images uploaded, ${result.failed} failed`,
      total_images: result.total,
      successful: result.successful,
      failed: result.failed,
      batch_timestamp: batchTimestamp,
      images: result.results,
      errors: result.errors
    });
    
  } catch (error) {
    console.error('❌ Batch upload error:', error);
    
    // Handle multer errors
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          message: 'File too large. Maximum file size is 10MB.'
        });
      }
      if (error.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({
          success: false,
          message: 'Too many files. Maximum 50 files per batch.'
        });
      }
      if (error.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({
          success: false,
          message: 'Unexpected field name for file upload. Use "images" as field name.'
        });
      }
    }
    
    res.status(500).json({
      success: false,
      message: 'Batch upload failed: ' + error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Get user images
router.get('/user-images', validateUserId, async (req, res) => {
  try {
    const userId = req.userId;
    const limit = parseInt(req.query.limit) || 20;

    console.log(`📸 Fetching images for user ${userId}, limit: ${limit}`);

    const images = await storageService.getUserImages(userId, limit);

    res.json({
      success: true,
      images: images,
      count: images.length,
      user_id: userId
    });

  } catch (error) {
    console.error('❌ Error fetching user images:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user images: ' + error.message
    });
  }
});

// Get latest image
router.get('/latest', validateUserId, async (req, res) => {
  try {
    const userId = req.userId;

    console.log(`🔍 Fetching latest image for user ${userId}`);

    const image = await storageService.getLatestImage(userId);

    if (!image) {
      return res.status(404).json({
        success: false,
        message: 'No images found'
      });
    }

    res.json({
      success: true,
      image: image,
      user_id: userId
    });

  } catch (error) {
    console.error('❌ Error fetching latest image:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch latest image: ' + error.message
    });
  }
});

// Delete image
router.delete('/delete', validateUserId, async (req, res) => {
  try {
    const userId = req.userId;
    const { filePath } = req.body;

    if (!filePath) {
      return res.status(400).json({
        success: false,
        message: 'File path is required'
      });
    }

    console.log(`🗑️ Deleting image ${filePath} for user ${userId}`);

    await storageService.deleteImage(filePath, userId);

    res.json({
      success: true,
      message: 'Image deleted successfully'
    });

  } catch (error) {
    console.error('❌ Error deleting image:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete image: ' + error.message
    });
  }
});

// Get batch images
router.get('/batch/:batchTimestamp', validateUserId, async (req, res) => {
  try {
    const userId = req.userId;
    const { batchTimestamp } = req.params;

    console.log(`📦 Getting batch ${batchTimestamp} for user ${userId}`);

    const images = await storageService.getImagesByBatch(batchTimestamp, userId);

    res.json({
      success: true,
      batch_timestamp: batchTimestamp,
      images: images,
      count: images.length,
      user_id: userId
    });

  } catch (error) {
    console.error('❌ Error fetching batch images:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch batch images: ' + error.message
    });
  }
});

// Get user batches
router.get('/user-batches', validateUserId, async (req, res) => {
  try {
    const userId = req.userId;
    const limit = parseInt(req.query.limit) || 10;

    console.log(`📚 Getting batches for user ${userId}, limit: ${limit}`);

    const batches = await storageService.getUserBatches(userId, limit);

    res.json({
      success: true,
      batches: batches,
      count: batches.length,
      user_id: userId
    });

  } catch (error) {
    console.error('❌ Error fetching user batches:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user batches: ' + error.message
    });
  }
});

// Get recent images (within hours)
router.get('/recent', validateUserId, async (req, res) => {
  try {
    const userId = req.userId;
    const hours = parseInt(req.query.hours) || 24;

    console.log(`⏰ Getting recent images for user ${userId} within ${hours} hours`);

    // Get images from last X hours
    const cutoffTime = new Date(Date.now() - (hours * 60 * 60 * 1000));
    
    const { data, error } = await storageService.client
      .from('image_data')
      .select('*')
      .eq('user_id', userId)
      .gte('date_captured', cutoffTime.toISOString())
      .order('date_captured', { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      images: data || [],
      count: data?.length || 0,
      time_window_hours: hours,
      user_id: userId
    });

  } catch (error) {
    console.error('❌ Error fetching recent images:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch recent images: ' + error.message
    });
  }
});

// Get images for analysis
router.get('/for-analysis', validateUserId, async (req, res) => {
  try {
    const userId = req.userId;
    const limit = parseInt(req.query.limit) || 50;
    const includeUnanalyzed = req.query.unanalyzed !== 'false';

    console.log(`🔍 Getting images for analysis for user ${userId}, limit: ${limit}, unanalyzed: ${includeUnanalyzed}`);

    const images = await storageService.getImagesForAnalysis(userId, limit, includeUnanalyzed);

    res.json({
      success: true,
      images: images,
      count: images.length,
      user_id: userId
    });

  } catch (error) {
    console.error('❌ Error fetching images for analysis:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch images for analysis: ' + error.message
    });
  }
});

// Health check
router.get('/health', async (req, res) => {
  try {
    const health = await storageService.healthCheck();
    
    res.json({
      success: true,
      health: health,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Storage health check error:', error);
    res.status(500).json({
      success: false,
      message: 'Storage health check failed: ' + error.message
    });
  }
});

// Get image by ID
router.get('/:imageId', validateUserId, async (req, res) => {
  try {
    const userId = req.userId;
    const { imageId } = req.params;

    console.log(`🔍 Getting image ${imageId} for user ${userId}`);

    const { data, error } = await storageService.client
      .from('image_data')
      .select('*')
      .eq('image_id', imageId)
      .eq('user_id', userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({
          success: false,
          message: 'Image not found'
        });
      }
      throw error;
    }

    res.json({
      success: true,
      image: data,
      user_id: userId
    });

  } catch (error) {
    console.error('❌ Error fetching image:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch image: ' + error.message
    });
  }
});

// Get image public URL
router.get('/public-url/:filePath', validateUserId, async (req, res) => {
  try {
    const userId = req.userId;
    const { filePath } = req.params;

    console.log(`🔗 Getting public URL for ${filePath} for user ${userId}`);

    // First verify user owns the image
    const { data: image, error: imageError } = await storageService.client
      .from('image_data')
      .select('image_path')
      .eq('image_path', filePath)
      .eq('user_id', userId)
      .single();

    if (imageError) {
      return res.status(404).json({
        success: false,
        message: 'Image not found or access denied'
      });
    }

    const publicUrl = await storageService.getImagePublicUrl(filePath);

    if (!publicUrl) {
      return res.status(404).json({
        success: false,
        message: 'Public URL not found'
      });
    }

    res.json({
      success: true,
      publicUrl: publicUrl,
      file_path: filePath,
      user_id: userId
    });

  } catch (error) {
    console.error('❌ Error getting public URL:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get public URL: ' + error.message
    });
  }
});

module.exports = router;