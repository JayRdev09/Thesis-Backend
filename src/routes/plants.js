const express = require('express');
const router = express.Router();
const supabaseService = require('../services/supabaseService');
const loggingService = require('../services/loggingService');

// Authentication middleware
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Authentication token required'
      });
    }

    const accessToken = authHeader.split('Bearer ')[1];
    
    const { data, error } = await supabaseService.client.auth.getUser(accessToken);
    
    if (error) throw error;

    req.user = data.user;
    next();
  } catch (error) {
    console.error('❌ Authentication failed:', error.message);
    return res.status(401).json({
      success: false,
      message: 'Invalid authentication token'
    });
  }
};

// Get all plants for user
router.get('/', authenticateToken, async (req, res) => {
  try {
    console.log(`🌱 GET /api/plants - User: ${req.user.id}`);
    
    const { data, error } = await supabaseService.client
      .from('plants')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    
    res.json({ 
      success: true, 
      data: data || [] 
    });
    
    // Log plant list access
    await loggingService.logPlantActivity(
      req.user.id,
      'VIEW_PLANTS_LIST',
      `Viewed ${data?.length || 0} plants`
    );
  } catch (error) {
    console.error('❌ Error in GET /plants:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get single plant with all assessments
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    console.log(`🌱 GET /api/plants/${req.params.id} - User: ${req.user.id}`);
    
    const { data: plant, error: plantError } = await supabaseService.client
      .from('plants')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();

    if (plantError) {
      if (plantError.code === 'PGRST116') {
        return res.status(404).json({ 
          success: false, 
          error: 'Plant not found' 
        });
      }
      throw plantError;
    }

    const { data: assessments, error: assessmentsError } = await supabaseService.client
      .from('growth_assessments')
      .select('*')
      .eq('plant_id', req.params.id)
      .order('assessment_date', { ascending: false });

    if (assessmentsError) throw assessmentsError;

    res.json({
      success: true,
      data: {
        ...plant,
        assessments: assessments || []
        // Removed the harvests reference
      }
    });
    
    // Log specific plant access
    await loggingService.logPlantActivity(
      req.user.id,
      'VIEW_PLANT_DETAILS',
      `Viewed plant "${plant.plant_name}" with ${assessments?.length || 0} assessments`
    );
  } catch (error) {
    console.error('❌ Error in GET /plants/:id:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Create new plant
router.post('/', authenticateToken, async (req, res) => {
  try {
    console.log(`🌱 POST /api/plants - User: ${req.user.id}`);
    console.log('📦 Request body:', req.body);
    
    const {
      plant_name,
      estimated_age_months,
      growth_stage,
      initial_assessment,
      plant_type = 'tomato'
    } = req.body;

    // Validate required fields
    if (!plant_name) {
      return res.status(400).json({ 
        success: false, 
        error: 'Plant name is required' 
      });
    }

    console.log(`📊 Creating plant with age: ${estimated_age_months}, stage: ${growth_stage}`);

    const { data, error } = await supabaseService.client
      .from('plants')
      .insert([{
        user_id: req.user.id,
        plant_name,
        estimated_age_months: estimated_age_months || null,
        growth_stage: growth_stage || null,
        initial_assessment: initial_assessment || null,
        plant_type,
        created_at: new Date()
      }])
      .select();

    if (error) throw error;

    // If initial assessment exists, also create first growth assessment
    if (initial_assessment && data[0]) {
      await supabaseService.client
        .from('growth_assessments')
        .insert([{
          plant_id: data[0].id,
          node_count: initial_assessment.nodeCount,
          height_cm: initial_assessment.heightCm,
          stem_diameter_cm: initial_assessment.stemDiameterCm,
          stem_base_condition: initial_assessment.stemBaseCondition,
          flower_clusters: initial_assessment.hasFlowers ? 1 : 0,
          fruit_clusters: initial_assessment.hasGreenFruits ? 1 : 0,
          ripe_fruits_count: initial_assessment.hasRipeFruits ? 1 : 0,
          harvest_count: initial_assessment.harvestCount || 0,
          leaf_condition: initial_assessment.leafCondition,
          assessment_date: new Date()
        }]);
    }

    console.log('✅ Plant created:', data[0].id, 'Age:', data[0].estimated_age_months, 'Stage:', data[0].growth_stage);
    
    // Log successful plant creation
    await loggingService.logPlantActivity(
      req.user.id,
      'PLANT_CREATED',
      `Created plant "${plant_name}" with age ${estimated_age_months} months, stage: ${growth_stage}`
    );
    
    res.json({ success: true, data: data[0] });
  } catch (error) {
    console.error('❌ Error in POST /plants:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Update plant
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    console.log(`🌱 PUT /api/plants/${req.params.id} - User: ${req.user.id}`);
    console.log('📦 Update data:', req.body);
    
    const { data, error } = await supabaseService.client
      .from('plants')
      .update(req.body)
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .select();

    if (error) throw error;
    
    if (!data || data.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Plant not found' 
      });
    }
    
    console.log('✅ Plant updated:', data[0].id, 'New age:', data[0].estimated_age_months, 'New stage:', data[0].growth_stage);
    res.json({ success: true, data: data[0] });
  } catch (error) {
    console.error('❌ Error in PUT /plants/:id:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Delete plant
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    console.log(`🌱 DELETE /api/plants/${req.params.id} - User: ${req.user.id}`);
    
    const { error } = await supabaseService.client
      .from('plants')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);

    if (error) throw error;
    
    res.json({ 
      success: true, 
      message: 'Plant deleted successfully' 
    });
  } catch (error) {
    console.error('❌ Error in DELETE /plants/:id:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

module.exports = router;